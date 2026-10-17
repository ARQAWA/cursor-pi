import { readFile, stat } from "node:fs/promises";
import type { AgentToolResult, ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { discoverCursorRules, type CursorRule } from "../rules.ts";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";
import { parseReadFileArgs, type ReadFileArgs } from "./read-file/args.ts";
import { decodeTextFile, FORMAT_HEADER_BYTES, formatForHeader, rememberEncoding } from "./read-file/encoding.ts";
import { ReadToolError } from "./read-file/errors.ts";
import { boundInlineImageForModel, imageMimeOfBytes, prepareImageForModel, undecodableImageReason } from "./read-file/image.ts";
import { computeReadSlice, formatReadCodeBlock, READ_CHAR_HARD_LIMIT, readTextRange, type ReadRange, type TextRead } from "./read-file/lines.ts";
import { formatNotebookForLLM } from "./read-file/notebook.ts";
import { isCursorIgnored, resolveReadPath, resolveRealPath } from "./read-file/paths.ts";
import { readPdfText } from "./read-file/pdf.ts";
import { relatedCursorRules, renderCursorRuleReminder, renderSkillReminder, type SkillReminder } from "./read-file/reminders.ts";
import { isAgentToolOutputFile, isTerminalFilePath, looksLikeKnownBinaryFormat, readTerminalFileText, TERMINAL_BINARY_REASON } from "./read-file/terminal.ts";

const READ_FILE = declaration("ReadFile");

// Cursor refuses these extensions before it reads the file; the check uses the path as the model wrote it.
const UNSUPPORTED_BINARY_EXTENSIONS = /\.(zip|tar|gz|exe|dll|so|dylib|bin|mp4|webm|mov|avi|mkv|wmv|flv|m4v)$/i;

// Cursor's read state for a conversation: the paths read so far, with the rule files reminded of.
const seenPathsBySession = new WeakMap<object, Set<string>>();
const seenPathsWithoutSession = new Set<string>();

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: READ_FILE.name,
		label: READ_FILE.name,
		description: READ_FILE.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeReadFile(params, signal, ctx),
	});
}

export async function executeReadFile(params: unknown, _signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<AgentToolResult<undefined>> {
	try {
		return await readPath(params, ctx);
	} catch (error) {
		// Cursor sends every failure back as result text, prefixed with "Error: ".
		return textResult(`Error: ${error instanceof Error ? error.message : String(error)}`, true);
	}
}

function textResult(text: string, isError = false): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined, isError };
}

// What loading a file produced. Images are finished results; text is rendered once the reminders are known.
type Loaded = { kind: "image"; result: AgentToolResult<undefined> } | { kind: "text"; read: TextRead; fileSize: number };

async function readPath(params: unknown, ctx: ExtensionToolContext): Promise<AgentToolResult<undefined>> {
	const args = parseReadFileArgs(params);
	const binary = UNSUPPORTED_BINARY_EXTENSIONS.exec(args.path);
	if (binary !== null) throw new ReadToolError(`Cannot read binary files of type ${extensionOf(args.path)}`);
	if (args.path.trim() === "") throw new ReadToolError("path is empty or only whitespace");
	const file = resolveReadPath(args.path, ctx.cwd);
	await assertReadable(file);
	const info = await statFile(file);
	if (info.isDirectory()) throw new ReadToolError(`Path is a directory, not a file: ${args.path}`);
	if (!info.isFile()) throw new ReadToolError(`Path is neither a file nor a directory: ${args.path}`);
	const loaded = await loadContent(await readBytes(file), args, file);
	// Cursor computes reminders only for a successful read of a path not seen before, then marks the path as read.
	const seen = seenPathsOf(ctx);
	const isNewPath = !seen.has(file);
	const relatedRules = isNewPath ? await relatedRulesFor(file, ctx, seen) : [];
	seen.add(file);
	if (loaded.kind === "image") return loaded.result;
	return renderTextRead(loaded.read, args, file, loaded.fileSize, relatedRules);
}

function seenPathsOf(ctx: ExtensionToolContext): Set<string> {
	const session: object | undefined = ctx.sessionManager;
	if (session === undefined) return seenPathsWithoutSession;
	let seen = seenPathsBySession.get(session);
	if (seen === undefined) {
		seen = new Set<string>();
		seenPathsBySession.set(session, seen);
	}
	return seen;
}

// The rules that a first read of this file reminds the model about. Discovery follows the same rules as the system prompt.
async function relatedRulesFor(file: string, ctx: ExtensionToolContext, seen: Set<string>): Promise<CursorRule[]> {
	const rules = await discoverCursorRules(ctx.cwd);
	if (rules.length === 0) return [];
	return relatedCursorRules({ rules, readPath: file, workspacePaths: [ctx.cwd], seen });
}

