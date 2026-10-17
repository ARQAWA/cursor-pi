import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import type { PatchIO, PatchRead, PatchWrite } from "../apply-patch/edit-flow.ts";
import { createLocalPatchIO } from "../apply-patch/local-io.ts";
import { type ArgIssue, checkType, invalidArguments, optionalLenientNumber } from "../cursor-args.ts";
import { withFileLock } from "../file-locks.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";

// Cursor's EditNotebook (agent/dist/tools/core/edit/edit-notebook.js): performEdit and runSingleEdit from edit/common.js and
// unified-diff-worker.js, and the notebook helpers from apply-patch.js and notebook-utils.js, for the cursor namespace.
const NAMESPACE = "cursor";
const EDIT_NOTEBOOK = capturedNamespaceDeclaration("EditNotebook");

type Path = ArgIssue["path"];

// The arguments after Cursor's zod parse.
export interface EditNotebookArgs {
	target: string;
	cellIdx: number;
	isNewCell: boolean;
	cellLanguage: string;
	oldString: string;
	newString: string;
}

const CELL_TYPES = ["code", "markdown", "raw"] as const;
type CellType = (typeof CELL_TYPES)[number];

interface NotebookOutput {
	output_type?: string;
	text?: string | string[];
	data?: Record<string, unknown>;
	ename?: string;
	evalue?: string;
	traceback?: string[];
}

interface NotebookCell {
	cell_type: CellType;
	metadata: Record<string, unknown>;
	source: string | string[];
	execution_count?: number | null;
	outputs?: NotebookOutput[];
	id?: string;
}

interface Notebook {
	cells: NotebookCell[];
	metadata: Record<string, unknown>;
	nbformat?: number;
	nbformat_minor?: number;
}

interface Match {
	start: number;
	end: number;
}

export function register(_pi: ExtensionAPI): void {
	registerDynamicTool({ namespace: NAMESPACE, declaration: EDIT_NOTEBOOK, conciseInstructions: capturedConciseInstruction(EDIT_NOTEBOOK.name), execute: executeEditNotebook });
}

// Cursor's withStreamingEditParsedArgs takes the lock on target_notebook as soon as the streamed arguments name it, before the
// rest are checked, and holds it to the end of the call.
export async function executeEditNotebook(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const target = (params as { target_notebook?: unknown } | null)?.target_notebook;
	if (typeof target !== "string") return runEditNotebookCall(params, ctx);
	return withFileLock(target, signal, () => runEditNotebookCall(params, ctx));
}

async function runEditNotebookCall(params: unknown, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const parsed = parseEditNotebookArgs(params);
	if (!parsed.ok) return { text: `Error: ${parsed.error}`, isError: true };
	const io = createLocalPatchIO({
		workspace: ctx.cwd,
		approve: (title, message) => (ctx.hasUI ? ctx.ui.confirm(title, message) : Promise.resolve(false)),
	});
	return runEditNotebook(parsed.args, io);
}

// Argument errors come from Cursor's zod parse before the tool runs; the streaming path renders them through serializeError,
// so the model reads them with the "Error: " prefix.
export function parseEditNotebookArgs(params: unknown): { ok: true; args: EditNotebookArgs } | { ok: false; error: string } {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { ok: false, error: invalidArguments(issues) };
	const fields = params as Record<string, unknown>;
	const target = readString(fields.target_notebook, ["target_notebook"], issues);
	const cellIdx = readLenientNumber(fields.cell_idx, ["cell_idx"], issues);
	const isNewCell = readLenientBoolean(fields.is_new_cell, ["is_new_cell"], issues);
	const cellLanguage = readString(fields.cell_language, ["cell_language"], issues);
	const oldString = readString(fields.old_string, ["old_string"], issues);
	const newString = readString(fields.new_string, ["new_string"], issues);
	if (issues.length > 0 || target === undefined || cellIdx === undefined || isNewCell === undefined || cellLanguage === undefined || oldString === undefined || newString === undefined) {
		return { ok: false, error: invalidArguments(issues) };
	}
	return { ok: true, args: { target, cellIdx, isNewCell, cellLanguage, oldString, newString } };
}

