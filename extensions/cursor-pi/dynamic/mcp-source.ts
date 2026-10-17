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
	// Names the source that registered it: "mcp" for the MCP client, "browser" for the browser.
	id: string;
	listMcpNamespaces(cwd: string, signal?: AbortSignal): Promise<McpNamespace[]>;
	callMcpTool(namespace: string, toolName: string, args: unknown, signal?: AbortSignal): Promise<McpCallResult>;
	readMcpResource(server: string, uri: string, signal?: AbortSignal): Promise<McpCallResult>;
}

let sources: McpSource[] = [];

// Adds a source; the MCP client and the browser each register one, and their namespace listings are merged.
export function registerMcpSource(next: McpSource): void {
	sources = [...sources, next];
}

// Every registered source's namespaces in registration order, each paired with the source that lists it.
export async function listOwnedMcpNamespaces(cwd: string, signal?: AbortSignal): Promise<{ source: McpSource; namespace: McpNamespace }[]> {
	const lists = await Promise.all(
		sources.map(async (source) => (await source.listMcpNamespaces(cwd, signal)).map((namespace) => ({ source, namespace }))),
	);
	return lists.flat();
}

export async function listMcpNamespaces(cwd: string, signal?: AbortSignal): Promise<McpNamespace[]> {
	return (await listOwnedMcpNamespaces(cwd, signal)).map((owned) => owned.namespace);
}
