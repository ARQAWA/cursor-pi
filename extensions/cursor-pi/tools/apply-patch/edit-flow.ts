// ApplyPatch's edit flow as Cursor's apply-patch.js runs it: which path a patch takes, the message each failure
// produces, and what is written. File access is injected through PatchIO.
// The model sees only the message of a thrown error, with "Error: " in front: Cursor's ApplyPatch serializer copies
// error.message and no modelVisibleError, so the longer "There was an error applying the patch" texts never reach it.

import { EOF_MARKER, PATCH_PREFIX, PATCH_SUFFIX, PatchParser } from "./codex-parser.ts";
import { withFileLock } from "../file-locks.ts";

// A read result with the cases of Cursor's ReadResult. "content" carries the decoded text.
export type PatchRead =
	| { kind: "content"; text: string; truncated: boolean; fileSize: bigint }
	| { kind: "binary" }
	| { kind: "notFound" }
	| { kind: "permissionDenied" }
	| { kind: "invalidFile"; reason: string }
	| { kind: "error"; message: string }
	| { kind: "rejected"; reason: string };

// A write result with the cases of Cursor's WriteResult.
export type PatchWrite =
	| { kind: "success" }
	| { kind: "permissionDenied"; error?: string }
	| { kind: "noSpace" }
	| { kind: "rejected"; reason: string }
	| { kind: "error"; message: string };

export interface PatchIO {
	read(path: string): Promise<PatchRead>;
	write(path: string, content: string): Promise<PatchWrite>;
}

export interface PatchToolResult {
	text: string;
	isError: boolean;
}

// A failure whose message the model sees.
class PatchToolError extends Error {}

// The target does not exist, so the patch is applied to empty text and creates the file.
class FileMissing extends Error {}

export async function runApplyPatch(rawInput: string, io: PatchIO, signal?: AbortSignal): Promise<PatchToolResult> {
	try {
		return { text: await applyPatchText(rawInput, io, signal), isError: false };
	} catch (error) {
		return { text: `Error: ${messageOf(error)}`, isError: true };
	}
}

async function applyPatchText(rawInput: string, io: PatchIO, signal: AbortSignal | undefined): Promise<string> {
	const patch = normalizeLineEndings(unwrapFunctionToolPatch(rawInput).trim(), "\n");
	const path = inferFilePathFromPatch(patch);
	if (path === undefined) throw new PatchToolError("Missing *** Add/Update File header.");
	return withFileLock(path, signal, async () => {
		try {
			return await editExistingFile(patch, path, io);
		} catch (error) {
			if (!(error instanceof FileMissing)) throw error;
			return await createFile(patch, path, io);
		}
	});
}

async function editExistingFile(patch: string, path: string, io: PatchIO): Promise<string> {
	const original = contentOf(await callIo(() => io.read(path)), path);
	const { modified, resultForModel } = transformFile(patch, original.replace(/\r\n/g, "\n"), path);
	assertWritten(await callIo(() => io.write(path, modified)), path);
	return resultForModel;
}

async function createFile(patch: string, path: string, io: PatchIO): Promise<string> {
	const modified = newFileText(patch);
	assertWritten(await callIo(() => io.write(path, modified)), path);
	return `Success. Updated the following files:\nA ${path}`;
}

// Cursor's transform for an existing file. performEdit has already replaced CRLF with LF, so the line ending
// test below sees LF only.
function transformFile(patch: string, original: string, path: string): { modified: string; resultForModel: string } {
	try {
		const text = normalizeLineEndings(original, "\n");
		const parser = new PatchParser(patchLines(patch));
		parser.index = 1;
		const chunks = parser.parse(text);
		const eol = original.includes("\r\n") ? "\r\n" : "\n";
		const { newLines, hasChunks } = parser.apply(text, chunks);
		return {
			modified: normalizeLineEndings(newLines.join("\n"), eol),
			resultForModel: hasChunks ? `The file ${path} has been updated.` : "No changes to the file were made.",
		};
	} catch (error) {
		throw new PatchToolError(messageOf(error));
	}
}