// Cursor's performEdit and its render: a failure is the text the model reads, and any other error reads "Error: <message>".
export async function runEditNotebook(args: EditNotebookArgs, io: PatchIO): Promise<NamespaceToolResult> {
	try {
		return { text: await performEdit(args, io), isError: false };
	} catch (error) {
		if (error instanceof EditFailure) return { text: error.modelText, isError: true };
		return { text: `Error: ${messageOf(error)}`, isError: true };
	}
}

// A failure whose text the model reads as it is.
class EditFailure extends Error {
	readonly modelText: string;

	constructor(modelText: string) {
		super(modelText);
		this.modelText = modelText;
	}
}

function fail(modelText: string): EditFailure {
	return new EditFailure(modelText);
}

async function performEdit(args: EditNotebookArgs, io: PatchIO): Promise<string> {
	const original = contentOf(await io.read(args.target), args.target);
	const { modified, resultForModel } = transformNotebook(args, original.replace(/\r\n/g, "\n"));
	assertWritten(await io.write(args.target, modified), args.target);
	return resultForModel;
}

function contentOf(read: PatchRead, target: string): string {
	switch (read.kind) {
		case "content":
			if (read.truncated) {
				const size = read.fileSize > BigInt(0) ? ` (${read.fileSize} bytes)` : "";
				throw fail(`Error: File is too large to edit${size}: only part of it could be read, so writing the edit would truncate it. Edit it with a shell command instead.`);
			}
			return read.text;
		case "binary":
			throw fail("Error: File is not a text file (binary data)");
		case "notFound":
			throw fail(`File not found: ${target}`);
		case "permissionDenied":
			throw fail(`Read permission denied: ${target}`);
		case "invalidFile":
			throw fail(`Error: ${read.reason || "Path is not a valid file to read"}: ${target}`);
		case "error":
			if (read.message.includes("Unable to resolve nonexistent file")) throw fail(`File not found: ${target}`);
			throw fail(`Error: ${read.message}`);
		case "rejected":
			throw fail(`Rejected: ${read.reason}`);
	}
}

function assertWritten(write: PatchWrite, target: string): void {
	switch (write.kind) {
		case "success":
			return;
		case "permissionDenied":
			throw fail(`Write permission denied: ${target}${write.error ? `: ${write.error}` : ""}`);
		case "noSpace":
			throw fail("Error: No space left on device");
		case "rejected":
			throw fail(`Rejected: ${write.reason}`);
		case "error":
			throw fail(`Error: ${write.message}`);
	}
}

// Cursor's transform for a notebook: one cell is inserted or edited in the parsed notebook, which is written back as JSON.
function transformNotebook(args: EditNotebookArgs, original: string): { modified: string; resultForModel: string } {
	const parsed = parseNotebook(original);
	if (!parsed.ok) throw fail(`Error: ${parsed.errorDetails}`);
	const notebook = parsed.notebook;
	if (args.isNewCell) {
		if (args.oldString !== "") throw fail("Error: old_string must be empty when is_new_cell is true");
		const cellId = isCellIdRequired(notebook) ? generateCellId() : undefined;
		notebook.cells.splice(args.cellIdx, 0, createNotebookCell({ content: args.newString, cellType: cellTypeFromLanguage(args.cellLanguage), cellId }));
		return { modified: JSON.stringify(notebook, null, 2), resultForModel: `A new ${args.cellLanguage} cell was created at index ${args.cellIdx} in notebook ${args.target}.` };
	}
	const count = notebook.cells.length;
	if (args.cellIdx < 0 || args.cellIdx >= count) throw fail(`Error: Cell index ${args.cellIdx} is out of range. The notebook has ${count} cells (indices 0-${count - 1}).`);
	const cell = notebook.cells[args.cellIdx];
	if (cell === undefined) throw fail(`Error: Cell at index ${args.cellIdx} does not have a valid source field`);
	const cellContent = sourceText(cell);
	let contentsAfterEdit: string;
	if (args.oldString === "") {
		if (cellContent !== "") throw fail("Error: old_string is empty but the cell has existing content. Provide the content to replace in old_string.");
		contentsAfterEdit = args.newString;
	} else {
		contentsAfterEdit = runSingleEdit(cellContent, args.oldString, args.newString);
	}
	cell.source = splitContentIntoSourceLines(contentsAfterEdit);
	return { modified: JSON.stringify(notebook, null, 2), resultForModel: `The notebook cell at index ${args.cellIdx} in ${args.target} has been updated.` };
}

