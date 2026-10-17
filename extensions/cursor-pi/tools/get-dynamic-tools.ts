import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { registerFetchMcpResource } from "../dynamic/fetch-mcp-resource.ts";
import { registerMcpSource } from "../dynamic/mcp-source.ts";
import { dynamicNamespaces, type NamespaceSource } from "../dynamic/namespaces.ts";
import { catalogResult, namespaceModel, searchMatches, searchResult, serverPayload, type ToolPayload } from "../dynamic/payloads.ts";
import { errorResult, textResult, type DynamicToolReturn } from "../dynamic/results.ts";
import { FIRST_PARTY_NAMESPACE } from "../dynamic/registry.ts";
import { callMcpTool, listMcpNamespaces, readMcpResource } from "../mcp/index.ts";
import { checkType, invalidArguments, optionalString, type ArgIssue } from "./cursor-args.ts";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";
import { agentToolsDirFor, projectDirFor } from "./shell/paths.ts";

const GET_DYNAMIC_TOOLS = declaration("GetDynamicTools");
// Cursor writes a larger result to an agent-tools file and returns a note in its place; the threshold and cap are Cursor's.
const FILE_OUTPUT_THRESHOLD_BYTES = 12_000;
const MAX_OUTPUT_FILE_SIZE = 50 * 1024 * 1024 - 1024 * 1024;
const MAX_REGEX_PATTERN_LENGTH = 256;

export function register(pi: ExtensionAPI): void {
	registerMcpSource({ listMcpNamespaces, callMcpTool, readMcpResource });
	registerFetchMcpResource();
	pi.registerTool({
		name: GET_DYNAMIC_TOOLS.name,
		label: GET_DYNAMIC_TOOLS.name,
		description: GET_DYNAMIC_TOOLS.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGetDynamicTools(params, signal, ctx),
	});
}

interface GetArgs {
	namespace?: string;
	toolName?: string;
	pattern?: string;
}

// Cursor's preprocess reads the namespace into the zod field `server`, so an invalid namespace is reported under `server`.
function parseArgs(params: unknown, issues: ArgIssue[]): GetArgs | undefined {
	if (!checkType(params, "object", [], issues)) return undefined;
	const record = params as Record<string, unknown>;
	const namespace = optionalString(record.namespace, ["server"], issues);
	const toolName = optionalString(record.toolName, ["toolName"], issues);
	const pattern = optionalString(record.pattern, ["pattern"], issues);
	return { namespace, toolName, pattern };
}

export async function executeGetDynamicTools(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<DynamicToolReturn> {
	const issues: ArgIssue[] = [];
	const args = parseArgs(params, issues);
	if (args === undefined || issues.length > 0) return errorResult(invalidArguments(issues));
	try {
		return textResult(await spillIfLarge(await discover(args, signal, ctx), ctx.cwd));
	} catch (error) {
		return errorResult(error instanceof Error ? error.message : String(error));
	}
}

async function discover(args: GetArgs, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<string> {
	if (args.toolName !== undefined && args.namespace === undefined) throw new Error("toolName requires namespace to be set.");
	if (args.pattern !== undefined && args.pattern.length > MAX_REGEX_PATTERN_LENGTH) {
		throw new Error(`pattern cannot exceed ${MAX_REGEX_PATTERN_LENGTH} characters.`);
	}
	// Cursor queries no MCP server when the request names the first-party namespace.
	const namespaces = await dynamicNamespaces(ctx.cwd, signal, { includeExternal: args.namespace !== FIRST_PARTY_NAMESPACE });
	if (args.pattern !== undefined && args.toolName === undefined) {
		const regex = compileSearch(args.pattern);
		const scope = args.namespace === undefined ? namespaces : namespaces.filter((candidate) => candidate.name === args.namespace);
		if (args.namespace !== undefined && scope.length === 0) throw namespaceNotFound(args.namespace, namespaces);
		return json(searchResult(args.pattern, searchMatches(scope, regex)));
	}
	if (args.namespace === undefined) return json(catalogResult(namespaces));
	const namespace = namespaces.find((candidate) => candidate.name === args.namespace);
	if (namespace === undefined || args.namespace === undefined) throw namespaceNotFound(args.namespace ?? "", namespaces);
	if (args.toolName === undefined) return json({ mode: "namespace", ...namespaceModel(serverPayload(namespace, { includeSchema: true })) });
	return json(singleTool(namespace, args.toolName));
}

function singleTool(namespace: NamespaceSource, toolName: string): ToolPayload {
	const payload = serverPayload(namespace, { includeSchema: true, toolName });
	const tool = payload.tools.find((candidate) => candidate.tool === toolName);
	if (tool !== undefined) return tool;
	const available = namespace.tools.map((candidate) => candidate.name).join(", ");
	if (payload.serverStatus !== undefined && payload.serverStatus !== "ready") {
		throw new Error(`${payload.serverError ?? `Namespace "${namespace.name}" is ${payload.serverStatus}.`} Available tools: ${available}`);
	}
	throw new Error(`Tool "${toolName}" not found in namespace "${namespace.name}". Available tools: ${available}`);
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function compileSearch(pattern: string): RegExp {
	try {
		return new RegExp(pattern);
	} catch (error) {
		throw new Error(`Invalid regex pattern: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function namespaceNotFound(name: string, namespaces: NamespaceSource[]): Error {
	const available = namespaces.map((namespace) => namespace.name).sort();
	return new Error(available.length === 0 ? `namespace "${name}" not found.` : `namespace "${name}" not found. Available namespaces: ${available.join(", ")}`);
}

// Cursor's maybeWriteToFile: a result over the threshold goes to an agent-tools file, and the model gets a note with its path.
async function spillIfLarge(content: string, cwd: string): Promise<string> {
	const bytes = Buffer.byteLength(content, "utf8");
	if (bytes <= FILE_OUTPUT_THRESHOLD_BYTES) return content;
	const dir = agentToolsDirFor(projectDirFor(resolve(cwd)));
	const filePath = join(dir, `${randomUUID()}.txt`);
	const text = Buffer.from(content, "utf8").subarray(0, MAX_OUTPUT_FILE_SIZE).toString("utf8");
	await mkdir(dir, { recursive: true });
	await writeFile(filePath, text);
	const lineCount = text.split("\n").length;
	const size = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
	return json({ note: `Large output has been written to: ${filePath} (${size}, ${lineCount} lines)`, filePath });
}
