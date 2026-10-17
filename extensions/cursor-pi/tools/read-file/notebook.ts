// Cursor's formatNotebookForLLM: a Jupyter notebook as cells with their text outputs. Text that is not a notebook
// that passes Cursor's schema is returned unchanged.

const FENCE = "```";
const MAX_OUTPUT_CHARS_PER_CELL = 2000;
const ANSI_COLOR = /\x1b\[[0-9;]*m/g;

type Json = Record<string, unknown>;

interface NotebookOutput {
	output_type?: string;
	text?: string | string[];
	data?: Json;
	traceback?: string[];
}

interface NotebookCell {
	cell_type: string;
	source: string | string[];
	outputs?: NotebookOutput[];
}

interface Notebook {
	cells: NotebookCell[];
}

function isRecord(value: unknown): value is Json {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isStringOrStrings(value: unknown): boolean {
	return isString(value) || (Array.isArray(value) && value.every(isString));
}

function isOptional(value: unknown, check: (value: unknown) => boolean): boolean {
	return value === undefined || check(value);
}

function isOutput(value: unknown): boolean {
	return (
		isRecord(value) &&
		isOptional(value.output_type, isString) &&
		isOptional(value.text, isStringOrStrings) &&
		isOptional(value.data, isRecord) &&
		isOptional(value.ename, isString) &&
		isOptional(value.evalue, isString) &&
		isOptional(value.traceback, (traceback) => Array.isArray(traceback) && traceback.every(isString))
	);
}

function isCell(value: unknown): boolean {
	return (
		isRecord(value) &&
		(value.cell_type === "code" || value.cell_type === "markdown" || value.cell_type === "raw") &&
		isOptional(value.metadata, isRecord) &&
		isStringOrStrings(value.source) &&
		isOptional(value.execution_count, (count) => typeof count === "number" || count === null) &&
		isOptional(value.outputs, (outputs) => Array.isArray(outputs) && outputs.every(isOutput)) &&
		isOptional(value.id, isString)
	);
}

function isNotebook(value: unknown): value is Notebook {
	return (
		isRecord(value) &&
		Array.isArray(value.cells) &&
		value.cells.every(isCell) &&
		isOptional(value.metadata, isRecord) &&
		isOptional(value.nbformat, (format) => typeof format === "number") &&
		isOptional(value.nbformat_minor, (format) => typeof format === "number")
	);
}

function parseNotebook(raw: string): Notebook | undefined {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	return isNotebook(value) ? value : undefined;
}

function extractCellSource(cell: NotebookCell): string {
	return Array.isArray(cell.source) ? cell.source.join("") : cell.source || "";
}

function extractTextFromData(data: Json): string | undefined {
	const plain = data["text/plain"];
	if (plain) {
		if (isString(plain)) return plain;
		if (Array.isArray(plain)) return plain.filter(isString).join("");
	}
	const markdown = data["text/markdown"];
	if (markdown) {
		if (isString(markdown)) return markdown;
		if (Array.isArray(markdown)) return markdown.filter(isString).join("");
	}
	return undefined;
}

function extractOutputText(output: NotebookOutput): string | undefined {
	if (output.output_type === "error" && output.traceback) {
		return output.traceback.map((line) => line.replace(ANSI_COLOR, "")).join("\n");
	}
	if ((output.output_type === "execute_result" || output.output_type === "display_data") && output.data) {
		return extractTextFromData(output.data);
	}
	if (output.text) {
		if (isString(output.text)) return output.text;
		const strings = output.text.filter(isString);
		if (strings.length > 0) return strings.join("");
	}
	return undefined;
}

function formatCell(cell: NotebookCell, index: number): string {
	const parts = [`\nCell ${index}:\n${FENCE}\n${extractCellSource(cell)}${FENCE}`];
	const outputs = cell.outputs ?? [];
	if (outputs.length > 0) {
		let outputText = "";
		for (const output of outputs) {
			if (outputText.length >= MAX_OUTPUT_CHARS_PER_CELL) break;
			const extracted = extractOutputText(output);
			if (extracted) {
				if (outputText.length > 0 && !outputText.endsWith("\n")) outputText += "\n";
				outputText += extracted;
			}
		}
		if (outputText.length > 0) {
			const truncated = outputText.length > MAX_OUTPUT_CHARS_PER_CELL;
			outputText = outputText.substring(0, MAX_OUTPUT_CHARS_PER_CELL);
			const header = truncated
				? `Cell ${index} output (truncated at ${MAX_OUTPUT_CHARS_PER_CELL} chars):`
				: `Cell ${index} output:`;
			parts.push(`${header}\n${FENCE}\n${outputText}${FENCE}`);
		}
	}
	return parts.join("\n\n");
}

export function formatNotebookForLLM(raw: string): string {
	const notebook = parseNotebook(raw);
	if (notebook === undefined) return raw;
	if (notebook.cells.length === 0) return "Notebook is empty (0 cells)";
	return `${notebook.cells.map(formatCell).join("\n\n")}\n\n`;
}