// Cursor's runSingleEdit for one cell with replace_all off and the whitespace-insensitive fallback on: the old string must match
// exactly once, and the new string is spliced in at that match.
function runSingleEdit(contentsBeforeEdit: string, oldStringRaw: string, newStringRaw: string): string {
	const newString = normalizeLineEndings(newStringRaw);
	const oldString = normalizeLineEndings(oldStringRaw);
	if (oldString === newString) throw fail("Error: old_string and new_string are exactly the same");
	const { matches, usedWhitespaceInsensitive } = findStringMatches(contentsBeforeEdit, oldString);
	if (matches.length === 0) {
		const fuzzy = closestFuzzyMatch(oldString, contentsBeforeEdit.split("\n"));
		const fuzzyMessage = fuzzy === undefined ? "" : ` Found a possible fuzzy match, did you mean:\n${addLineNumbers(fuzzy.fuzzyMatch, fuzzy.startLineNumberOneIndexed)}`;
		throw fail(`Error: The string to replace was not found in the file${usedWhitespaceInsensitive ? " (even after relaxing whitespace)" : ""}.${fuzzyMessage}`);
	}
	if (matches.length > 1) {
		throw fail(`Error: The string to replace was found multiple times in the file${usedWhitespaceInsensitive ? " after relaxing whitespace" : ""}. Use replace_all to replace all occurrences, or include more context to only edit one occurrence.`);
	}
	if (!usedWhitespaceInsensitive && contentsBeforeEdit.indexOf(oldString, matches[0].start + 1) !== -1) {
		throw fail("Error: The string to replace was found at more than one place in the file, and those places overlap, so replace_all would edit only the first. Include more context to only edit one occurrence.");
	}
	return replaceAllMatches(contentsBeforeEdit, matches, newString);
}

// Cursor's findStringMatches: the exact, non-overlapping occurrences, or else the whitespace-insensitive ones.
function findStringMatches(text: string, searchString: string): { matches: Match[]; usedWhitespaceInsensitive: boolean } {
	if (text === "") return { matches: [], usedWhitespaceInsensitive: false };
	const matches: Match[] = [];
	let pos = text.indexOf(searchString);
	while (pos !== -1) {
		matches.push({ start: pos, end: pos + searchString.length });
		pos = text.indexOf(searchString, pos + searchString.length);
	}
	if (matches.length > 0) return { matches, usedWhitespaceInsensitive: false };
	return { matches: findOccurrencesIgnoringWhitespace(searchString, text), usedWhitespaceInsensitive: true };
}

// Cursor's findOccurrencesIgnoringWhitespace: runs of whole lines whose trimmed text equals the needle's trimmed lines; the first
// and last lines may match inside the line.
function findOccurrencesIgnoringWhitespace(needleRaw: string, haystackRaw: string): Match[] {
	const haystack = haystackRaw.replace(/\r\n/g, "\n");
	const needleLines = needleRaw.replace(/\r\n/g, "\n").split("\n").map((line) => line.trim());
	const hayLines = haystack.split("\n");
	const hayLinesTrimmed = hayLines.map((line) => line.trim());
	const lineStartOffsets: number[] = [];
	let running = 0;
	for (const line of hayLines) {
		lineStartOffsets.push(running);
		running += line.length + 1;
	}
	const hits: Match[] = [];
	outer: for (let startLine = 0; startLine <= hayLines.length - needleLines.length; startLine++) {
		let startCharIndexOnFirstLine = 0;
		let endCharIndexOnLastLineExclusive = 0;
		for (let lineIdx = 0; lineIdx < needleLines.length; lineIdx++) {
			const currLineTrimmed = hayLinesTrimmed[startLine + lineIdx];
			const currLineUntrimmed = hayLines[startLine + lineIdx];
			const needleLine = needleLines[lineIdx];
			const isFirstLine = lineIdx === 0;
			const isLastLine = lineIdx === needleLines.length - 1;
			let linesMatch = currLineTrimmed === needleLine;
			if (isFirstLine) {
				linesMatch = currLineTrimmed.endsWith(needleLine);
				if (linesMatch) {
					startCharIndexOnFirstLine = currLineUntrimmed.lastIndexOf(needleLine);
					if (currLineTrimmed === needleLine) startCharIndexOnFirstLine = 0;
				}
			}
			if (isLastLine) {
				if (isFirstLine && linesMatch && currLineTrimmed !== needleLine) continue outer;
				linesMatch = currLineTrimmed.startsWith(needleLine);
				if (linesMatch) {
					endCharIndexOnLastLineExclusive = currLineUntrimmed.indexOf(needleLine) + needleLine.length;
					if (currLineTrimmed === needleLine) endCharIndexOnLastLineExclusive = currLineUntrimmed.length;
				}
			}
			if (!linesMatch) continue outer;
		}
		const endLine = startLine + needleLines.length - 1;
		hits.push({ start: lineStartOffsets[startLine] + startCharIndexOnFirstLine, end: lineStartOffsets[endLine] + endCharIndexOnLastLineExclusive });
	}
	return hits;
}

