// The edit flow behind StrReplace and Write, as Cursor's edit tools run it: performEdit's read and write steps, runSingleEdit's
// matching, and the text each failure leaves for the model. File access goes through the ApplyPatch local adapter, and each
// call holds the shared per-path lock.
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { PatchIO } from "../apply-patch/edit-flow.ts";
import { createLocalPatchIO } from "../apply-patch/local-io.ts";
import { type ArgIssue, type ArgType, checkType, invalidArguments } from "../cursor-args.ts";
import { withFileLock } from "../file-locks.ts";

export interface EditToolResult {
	text: string;
	isError: boolean;
}

export interface StrReplaceArgs {
	path: string;
	old_string: string;
	new_string: string;
	replace_all?: boolean;
}

export interface WriteArgs {
	path: string;
	contents: string;
}

// The text a failed edit leaves for the model, already rendered the way Cursor renders its edit results.
export class EditFailure extends Error {
	readonly text: string;

	constructor(text: string) {
		super(text);
		this.text = text;
	}
}

// Cursor's tool-call errors with a model message reach the model as "Error: " followed by that message.
function modelError(message: string): EditFailure {
	return new EditFailure(`Error: ${message}`);
}

export function localEditIO(ctx: ExtensionToolContext): PatchIO {
	return createLocalPatchIO({
		workspace: ctx.cwd,
		approve: (title, message) => (ctx.hasUI ? ctx.ui.confirm(title, message) : Promise.resolve(false)),
	});
}

export function toolResult({ text, isError }: EditToolResult) {
	return { content: [{ type: "text" as const, text }], details: undefined, isError };
}

// Cursor's edit-tool argument parse: zod's safeParse of the object, each issue as "path: message" under "Invalid arguments:".
// The model reads a failed parse as "Error: " followed by that text. Required fields are checked before optional ones.
export function parseEditArgs(
	params: unknown,
	required: Record<string, ArgType>,
	optional: Record<string, ArgType>,
): { args: Record<string, unknown> } | { failure: EditToolResult } {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { failure: argsFailure(issues) };
	const record = params as Record<string, unknown>;
	for (const [field, type] of Object.entries(required)) checkType(record[field], type, [field], issues);
	for (const [field, type] of Object.entries(optional)) {
		if (record[field] !== undefined) checkType(record[field], type, [field], issues);
	}
	return issues.length > 0 ? { failure: argsFailure(issues) } : { args: record };
}

function argsFailure(issues: ArgIssue[]): EditToolResult {
	return { text: `Error: ${invalidArguments(issues)}`, isError: true };
}

export async function runStrReplace(args: StrReplaceArgs, io: PatchIO, signal?: AbortSignal): Promise<EditToolResult> {
	return withFileLock(args.path, signal, () =>
		attempt(async () => {
			const original = await readForEdit(io, args.path);
			const edit = applySingleEdit(original.replace(/\r\n/g, "\n"), args.old_string, args.new_string, args.replace_all === true);
			return writeEdited(io, args.path, edit.contents, replacedMessage(args.path, args.replace_all, edit.occurrences));
		}),
	);
}

export async function runWrite(args: WriteArgs, io: PatchIO, signal?: AbortSignal): Promise<EditToolResult> {
	return withFileLock(args.path, signal, () =>
		attempt(async () => {
			await readForWrite(io, args.path);
			return writeEdited(io, args.path, args.contents, `Wrote contents to ${args.path}`);
		}),
	);
}

async function attempt(run: () => Promise<string>): Promise<EditToolResult> {
	try {
		return { text: await run(), isError: false };
	} catch (error) {
		if (error instanceof EditFailure) return { text: error.text, isError: true };
		throw error;
	}
}

// performEdit's read: the file's text, or the failure the model sees.
async function readForEdit(io: PatchIO, path: string): Promise<string> {
	const read = await io.read(path);
	switch (read.kind) {
		case "content":
			if (read.truncated) {
				const size = read.fileSize > BigInt(0) ? ` (${read.fileSize} bytes)` : "";
				throw modelError(`File is too large to edit${size}: only part of it could be read, so writing the edit would truncate it. Edit it with a shell command instead.`);
			}
			return read.text;
		case "binary":
			throw modelError("File is not a text file (binary data)");
		case "notFound":
			throw new EditFailure(`File not found: ${path}`);
		case "permissionDenied":
			throw new EditFailure(`Read permission denied: ${path}`);
		case "invalidFile":
			throw modelError(`${read.reason || "Path is not a valid file to read"}: ${path}`);
		case "error":
			if (read.message.includes("Unable to resolve nonexistent file")) throw new EditFailure(`File not found: ${path}`);
			throw modelError(read.message);
		case "rejected":
			throw new EditFailure(`Rejected: ${read.reason}`);
	}
}

