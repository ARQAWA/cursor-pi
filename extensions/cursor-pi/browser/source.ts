import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type McpCallResult, type McpNamespace, registerMcpSource } from "../dynamic/mcp-source.ts";
import { callBrowserTool, setWorkingDir } from "./tools.ts";

// The cursor-ide-browser namespace: the declarations and instructions Cursor's server sends, served by the local browser.
export const BROWSER_NAMESPACE = "cursor-ide-browser";

const HERE = dirname(fileURLToPath(import.meta.url));
interface DeclaredBrowserTools {
	instructions: string;
	tools: Array<{ name: string; description: string; parameters: object }>;
}
const declared = JSON.parse(readFileSync(join(HERE, "../tools/generated/browser-tools.json"), "utf8")) as DeclaredBrowserTools;

export async function listMcpNamespaces(cwd: string): Promise<McpNamespace[]> {
	setWorkingDir(cwd);
	return [
		{
			name: BROWSER_NAMESPACE,
			status: "ready",
			error: undefined,
			instructions: declared.instructions,
			tools: declared.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters, annotations: undefined })),
		},
	];
}

export async function callMcpTool(namespace: string, toolName: string, args: unknown): Promise<McpCallResult> {
	if (namespace !== BROWSER_NAMESPACE) throw new Error(`namespace "${namespace}" not found`);
	return callBrowserTool(toolName, args);
}

export async function readMcpResource(server: string): Promise<McpCallResult> {
	const message = `Error reading MCP resource: Server "${server}" has no resources.`;
	return { content: [{ type: "text", text: message }], isError: true, text: message, structuredContent: undefined };
}

export function registerBrowserSource(): void {
	registerMcpSource({ id: "browser", listMcpNamespaces, callMcpTool, readMcpResource });
}
