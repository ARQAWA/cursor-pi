// Disabled servers and approvals, stored as Cursor's headless lease stores them: mcp-disabled.json and mcp-approvals.json,
// with the approval key of ServerApprovalMiddleware (approval-store.js). A server that is disabled or unapproved is skipped
// silently, as Cursor skips it.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "./config.ts";

export function mcpApprovalKey(serverName: string, server: McpServerConfig, approvalRoot: string): string {
	const hash = createHash("sha256").update(JSON.stringify({ path: approvalRoot, server })).digest("hex").substring(0, 16);
	return `${serverName}-${hash}`;
}

async function readJsonFile(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function isMcpServerDisabled(stateDir: string, serverName: string): Promise<boolean> {
	const path = join(stateDir, "mcp-disabled.json");
	const disabled = await readJsonFile(path);
	if (disabled === undefined) return false;
	if (!Array.isArray(disabled) || !disabled.every((value) => typeof value === "string")) {
		throw new Error(`Invalid MCP disabled-state file: ${path}`);
	}
	return disabled.includes(serverName);
}

async function readApprovals(stateDir: string): Promise<string[]> {
	const path = join(stateDir, "mcp-approvals.json");
	const parsed = await readJsonFile(path);
	if (parsed === undefined) return [];
	if (!Array.isArray(parsed)) {
		// Cursor rewrites a non-array approvals file as an empty list.
		await writeApprovals(stateDir, []);
		return [];
	}
	return parsed as string[];
}

async function writeApprovals(stateDir: string, approvals: string[]): Promise<void> {
	await mkdir(stateDir, { recursive: true });
	await writeFile(join(stateDir, "mcp-approvals.json"), JSON.stringify(approvals, null, 2));
}

export async function isMcpServerApproved(
	stateDir: string,
	serverName: string,
	server: McpServerConfig,
	approvalRoot: string,
): Promise<boolean> {
	return (await readApprovals(stateDir)).includes(mcpApprovalKey(serverName, server, approvalRoot));
}

export async function addMcpServerApproval(
	stateDir: string,
	serverName: string,
	server: McpServerConfig,
	approvalRoot: string,
): Promise<void> {
	const approvals = await readApprovals(stateDir);
	const key = mcpApprovalKey(serverName, server, approvalRoot);
	if (!approvals.includes(key)) await writeApprovals(stateDir, [...approvals, key]);
}