// Write's read: Write replaces whatever is at the path, so only the failures matter.
async function readForWrite(io: PatchIO, path: string): Promise<void> {
	const read = await io.read(path);
	switch (read.kind) {
		case "content":
		case "notFound":
			return;
		case "binary":
			throw modelError("File is not a text file (binary data)");
		case "permissionDenied":
			throw new EditFailure(`Read permission denied: ${path}`);
		case "invalidFile":
			throw modelError(`${read.reason || "Path is not a valid file to read"}: ${path}`);
		case "error":
			throw modelError(read.message);
		case "rejected":
			throw new EditFailure(`Rejected: ${read.reason}`);
	}
}

// performWrite: the result text on success, or the failure the model sees.
async function writeEdited(io: PatchIO, path: string, contents: string, resultForModel: string): Promise<string> {
	const write = await io.write(path, contents);
	switch (write.kind) {
		case "success":
			return resultForModel;
		case "permissionDenied":
			throw new EditFailure(`Write permission denied: ${path}${write.error ? `: ${write.error}` : ""}`);
		case "noSpace":
			throw modelError("No space left on device");
		case "rejected":
			throw new EditFailure(`Rejected: ${write.reason}`);
		case "error":
			throw modelError(write.message);
	}
}

function replacedMessage(path: string, replaceAll: boolean | undefined, occurrences: number): string {
	if (replaceAll !== true) return `The file ${path} has been updated.`;
	const label = occurrences === 1 ? "occurrence" : "occurrences";
	const verb = occurrences === 1 ? "has" : "have";
	return `${occurrences} ${label} in file ${path} ${verb} been updated.`;
}

interface Match {
	start: number;
	end: number;
}

interface SingleEdit {
	contents: string;
	occurrences: number;
}

// Cursor's runSingleEdit on LF text: the matches for old_string, checked for ambiguity, then replaced.
function applySingleEdit(contents: string, oldRaw: string, newRaw: string, replaceAll: boolean): SingleEdit {
	if (oldRaw === "") throw modelError("old_string is empty");
	const oldString = normalizeEol(oldRaw);
	const newString = normalizeEol(newRaw);
	if (oldString === newString) throw modelError("old_string and new_string are exactly the same");
	const { matches, usedWhitespaceInsensitive } = findMatches(contents, oldString);
	if (matches.length === 0) {
		const fuzzy = closestFuzzyMatch(oldString, contents.split("\n"));
		const fuzzyMessage = fuzzy === undefined ? "" : ` Found a possible fuzzy match, did you mean:\n${numberLines(fuzzy.text, fuzzy.startLine)}`;
		throw modelError(`The string to replace was not found in the file${usedWhitespaceInsensitive ? " (even after relaxing whitespace)" : ""}.${fuzzyMessage}`);
	}
	if (matches.length > 1 && !replaceAll) {
		throw modelError(
			`The string to replace was found multiple times in the file${usedWhitespaceInsensitive ? " after relaxing whitespace" : ""}. Use replace_all to replace all occurrences, or include more context to only edit one occurrence.`,
		);
	}
	if (!replaceAll && !usedWhitespaceInsensitive && contents.indexOf(oldString, matches[0].start + 1) !== -1) {
		throw modelError(
			"The string to replace was found at more than one place in the file, and those places overlap, so replace_all would edit only the first. Include more context to only edit one occurrence.",
		);
	}
	return { contents: replaceAllMatches(contents, matches, newString), occurrences: matches.length };
}