// Reads the file the way Cursor's executor does: terminal and agent-tool captures, images, PDFs, binary rejection, text.
async function loadContent(bytes: Buffer, args: ReadFileArgs, file: string): Promise<Loaded> {
	if (isTerminalFilePath(file) || isAgentToolOutputFile(file)) {
		if (!isTerminalFilePath(file) && looksLikeKnownBinaryFormat(bytes)) throw new ReadToolError(`${TERMINAL_BINARY_REASON}: ${args.path}`);
		return { kind: "text", read: readTerminalFileText(bytes, args.offset, args.limit), fileSize: bytes.length };
	}
	const format = formatForHeader(bytes.subarray(0, FORMAT_HEADER_BYTES));
	if (format.isImageFile && !isPdfPath(file)) {
		return { kind: "image", result: await imageResult(bytes, file, args.path) };
	}
	if (isPdfPath(file)) {
		const text = await readPdfText(file, bytes);
		return { kind: "text", read: { content: text, totalLines: 0, rangeApplied: false }, fileSize: bytes.length };
	}
	if (format.isBinaryFile) throw new ReadToolError(`File content is binary data, not text: ${args.path}`);
	const decoded = decodeTextFile(bytes, format, file);
	rememberEncoding(file, decoded.encoding);
	return { kind: "text", read: readTextRange(decoded.text, args.offset, args.limit), fileSize: bytes.length };
}

function extensionOf(path: string): string {
	return path.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? "unknown";
}

function isPdfPath(file: string): boolean {
	return /\.pdf$/i.test(file);
}

// Cursor's permission gate for a file read: a path whose real location is ignored by .cursorignore is denied.
async function assertReadable(file: string): Promise<void> {
	const real = await resolveRealPath(file);
	if (real === null || (await isCursorIgnored(real))) throw new ReadToolError("Permission denied");
}

async function statFile(file: string) {
	try {
		return await stat(file);
	} catch (error) {
		throw fileSystemError(error);
	}
}

async function readBytes(file: string): Promise<Buffer> {
	try {
		return await readFile(file);
	} catch (error) {
		throw fileSystemError(error);
	}
}

function fileSystemError(error: unknown): ReadToolError {
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "ENOENT") return new ReadToolError("File not found");
	if (code === "EACCES" || code === "EPERM") return new ReadToolError("Permission denied");
	return new ReadToolError(error instanceof Error ? error.message : "Unknown error occurred");
}

// Cursor returns the image with its "Read image file" line. The executor's bytes go through the second bounding pass
// the read tool applies before the model sees them.
async function imageResult(bytes: Buffer, file: string, rawPath: string): Promise<AgentToolResult<undefined>> {
	const prepared = await prepareImageForModel(bytes);
	if (prepared.kind === "undecodable") throw new ReadToolError(`${undecodableImageReason(prepared.reason)}: ${rawPath}`);
	const data = await boundInlineImageForModel(prepared.image.data);
	const mimeType = imageMimeOfBytes(data) ?? prepared.image.mimeType;
	return {
		content: [
			{ type: "text", text: `Read image file: ${file}` },
			{ type: "image", data: data.toString("base64"), mimeType },
		],
		details: undefined,
		isError: false,
	};
}

// Cursor's read result for text: an empty file, a range read with the lines it selects, or a result too long to send.
// Reminders are appended to content results only, after the formatted lines.
function renderTextRead(read: TextRead, args: ReadFileArgs, file: string, fileSize: number, relatedRules: CursorRule[]): AgentToolResult<undefined> {
	if (read.content === "" && !read.rangeApplied) return textResult("File is empty.");
	let content = read.content;
	let totalLines = read.totalLines;
	let readRange: ReadRange;
	if (read.rangeApplied) {
		readRange = computeReadSlice(totalLines, args.offset, args.limit)?.readRange ?? { startLine: 1, endLine: totalLines };
	} else {
		const lines = content.split("\n");
		totalLines = lines.length;
		const slice = computeReadSlice(totalLines, args.offset, args.limit);
		if (slice !== undefined) {
			content = lines.slice(slice.start, slice.end).join("\n");
			readRange = slice.readRange;
		} else {
			readRange = { startLine: 1, endLine: totalLines };
		}
	}
	if (content.length > READ_CHAR_HARD_LIMIT) {
		return textResult(
			`Requested content exceeds maximum allowed characters (${READ_CHAR_HARD_LIMIT} characters). The file is ${fileSize} bytes.\nPlease use offset and limit parameters to read specific portions of the file, or use the 'grep' tool to search for specific content.`,
			true,
		);
	}
	const body = file.endsWith(".ipynb") ? formatNotebookForLLM(content) : formatReadCodeBlock(content, readRange, totalLines);
	return textResult(withReminders(body, relatedRules));
}

// Cursor's reminder order: the cursor rules, then the skills, each after a blank line.
function withReminders(body: string, relatedRules: CursorRule[]): string {
	let content = body;
	const rules = renderCursorRuleReminder(relatedRules);
	if (rules !== undefined) content = `${content}\n\n${rules}`;
	// No skills are discovered yet, so the list stays empty and the skill reminder is not rendered.
	const relatedSkills: SkillReminder[] = [];
	const skills = renderSkillReminder(relatedSkills);
	if (skills !== undefined) content = `${content}\n\n${skills}`;
	return content;
}
