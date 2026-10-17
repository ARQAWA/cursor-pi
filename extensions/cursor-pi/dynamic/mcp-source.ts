// The MCP side of the dynamic namespaces, with the shapes McpWriter's mcp/index.ts exports. tools/get-dynamic-tools.ts
// registers the module's functions here at extension load; checks register test doubles.
export type McpServerStatus = "ready" | "loading" | "needsAuth" | "error";

export interface McpToolDefinition {
	name: string;
	description: string | undefined;
	inputSchema: object;
	annotations: object | undefined;
}

export interface McpNamespace {
	name: string;
	status: McpServerStatus;
	// Cursor's serverError text for a namespace that is not ready; undefined when it is ready.
	error: string | undefined;
	instructions: string | undefined;
	tools: McpToolDefinition[];
}

export type McpContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface McpCallResult {
	content: McpContentBlock[];
	isError: boolean;
	text: string;
	structuredContent: object | undefined;
}

export interface McpSource {
	listMcpNamespaces(cwd: string, signal?: AbortSignal): Promise<McpNamespace[]>;
	callMcpTool(namespace: string, toolName: string, args: unknown, signal?: AbortSignal): Promise<McpCallResult>;
	readMcpResource(server: string, uri: string, signal?: AbortSignal): Promise<McpCallResult>;
}

let source: McpSource | undefined;

export function registerMcpSource(next: McpSource): void {
	source = next;
}

export function mcpSource(): McpSource | undefined {
	return source;
}
