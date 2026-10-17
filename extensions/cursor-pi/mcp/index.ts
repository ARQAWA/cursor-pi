// MCP for the dynamic tool layer: namespaces (listing connects the servers), tool calls and resource reads. A session keeps one
// manager per workspace, so listMcpNamespaces must run before callMcpTool or readMcpResource for that workspace.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { McpManager } from "./manager.ts";
import { openBrowser } from "./oauth.ts";
import type { McpApprovalRequest, McpCallResult, McpHooks, McpNamespace } from "./types.ts";

export type {
	McpApprovalRequest,
	McpCallResult,
	McpContentBlock,
	McpHooks,
	McpNamespace,
	McpServerStatus,
	McpToolDefinition,
} from "./types.ts";

let session: { workspace: string; manager: McpManager } | undefined;
// Read by each manager when it is used, so the host can set these at any time.
const hooks: McpHooks = { approvalPrompt: undefined, openUrl: openBrowser };

// Cursor's approval step for an unapproved server: the host asks the user and returns true to run it. Without a prompt, such
// servers are skipped.
export function setMcpApprovalPrompt(prompt: ((request: McpApprovalRequest) => Promise<boolean>) | undefined): void {
	hooks.approvalPrompt = prompt;
}

// Replaces how the sign-in page is opened (the platform browser by default).
export function setMcpBrowserOpener(open: ((url: string) => void) | undefined): void {
	hooks.openUrl = open ?? openBrowser;
}

// Approvals, disabled servers, the OAuth token file and the state live here; Cursor keeps the same files under its agent store.
export function mcpStateDir(): string {
	return join(homedir(), ".cursor-pi", "mcp");
}

function requireManager(): McpManager {
	if (session === undefined) throw new Error("MCP namespaces have not been listed for this workspace");
	return session.manager;
}

export async function listMcpNamespaces(cwd: string, signal?: AbortSignal): Promise<McpNamespace[]> {
	signal?.throwIfAborted();
	const workspace = resolve(cwd);
	if (session?.workspace !== workspace) {
		const previous = session;
		session = { workspace, manager: new McpManager(workspace, mcpStateDir(), homedir(), hooks) };
		await previous?.manager.close();
	}
	await session.manager.load();
	return session.manager.namespaces();
}

export function callMcpTool(
	namespace: string,
	toolName: string,
	args: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<McpCallResult> {
	return requireManager().callTool(namespace, toolName, args, signal);
}

export function readMcpResource(server: string, uri: string, signal?: AbortSignal): Promise<McpCallResult> {
	return requireManager().readResource(server, uri, signal);
}

export function listMcpLoadFailures(): { identifier: string; message: string }[] {
	return session?.manager.loadFailures() ?? [];
}

export async function closeMcp(): Promise<void> {
	const current = session;
	session = undefined;
	await current?.manager.close();
}
