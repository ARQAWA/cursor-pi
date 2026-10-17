import { stat, unlink } from "node:fs/promises";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { blockForWrite, deleteApprovalPrompt, resolvePath } from "../apply-patch/local-policy.ts";
import { type ArgIssue, checkType, invalidArguments } from "../cursor-args.ts";
import { withFileLock } from "../file-locks.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";

// Cursor's Delete (agent/dist/tools/core/delete.js and local-exec/dist/delete.js), for the cursor namespace.
const NAMESPACE = "cursor";
const DELETE = capturedNamespaceDeclaration("Delete");
// Cursor's BLANK_PATH_ERROR.
const BLANK_PATH_ERROR = "path is empty or only whitespace";
// Cursor's text when the file is swapped between the stat and the unlink.
const CHANGED_WHILE_DELETING = "File changed while deleting; nothing was removed";

// The executor's result before Cursor's agent layer turns it into the model's text.
export type DeleteOutcome =
	| { case: "success"; path: string; fileSize: number }
	| { case: "fileNotFound"; path: string }
	| { case: "notFile"; path: string; actualType: "directory" | "other" }
	| { case: "permissionDenied"; path: string }
	| { case: "fileBusy"; path: string }
	| { case: "rejected" }
	| { case: "error"; path: string; error: string };

export function register(): void {
	registerDynamicTool({ namespace: NAMESPACE, declaration: DELETE, conciseInstructions: capturedConciseInstruction(DELETE.name), execute: executeDelete });
}

// Argument errors come from Cursor's zod parse before the tool runs, so they are errors; every outcome is a rendered result.
export async function executeDelete(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { text: invalidArguments(issues), isError: true };
	const path = (params as Record<string, unknown>).path;
	if (!checkType(path, "string", ["path"], issues)) return { text: invalidArguments(issues), isError: true };
	// Cursor's Delete holds the path's file lock from the argument check until the call ends, approval included.
	const outcome = await withFileLock(path as string, signal, () => deleteFile(path as string, ctx.cwd, (title, message) => (ctx.hasUI ? ctx.ui.confirm(title, message) : Promise.resolve(false))));
	return { text: renderDeleteOutcome(outcome), isError: false };
}

// The model's text for an outcome. Cursor's agent layer rethrows the executor's failures as generic errors with no path, so
// those read "Error deleting file : <message>"; a rejection reads "File deletion rejected: <reason>", whose reason defaults to
// the same words.
export function renderDeleteOutcome(outcome: DeleteOutcome): string {
	switch (outcome.case) {
		case "success":
			return `Successfully deleted file: ${outcome.path} (${outcome.fileSize} bytes)`;
		case "fileNotFound":
			return `Error deleting file : File not found: ${outcome.path}`;
		case "notFile":
			return `Error deleting file : Path is not a file (${outcome.actualType}): ${outcome.path}`;
		case "permissionDenied":
			return `Permission denied: ${outcome.path}`;
		case "fileBusy":
			return `Error deleting file : File is busy: ${outcome.path}`;
		case "rejected":
			return "File deletion rejected: File deletion rejected";
		case "error":
			return `Error deleting file : Error deleting file ${outcome.path}: ${outcome.error}`;
	}
}

// Cursor's LocalDeleteExecutor: a blank path fails, the write policy's denials refuse, and every other delete asks once for
// approval before stat, the changed-file check and unlink. The file's previous content is not kept: Pi has no file state.
export async function deleteFile(path: string, workspace: string, approve: (title: string, message: string) => Promise<boolean>): Promise<DeleteOutcome> {
	if (path.trim() === "") return { case: "error", path, error: BLANK_PATH_ERROR };
	const resolvedPath = resolvePath(path, workspace);
	const block = await blockForWrite(resolvedPath, workspace);
	// A needsApproval block goes on to the approval below; the other blocks deny the delete.
	if (block !== undefined && block.type !== "needsApproval") return { case: "permissionDenied", path: resolvedPath };
	const prompt = deleteApprovalPrompt(resolvedPath);
	if (!(await approve(prompt.title, prompt.message))) return { case: "rejected" };
	let stats;
	try {
		stats = await stat(resolvedPath);
	} catch (error) {
		if (codeOf(error) === "ENOENT") return { case: "fileNotFound", path: resolvedPath };
		return { case: "error", path: resolvedPath, error: messageOf(error) };
	}
	if (!stats.isFile()) return { case: "notFile", path: resolvedPath, actualType: stats.isDirectory() ? "directory" : "other" };
	const current = await stat(resolvedPath).catch(() => undefined);
	if (current?.dev !== stats.dev || current.ino !== stats.ino) return { case: "error", path: resolvedPath, error: CHANGED_WHILE_DELETING };
	try {
		await unlink(resolvedPath);
	} catch (error) {
		if (codeOf(error) === "EACCES") return { case: "permissionDenied", path: resolvedPath };
		if (codeOf(error) === "EBUSY") return { case: "fileBusy", path: resolvedPath };
		return { case: "error", path: resolvedPath, error: messageOf(error) };
	}
	return { case: "success", path: resolvedPath, fileSize: stats.size };
}

function codeOf(error: unknown): unknown {
	return (error as { code?: unknown } | undefined)?.code;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