// Cursor's path for a missing file: the same patch parsed against empty text.
function newFileText(patch: string): string {
	try {
		const parser = new PatchParser(patchLines(patch));
		parser.index = 1;
		const chunks = parser.parse("");
		return parser.apply("", chunks).newLines.join("\n");
	} catch (error) {
		throw new PatchToolError(messageOf(error));
	}
}

// The envelope check and header removal that both paths share.
function patchLines(patch: string): string[] {
	const lines = patch.split("\n");
	if (lines[0].includes(EOF_MARKER)) lines.splice(0, 1);
	if (lines[lines.length - 1].includes(EOF_MARKER)) lines.splice(lines.length - 1, 1);
	if (lines.length < 2 || !lines[0]?.startsWith(PATCH_PREFIX) || !lines[lines.length - 1]?.startsWith(PATCH_SUFFIX)) {
		throw new PatchToolError(`Invalid patch format. Your diff must begin with ${PATCH_PREFIX} and end with ${PATCH_SUFFIX}.`);
	}
	if (lines[1]?.startsWith("*** Update File") || lines[1]?.startsWith("*** Add File")) lines.splice(1, 1);
	return lines;
}

function contentOf(read: PatchRead, path: string): string {
	switch (read.kind) {
		case "content":
			if (read.truncated) {
				const size = read.fileSize > BigInt(0) ? ` (${read.fileSize} bytes)` : "";
				throw new PatchToolError(`File is too large to edit${size}: ${path}`);
			}
			return read.text;
		case "binary":
			throw new PatchToolError("File is not a text file (binary data)");
		case "notFound":
			throw new FileMissing(path);
		case "permissionDenied":
			throw new PatchToolError(`Read permission denied: ${path}`);
		case "invalidFile":
			throw new PatchToolError(`${read.reason || "Path is not a valid file to read"}: ${path}`);
		case "error":
			if (read.message.includes("Unable to resolve nonexistent file")) throw new FileMissing(path);
			throw new PatchToolError(read.message);
		case "rejected":
			throw new PatchToolError(`Edit rejected: ${read.reason}`);
	}
}

function assertWritten(write: PatchWrite, path: string): void {
	switch (write.kind) {
		case "success":
			return;
		case "permissionDenied":
			throw new PatchToolError(`Write permission denied: ${path}${write.error ? `: ${write.error}` : ""}`);
		case "noSpace":
			throw new PatchToolError("No space left on device");
		case "rejected":
			throw new PatchToolError(`Edit rejected: ${write.reason}`);
		case "error":
			throw new PatchToolError(write.message);
	}
}

// Errors from the injected IO become model-visible messages, as Cursor's performEdit reports them.
async function callIo<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		throw new PatchToolError(messageOf(error));
	}
}

function normalizeLineEndings(text: string, eolSequence: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").join(eolSequence);
}

function unwrapFunctionToolPatch(rawText: string): string {
	const trimmed = rawText.trim();
	if (!trimmed.startsWith("{")) return rawText;
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return rawText;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return rawText;
	const keys = Object.keys(parsed);
	const patch = (parsed as { patch?: unknown }).patch;
	return keys.length === 1 && keys[0] === "patch" && typeof patch === "string" ? patch : rawText;
}

const PATCH_FILE_HEADER_REGEX = /^\*\*\* (?:Add|Update) File: (.+)$/;

function inferFilePathFromPatch(patch: string): string | undefined {
	const lines = patch.split("\n");
	lines.pop();
	for (const line of lines) {
		const headerMatch = PATCH_FILE_HEADER_REGEX.exec(line.trim());
		if (headerMatch !== null) {
			const candidate = headerMatch[1].trim();
			if (candidate.length > 0) return candidate;
		}
	}
	return undefined;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