// Cursor's replaceAllMatches: matches are replaced from the last one back, so earlier offsets stay valid. Deleting a match that is
// alone on its line removes the whole line.
function replaceAllMatches(text: string, matches: Match[], newString: string): string {
	let result = text;
	for (const match of [...matches].sort((a, b) => b.start - a.start)) {
		let startIndex = match.start;
		let endIndex = match.end;
		if (newString === "") {
			const lineStart = result.lastIndexOf("\n", startIndex - 1) + 1;
			if (/^\s*$/.test(result.slice(lineStart, startIndex))) startIndex = lineStart;
			const nextNL = result.indexOf("\n", endIndex);
			if (nextNL !== -1 && /^\s*$/.test(result.slice(endIndex, nextNL))) endIndex = nextNL + 1;
			if (nextNL === -1 && /^\s*$/.test(result.slice(endIndex))) {
				endIndex = result.length;
				if (startIndex > 0 && result.charCodeAt(startIndex - 1) === 10) {
					startIndex -= 1;
					if (startIndex > 0 && result.charCodeAt(startIndex - 1) === 13) startIndex -= 1;
				}
			}
		}
		result = result.slice(0, startIndex) + newString + result.slice(endIndex);
	}
	return result;
}

function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

// Cursor's getClosestFuzzyMatchWithVSCodeDiff: the lines around the first line that holds the search string's longest line, or
// else a word of it.
function closestFuzzyMatch(searchString: string, fileLines: string[]): { fuzzyMatch: string; startLineNumberOneIndexed: number } | undefined {
	const lines = searchString.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
	if (lines.length === 0) return undefined;
	const anchor = [...lines].sort((a, b) => b.length - a.length)[0];
	let anchorIndex = fileLines.findIndex((line) => line.trim().includes(anchor));
	if (anchorIndex === -1) {
		const tokens = anchor.split(/\s+/).filter((token) => token.length > 2);
		anchorIndex = fileLines.findIndex((line) => tokens.some((token) => line.trim().includes(token)));
	}
	if (anchorIndex === -1) return undefined;
	const contextBefore = 2;
	const startLineNumberOneIndexed = Math.max(1, anchorIndex + 1 - contextBefore);
	const desiredSpan = Math.max(lines.length, 1) + 2 * contextBefore;
	const endLineNumberOneIndexedInclusive = Math.min(fileLines.length, startLineNumberOneIndexed + desiredSpan - 1);
	return { fuzzyMatch: fileLines.slice(startLineNumberOneIndexed - 1, endLineNumberOneIndexedInclusive).join("\n"), startLineNumberOneIndexed };
}

// Cursor's addLineNumbers under the agent's default formatting options: no gpt5 numbering and no sparse numbering.
function addLineNumbers(code: string, startLineNumber: number): string {
	return code
		.split("\n")
		.map((line, index) => `${String(startLineNumber + index).padStart(6, " ")}|${line}`)
		.join("\n");
}

function sourceText(cell: NotebookCell): string {
	return Array.isArray(cell.source) ? cell.source.join("") : cell.source;
}

// Cursor's getCellTypeFromLanguage: markdown and raw keep their type; any other language is a code cell.
function cellTypeFromLanguage(language: string): CellType {
	if (language === "markdown") return "markdown";
	if (language === "raw") return "raw";
	return "code";
}

