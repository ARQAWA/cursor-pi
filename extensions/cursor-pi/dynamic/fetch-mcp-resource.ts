// Cursor's FetchMcpResource: a first-party tool in the cursor namespace whose backend is the MCP client's resource read.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkType, invalidArguments, type ArgIssue } from "../tools/cursor-args.ts";
import type { CapturedTool } from "../tools/declarations.ts";
import { listOwnedMcpNamespaces } from "./mcp-source.ts";
import { FIRST_PARTY_NAMESPACE, getDynamicTool, registerDynamicTool } from "./registry.ts";

// The captured GetDynamicTools view of FetchMcpResource: its description and input schema, as Cursor lists them.
const CAPTURED = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"research",
	"cursor",
	"reverse",
	"prompts",
	"tools",
	"cursor-namespace",
	"FetchMcpResource.json",
);

function fetchMcpResourceDeclaration(): CapturedTool {
	const captured = JSON.parse(readFileSync(CAPTURED, "utf8")) as { tool: string; description: string; inputSchema: Record<string, unknown> };
	return { type: "function", name: captured.tool, description: captured.description, parameters: captured.inputSchema };
}

export function registerFetchMcpResource(): void {
	if (getDynamicTool(FIRST_PARTY_NAMESPACE, "FetchMcpResource") !== undefined) return;
	registerDynamicTool({
		namespace: FIRST_PARTY_NAMESPACE,
		declaration: fetchMcpResourceDeclaration(),
		async execute(args, signal, ctx) {
			const issues: ArgIssue[] = [];
			if (!checkType(args, "object", [], issues)) return { text: invalidArguments(issues), isError: true };
			const record = args as Record<string, unknown>;
			const server = checkType(record.server, "string", ["server"], issues) ? (record.server as string) : undefined;
			const uri = checkType(record.uri, "string", ["uri"], issues) ? (record.uri as string) : undefined;
			if (issues.length > 0 || server === undefined || uri === undefined) return { text: invalidArguments(issues), isError: true };
			// Writing the resource into the workspace is not implemented; the model must not receive it instead without notice.
			if (record.downloadPath !== undefined) {
				return { text: "downloadPath is not supported by Cursor Pi yet; the resource can only be returned to the model.", isError: true };
			}
			const owned = (await listOwnedMcpNamespaces(ctx.cwd, signal)).find((candidate) => candidate.namespace.name === server);
			if (owned === undefined) {
				return { text: `MCP server does not exist: ${server}. Use GetDynamicTools to discover available namespaces.`, isError: true };
			}
			const result = await owned.source.readMcpResource(server, uri, signal);
			return { text: result.text, isError: result.isError };
		},
	});
}
