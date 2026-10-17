import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { parseArgumentsLeniently } from "../dynamic/argument-repair.ts";
import { mcpSource, type McpCallResult, type McpNamespace } from "../dynamic/mcp-source.ts";
import { errorResult, rawErrorResult, textResult, type DynamicContentBlock, type DynamicToolReturn } from "../dynamic/results.ts";
import { FIRST_PARTY_NAMESPACE, getDynamicTool, listDynamicTools } from "../dynamic/registry.ts";
import { checkType, invalidArguments, optionalString, type ArgIssue } from "./cursor-args.ts";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";

const CALL_DYNAMIC_TOOL = declaration("CallDynamicTool");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: CALL_DYNAMIC_TOOL.name,
		label: CALL_DYNAMIC_TOOL.name,
		description: CALL_DYNAMIC_TOOL.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeCallDynamicTool(params, signal, ctx),
	});
}

interface CallArgs {
	namespace: string;
	toolName: string;
	arguments: Record<string, unknown> | undefined;
}

// Cursor's preprocess step: the namespace becomes the server field, a missing identity is refused before the schema is
// checked, a stringified `arguments` is read leniently, and the alias descriptionForMcp becomes description.
function normalize(params: unknown): unknown {
	if (params === null || typeof params !== "object" || Array.isArray(params)) return params;
	const normalized: Record<string, unknown> = { ...(params as Record<string, unknown>) };
	if (normalized.namespace !== undefined) {
		normalized.server = normalized.namespace;
		delete normalized.namespace;
	}
	const missing = [normalized.server === undefined ? "namespace" : undefined, normalized.toolName === undefined ? "toolName" : undefined].filter(
		(field): field is string => field !== undefined,
	);
	if (missing.length > 0) {
		throw new Error(
			`Missing required ${missing.length === 1 ? "field" : "fields"}: ${missing.join(", ")}. Re-issue the call with the tool's identity set; \`arguments\` alone does not identify the tool.`,
		);
	}
	if (normalized.descriptionForMcp !== undefined) {
		normalized.description ??= normalized.descriptionForMcp;
		delete normalized.descriptionForMcp;
	}
	if (typeof normalized.arguments === "string") {
		const recovered = parseArgumentsLeniently(normalized.arguments);
		if (recovered === undefined) {
			throw new Error("Failed to parse arguments string as JSON object. Re-issue the call with `arguments` as a JSON object literal rather than a quoted string.");
		}
		const args: Record<string, unknown> = { ...recovered.args };
		if (recovered.repaired) {
			if (args.mcpDetails !== undefined) {
				normalized.mcpDetails ??= args.mcpDetails;
				delete args.mcpDetails;
			}
			if (args.descriptionForMcp !== undefined) {
				normalized.description ??= args.descriptionForMcp;
				delete args.descriptionForMcp;
			}
		}
		const leaked = recovered.envelopeFields?.description;
		if (leaked !== undefined && normalized.description === undefined) normalized.description = leaked;
		normalized.arguments = args;
	}
	return normalized;
}

// The zod schema Cursor checks after the preprocess step, with the issues in the order of its fields.
function parseCall(value: unknown, issues: ArgIssue[]): CallArgs | undefined {
	if (!checkType(value, "object", [], issues)) return undefined;
	const record = value as Record<string, unknown>;
	const namespace = checkType(record.server, "string", ["server"], issues) ? (record.server as string) : undefined;
	const toolName = checkType(record.toolName, "string", ["toolName"], issues) ? (record.toolName as string) : undefined;
	let args: Record<string, unknown> | undefined;
	if (record.arguments !== undefined && checkType(record.arguments, "object", ["arguments"], issues)) {
		args = record.arguments as Record<string, unknown>;
	}
	optionalString(record.description, ["description"], issues);
	if (record.mcpDetails !== undefined && checkType(record.mcpDetails, "object", ["mcpDetails"], issues)) {
		optionalString((record.mcpDetails as Record<string, unknown>).description, ["mcpDetails", "description"], issues);
	}
	if (issues.length > 0 || namespace === undefined || toolName === undefined) return undefined;
	return { namespace, toolName, arguments: args };
}

export async function executeCallDynamicTool(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<DynamicToolReturn> {
	try {
		const issues: ArgIssue[] = [];
		const call = parseCall(normalize(params), issues);
		if (call === undefined) return errorResult(invalidArguments(issues));
		return call.namespace === FIRST_PARTY_NAMESPACE ? await firstParty(call, signal, ctx) : await external(call, signal, ctx);
	} catch (error) {
		return errorResult(error instanceof Error ? error.message : String(error));
	}
}

async function firstParty(call: CallArgs, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<DynamicToolReturn> {
	const entry = getDynamicTool(FIRST_PARTY_NAMESPACE, call.toolName);
	if (entry === undefined) {
		const tools = listDynamicTools(FIRST_PARTY_NAMESPACE);
		if (tools.length === 0) return errorResult(`No built-in tools are available in namespace "${FIRST_PARTY_NAMESPACE}".`);
		const names = tools.map((tool) => tool.declaration.name).join(", ");
		return errorResult(
			`Built-in tool "${call.toolName}" not found in namespace "${FIRST_PARTY_NAMESPACE}". Available tools: ${names}. Use GetDynamicTools to discover their schemas.`,
		);
	}
	const result = await entry.execute(call.arguments ?? {}, signal, ctx);
	return result.isError ? rawErrorResult(result.text || "Dynamic tool execution failed") : textResult(result.text);
}

async function external(call: CallArgs, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<DynamicToolReturn> {
	const source = mcpSource();
	const namespaces: McpNamespace[] = source === undefined ? [] : await source.listMcpNamespaces(ctx.cwd, signal);
	const namespace = namespaces.find((candidate) => candidate.name === call.namespace);
	if (source === undefined || namespace === undefined) {
		return errorResult(`MCP server does not exist: ${call.namespace}. Use GetDynamicTools to discover available namespaces.`);
	}
	if (namespace.status !== "ready") return errorResult(namespace.error ?? `Namespace "${call.namespace}" is ${namespace.status}.`);
	if (!namespace.tools.some((tool) => tool.name === call.toolName)) {
		return errorResult(`Tool ${call.toolName} was not found. Use GetDynamicTools to discover available namespaces and their tools.`);
	}
	const result = await source.callMcpTool(call.namespace, call.toolName, call.arguments ?? {}, signal);
	return result.isError ? rawErrorResult(result.text || "Dynamic tool execution failed") : { content: contentOf(result), details: undefined };
}

function contentOf(result: McpCallResult): DynamicContentBlock[] {
	if (result.content.length === 0) return [{ type: "text", text: result.text }];
	return result.content.map((block) =>
		block.type === "text" ? { type: "text", text: block.text } : { type: "image", data: block.data, mimeType: block.mimeType },
	);
}