// Cursor's createNotebookCell: the fields come out in the order Cursor builds them, which is not the schema's order.
function createNotebookCell({ content, cellType, cellId }: { content: string; cellType: CellType; cellId: string | undefined }): NotebookCell {
	const baseCell: NotebookCell = { cell_type: cellType, metadata: {}, source: splitContentIntoSourceLines(content), ...(cellId === undefined ? {} : { id: cellId }) };
	if (cellType === "code") return { ...baseCell, execution_count: null, outputs: [] };
	return baseCell;
}

// Cursor's splitContentIntoSourceLines: every line keeps its newline except the last, as Jupyter stores source.
function splitContentIntoSourceLines(content: string): string[] {
	return content.split("\n").map((line, index, lines) => (index < lines.length - 1 ? `${line}\n` : line));
}

// Notebook format 4.5 and later give every cell an id.
function isCellIdRequired(notebook: Notebook): boolean {
	const nbformat = notebook.nbformat || 0;
	const nbformatMinor = notebook.nbformat_minor || 0;
	if (nbformat >= 5) return true;
	return nbformat === 4 && nbformatMinor >= 5;
}

function generateCellId(): string {
	return randomUUID().replace(/-/g, "").substring(0, 8);
}

// Cursor's notebookSchema, read the way zod reads it: keys outside the schema are dropped, the fields come out in the schema's
// order, and every problem is reported with its path in the order zod finds it.
export type ParsedNotebook = { ok: true; notebook: Notebook } | { ok: false; errorDetails: string };

export function parseNotebook(rawContent: string): ParsedNotebook {
	let data: unknown;
	try {
		data = JSON.parse(rawContent);
	} catch {
		return { ok: false, errorDetails: "The notebook file is not valid JSON" };
	}
	const issues: ArgIssue[] = [];
	const notebook = readNotebook(data, issues);
	if (notebook === undefined || issues.length > 0) {
		const messages = issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
		return { ok: false, errorDetails: `The notebook file does not match the expected Jupyter notebook format: ${messages}` };
	}
	return { ok: true, notebook };
}

function readNotebook(data: unknown, issues: ArgIssue[]): Notebook | undefined {
	if (!checkType(data, "object", [], issues)) return undefined;
	const fields = data as Record<string, unknown>;
	const cells = readList(fields.cells, ["cells"], issues, readCell);
	const metadata = fields.metadata === undefined ? {} : readRecord(fields.metadata, ["metadata"], issues);
	const nbformat = fields.nbformat === undefined ? undefined : readNumber(fields.nbformat, ["nbformat"], issues);
	const nbformatMinor = fields.nbformat_minor === undefined ? undefined : readNumber(fields.nbformat_minor, ["nbformat_minor"], issues);
	if (cells === undefined || metadata === undefined) return undefined;
	const notebook: Notebook = { cells, metadata };
	if (nbformat !== undefined) notebook.nbformat = nbformat;
	if (nbformatMinor !== undefined) notebook.nbformat_minor = nbformatMinor;
	return notebook;
}

// A cell's keys are read in the schema's order: cell_type, metadata, source, execution_count, outputs, id.
function readCell(data: unknown, path: Path, issues: ArgIssue[]): NotebookCell | undefined {
	const start = issues.length;
	if (!checkType(data, "object", path, issues)) return undefined;
	const fields = data as Record<string, unknown>;
	const cellType = readCellType(fields.cell_type, [...path, "cell_type"], issues);
	const metadata = fields.metadata === undefined ? {} : readRecord(fields.metadata, [...path, "metadata"], issues);
	const source = readStringOrLines(fields.source, [...path, "source"], issues);
	const executionCount = fields.execution_count === undefined ? undefined : readExecutionCount(fields.execution_count, [...path, "execution_count"], issues);
	const outputs = fields.outputs === undefined ? undefined : readList(fields.outputs, [...path, "outputs"], issues, readOutput);
	const id = fields.id === undefined ? undefined : readString(fields.id, [...path, "id"], issues);
	if (issues.length > start || cellType === undefined || metadata === undefined || source === undefined) return undefined;
	const cell: NotebookCell = { cell_type: cellType, metadata, source };
	if (executionCount !== undefined) cell.execution_count = executionCount;
	if (outputs !== undefined) cell.outputs = outputs;
	if (id !== undefined) cell.id = id;
	return cell;
}

