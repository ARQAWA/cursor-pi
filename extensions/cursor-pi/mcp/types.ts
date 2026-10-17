// Public shapes of the MCP client. Statuses are the namespaceStatus values Cursor shows to the model (get-mcp-tools.js).
import type { McpServerConfig } from "./config.ts";

export type McpServerStatus = "ready" | "loading" | "needsAuth" | "error";

export interface McpToolDefinition {
	name: string;
	description: string | undefined;
	inputSchema: Record<string, unknown>;
	annotations: Record<string, unknown> | undefined;
}

export interface McpNamespace {
	name: string;
	status: McpServerStatus;
	error: string | undefined;
	instructions: string | undefined;
	tools: McpToolDefinition[];
}

export type McpContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface McpCallResult {
	content: McpContentBlock[];
	isError: boolean;
	text: string;
	structuredContent: Record<string, unknown> | undefined;
}

// Asked of the host before an unapproved server runs: the server's name, its config file and its definition.
export interface McpApprovalRequest {
	name: string;
	configPath: string;
	server: McpServerConfig;
}

// Host hooks, read when used: the approval prompt (absent without a UI, so unapproved servers are skipped) and the browser opener.
export interface McpHooks {
	approvalPrompt: ((request: McpApprovalRequest) => Promise<boolean>) | undefined;
	openUrl: (url: string) => void;
}
