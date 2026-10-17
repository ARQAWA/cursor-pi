import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const BUNDLED_RIPGREP = "/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg";

// Cursor names a project folder after the workspace path: each run of characters outside [A-Za-z0-9] becomes one dash.
export function slugifyPath(path: string): string {
	return path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Cursor keeps these folders under ~/.cursor; Pi keeps the same layout under ~/.cursor-pi.
export function projectDirFor(workspacePath: string): string {
	return join(homedir(), ".cursor-pi", "projects", slugifyPath(workspacePath));
}

export function terminalsDirFor(projectDir: string): string {
	return join(projectDir, "terminals");
}

export function agentToolsDirFor(projectDir: string): string {
	return join(projectDir, "agent-tools");
}

export function transcriptsDirFor(projectDir: string): string {
	return join(projectDir, "agent-transcripts");
}

// Cursor's resolution: expand a leading ~, then resolve a relative path against the workspace.
export function resolveWorkspacePath(path: string, workspacePath: string): string {
	const expanded = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
	return isAbsolute(expanded) ? expanded : resolve(workspacePath, expanded);
}

export function ripgrepPath(): string | undefined {
	return existsSync(BUNDLED_RIPGREP) ? BUNDLED_RIPGREP : undefined;
}