// An output's keys are read in the schema's order, so a stream's "name" and an execute result's "execution_count" are dropped.
function readOutput(data: unknown, path: Path, issues: ArgIssue[]): NotebookOutput | undefined {
	const start = issues.length;
	if (!checkType(data, "object", path, issues)) return undefined;
	const fields = data as Record<string, unknown>;
	const output: NotebookOutput = {};
	if (fields.output_type !== undefined) output.output_type = readString(fields.output_type, [...path, "output_type"], issues);
	if (fields.text !== undefined) output.text = readStringOrLines(fields.text, [...path, "text"], issues);
	if (fields.data !== undefined) output.data = readRecord(fields.data, [...path, "data"], issues);
	if (fields.ename !== undefined) output.ename = readString(fields.ename, [...path, "ename"], issues);
	if (fields.evalue !== undefined) output.evalue = readString(fields.evalue, [...path, "evalue"], issues);
	if (fields.traceback !== undefined) output.traceback = readList(fields.traceback, [...path, "traceback"], issues, readString);
	return issues.length === start ? output : undefined;
}

// zod's array: every item is read, so each one reports its own problems, and the array is valid only when all of them are.
function readList<T>(value: unknown, path: Path, issues: ArgIssue[], readItem: (item: unknown, itemPath: Path, issues: ArgIssue[]) => T | undefined): T[] | undefined {
	if (!checkType(value, "array", path, issues)) return undefined;
	let valid = true;
	const items = (value as unknown[]).map((item, index) => {
		const parsed = readItem(item, [...path, index], issues);
		if (parsed === undefined) valid = false;
		return parsed;
	});
	return valid ? (items as T[]) : undefined;
}

function readCellType(value: unknown, path: Path, issues: ArgIssue[]): CellType | undefined {
	const expected = CELL_TYPES.map((type) => `'${type}'`).join(" | ");
	if (typeof value === "string") {
		if ((CELL_TYPES as readonly string[]).includes(value)) return value as CellType;
		issues.push({ path, message: `Invalid enum value. Expected ${expected}, received '${value}'` });
		return undefined;
	}
	if (value === undefined) {
		issues.push({ path, message: "Required" });
		return undefined;
	}
	issues.push({ path, message: `Expected ${expected}, received ${receivedName(value)}` });
	return undefined;
}

// zod's union of string and string[] (source and output text): a value of neither kind is one "Invalid input" at the field.
function readStringOrLines(value: unknown, path: Path, issues: ArgIssue[]): string | string[] | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && value.every((line) => typeof line === "string")) return value as string[];
	issues.push({ path, message: "Invalid input" });
	return undefined;
}

// zod's union of number and null (execution_count): anything else is "Invalid input".
function readExecutionCount(value: unknown, path: Path, issues: ArgIssue[]): number | null | undefined {
	if (value === null || typeof value === "number") return value;
	issues.push({ path, message: "Invalid input" });
	return undefined;
}

function readString(value: unknown, path: Path, issues: ArgIssue[]): string | undefined {
	return checkType(value, "string", path, issues) ? (value as string) : undefined;
}

function readNumber(value: unknown, path: Path, issues: ArgIssue[]): number | undefined {
	return checkType(value, "number", path, issues) ? (value as number) : undefined;
}

function readRecord(value: unknown, path: Path, issues: ArgIssue[]): Record<string, unknown> | undefined {
	return checkType(value, "object", path, issues) ? (value as Record<string, unknown>) : undefined;
}

// Cursor's lenientNumber for a required field: a numeric string is read as its number before zod's number check.
function readLenientNumber(value: unknown, path: Path, issues: ArgIssue[]): number | undefined {
	if (value === undefined) {
		issues.push({ path, message: "Required" });
		return undefined;
	}
	return optionalLenientNumber(value, path, issues);
}

// Cursor's lenientBoolean for a required field: only the strings "true" and "false" are read as booleans.
function readLenientBoolean(value: unknown, path: Path, issues: ArgIssue[]): boolean | undefined {
	const read = value === "true" ? true : value === "false" ? false : value;
	return checkType(read, "boolean", path, issues) ? (read as boolean) : undefined;
}

// zod's name for a JSON value's type, as in "Expected string, received number".
function receivedName(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