function normalizeEol(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function findMatches(text: string, search: string): { matches: Match[]; usedWhitespaceInsensitive: boolean } {
	if (text === "") {
		return search === "" ? { matches: [{ start: 0, end: 0 }], usedWhitespaceInsensitive: false } : { matches: [], usedWhitespaceInsensitive: false };
	}
	if (search === "") return { matches: [], usedWhitespaceInsensitive: false };
	const matches: Match[] = [];
	let position = 0;
	for (;;) {
		position = text.indexOf(search, position);
		if (position === -1) break;
		matches.push({ start: position, end: position + search.length });
		position += search.length;
	}
	if (matches.length > 0) return { matches, usedWhitespaceInsensitive: false };
	return { matches: findIgnoringWhitespace(search, text), usedWhitespaceInsensitive: true };
}

// Cursor's whitespace-insensitive search: a match starts and ends on lines whose trimmed text equals the trimmed search lines.
// The first and last search lines may match only a suffix or a prefix of their file line.
function findIgnoringWhitespace(needleText: string, haystack: string): Match[] {
	const needleLines = needleText.split("\n").map((line) => line.trim());
	const hayLines = haystack.split("\n");
	const trimmedHay = hayLines.map((line) => line.trim());
	const lineStarts: number[] = [];
	let running = 0;
	for (const line of hayLines) {
		lineStarts.push(running);
		running += line.length + 1;
	}
	const hits: Match[] = [];
	outer: for (let startLine = 0; startLine <= hayLines.length - needleLines.length; startLine++) {
		let startChar = 0;
		let endChar = 0;
		for (let index = 0; index < needleLines.length; index++) {
			const needle = needleLines[index];
			const trimmed = trimmedHay[startLine + index];
			const untrimmed = hayLines[startLine + index];
			const isFirst = index === 0;
			const isLast = index === needleLines.length - 1;
			let linesMatch = trimmed === needle;
			if (isFirst) {
				linesMatch = trimmed.endsWith(needle);
				if (linesMatch) {
					startChar = untrimmed.lastIndexOf(needle);
					if (trimmed === needle) startChar = 0;
				}
			}
			if (isLast) {
				if (isFirst && linesMatch && trimmed !== needle) continue outer;
				linesMatch = trimmed.startsWith(needle);
				if (linesMatch) {
					endChar = untrimmed.indexOf(needle) + needle.length;
					if (trimmed === needle) endChar = untrimmed.length;
				}
			}
			if (!linesMatch) continue outer;
		}
		const endLine = startLine + needleLines.length - 1;
		hits.push({ start: lineStarts[startLine] + startChar, end: lineStarts[endLine] + endChar });
	}
	return hits;
}

// Cursor's replaceAllMatches: the matches are replaced from the last one back, so earlier offsets stay valid.
function replaceAllMatches(text: string, matches: Match[], newString: string): string {
	let result = text;
	const ordered = [...matches].sort((a, b) => b.start - a.start);
	for (const match of ordered) {
		let start = match.start;
		let end = match.end;
		if (newString === "") {
			const lineStart = result.lastIndexOf("\n", start - 1) + 1;
			if (/^\s*$/.test(result.slice(lineStart, start))) start = lineStart;
			const nextNewline = result.indexOf("\n", end);
			if (nextNewline !== -1 && /^\s*$/.test(result.slice(end, nextNewline))) end = nextNewline + 1;
			if (nextNewline === -1 && /^\s*$/.test(result.slice(end))) {
				end = result.length;
				if (start > 0 && result.charCodeAt(start - 1) === 10) {
					start -= 1;
					if (start > 0 && result.charCodeAt(start - 1) === 13) start -= 1;
				}
			}
		}
		result = result.slice(0, start) + newString + result.slice(end);
	}
	return result;
}

// Cursor's closest fuzzy match: the file lines around the longest search line, or around a token of it.
function closestFuzzyMatch(search: string, fileLines: string[]): { text: string; startLine: number } | undefined {
	const lines = search
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (lines.length === 0) return undefined;
	const anchor = [...lines].sort((a, b) => b.length - a.length)[0];
	let anchorIndex = fileLines.findIndex((line) => line.trim().includes(anchor));
	if (anchorIndex === -1) {
		const tokens = anchor.split(/\s+/).filter((token) => token.length > 2);
		anchorIndex = fileLines.findIndex((line) => tokens.some((token) => line.trim().includes(token)));
	}
	if (anchorIndex === -1) return undefined;
	const contextBefore = 2;
	const startLine = Math.max(1, anchorIndex + 1 - contextBefore);
	const desiredSpan = Math.max(lines.length, 1) + 2 * contextBefore;
	const endLine = Math.min(fileLines.length, startLine + desiredSpan - 1);
	return { text: fileLines.slice(startLine - 1, endLine).join("\n"), startLine };
}

// Cursor's default line numbers: the number padded to six columns, then a bar and the line.
function numberLines(text: string, startLine: number): string {
	return text
		.split("\n")
		.map((line, index) => `${String(startLine + index).padStart(6, " ")}|${line}`)
		.join("\n");
}
