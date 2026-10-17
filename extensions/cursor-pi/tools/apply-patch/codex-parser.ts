// Port of Cursor's codex-parser.js: the update-hunk parser and applier that ApplyPatch runs on a patch.
// Thrown messages are model-visible; ApplyPatch sends them back as the tool result text.

export class CodexError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CodexError";
	}
}

export const PATCH_PREFIX = "*** Begin Patch";
export const PATCH_SUFFIX = "*** End Patch";
export const END_OF_FILE_PREFIX = "*** End of File";
// Cursor drops a first or last patch line that contains this word (a leftover from heredoc-wrapped patches).
export const EOF_MARKER = "PATCH";

const HUNK_ADD_LINE_PREFIX = "+";
const PUNCT_EQUIV: Record<string, string> = {
	"\u2010": "-",
	"\u2011": "-",
	"\u2012": "-",
	"\u2013": "-",
	"\u2014": "-",
	"\u2212": "-",
	"\u201C": '"',
	"\u201D": '"',
	"\u201E": '"',
	"\u00AB": '"',
	"\u00BB": '"',
	"\u2018": "'",
	"\u2019": "'",
	"\u201B": "'",
	"\u00A0": " ",
	"\u202F": " ",
};
const PUNCT_EQUIV_RE = /[\u2010\u2011\u2012\u2013\u2014\u2212\u201C\u201D\u201E\u00AB\u00BB\u2018\u2019\u201B\u00A0\u202F]/g;

export interface PatchChunk {
	origIndex: number;
	delLines: string[];
	insLines: string[];
}

interface Section {
	context: string[];
	chunks: PatchChunk[];
	endIndex: number;
	eof: boolean;
}

// Matching form: NFC, with typographic dashes and quotes folded to ASCII.
export function canon(text: string): string {
	if (text === undefined) {
		// Cursor's canon calls text.normalize, so a context that runs past the end of the file throws this message.
		throw new TypeError("Cannot read properties of undefined (reading 'normalize')");
	}
	const nfc = text.normalize("NFC");
	return nfc.search(PUNCT_EQUIV_RE) === -1 ? nfc : nfc.replace(PUNCT_EQUIV_RE, (c) => PUNCT_EQUIV[c] ?? c);
}

// Reads one hunk section: the lines up to the next @@, the envelope end, or *** End of File.
function peekNextSection(lines: string[], initialIndex: number): Section {
	let index = initialIndex;
	const old: string[] = [];
	let delLines: string[] = [];
	let insLines: string[] = [];
	const chunks: PatchChunk[] = [];
	let mode: "keep" | "add" | "delete" = "keep";
	while (index < lines.length) {
		const raw = lines[index];
		if (["@@", PATCH_SUFFIX, END_OF_FILE_PREFIX].some((prefix) => raw.startsWith(prefix.trim()))) break;
		if (raw === "***") break;
		if (raw.startsWith("***")) {
			if (raw.startsWith("*** Delete File:")) {
				throw new CodexError(
					"Delete File is not supported for apply_patch. Please use the delete_file tool instead. Be very careful deleting files that have existing code from the user; ask the user for confirmation first!",
				);
			}
			throw new CodexError(
				`Unexpected line found in update hunk: '${raw}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`,
			);
		}
		index += 1;
		const lastMode = mode;
		let line = raw;
		if (line[0] === HUNK_ADD_LINE_PREFIX) {
			mode = "add";
		} else if (line[0] === "-") {
			mode = "delete";
		} else if (line[0] === " ") {
			mode = "keep";
		} else {
			mode = "keep";
			line = ` ${line}`;
		}
		line = line.slice(1);
		if (mode === "keep" && lastMode !== mode) {
			if (insLines.length || delLines.length) {
				chunks.push({ origIndex: old.length - delLines.length, delLines, insLines });
			}
			delLines = [];
			insLines = [];
		}
		if (mode === "delete") {
			delLines.push(line);
			old.push(line);
		} else if (mode === "add") {
			insLines.push(line);
		} else {
			old.push(line);
		}
	}
	if (insLines.length || delLines.length) {
		chunks.push({ origIndex: old.length - delLines.length, delLines, insLines });
	}
	if (index < lines.length && lines[index] === END_OF_FILE_PREFIX) {
		return { context: old, chunks, endIndex: index + 1, eof: true };
	}
	return { context: old, chunks, endIndex: index, eof: false };
}

// Index in lines where the context matches, or -1. Exact first, then trailing whitespace, then full trim.
function findContextCore(lines: string[], context: string[], start: number): number {
	if (context.length === 0) return start;
	const searchWith = (transform: (line: string) => string, canonicalContext: string): number => {
		const cache: (string | undefined)[] = new Array(lines.length);
		for (let i = start; i + context.length <= lines.length; i++) {
			for (let j = 0; j < context.length; j++) {
				const idx = i + j;
				if (cache[idx] === undefined) cache[idx] = canon(transform(lines[idx]));
			}
			if (cache.slice(i, i + context.length).join("\n") === canonicalContext) return i;
		}
		return -1;
	};
	const exact = searchWith((line) => line, canon(context.join("\n")));
	if (exact !== -1) return exact;
	const trimmedEnd = searchWith((line) => line.trimEnd(), canon(context.map((line) => line.trimEnd()).join("\n")));
	if (trimmedEnd !== -1) return trimmedEnd;
	return searchWith((line) => line.trim(), canon(context.map((line) => line.trim()).join("\n")));
}

function findContext(lines: string[], context: string[], start: number, eof: boolean): number {
	if (!eof) return findContextCore(lines, context, start);
	const atEnd = findContextCore(lines, context, lines.length - context.length);
	return atEnd !== -1 ? atEnd : findContextCore(lines, context, start);
}

// Parses the update section of a patch and applies its hunks to file text, as Cursor's Parser3 does.
export class PatchParser {
	index = 0;
	private readonly lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	// Returns the hunks, with origIndex pointing into the file text.
	parse(text: string): PatchChunk[] {
		const chunks: PatchChunk[] = [];
		const fileLines = text.split("\n");
		let index = 0;
		while (!this.isDone([PATCH_SUFFIX, END_OF_FILE_PREFIX])) {
			const defStr = this.readStr("@@ ");
			const sectionMarker = !defStr && this.lines[this.index] === "@@";
			if (sectionMarker) this.index += 1;
			if (!(defStr || sectionMarker || index === 0)) {
				throw new CodexError(`Expected update hunk to start with a @@ context marker, got: '${this.lines[this.index]}'`);
			}
			if (defStr.trim()) {
				let found = false;
				if (!fileLines.slice(0, index).some((line) => canon(line) === canon(defStr))) {
					for (let i = index; i < fileLines.length; i++) {
						if (canon(fileLines[i]) === canon(defStr)) {
							index = i + 1;
							found = true;
							break;
						}
					}
				}
				if (!found && !fileLines.slice(0, index).some((line) => canon(line.trim()) === canon(defStr.trim()))) {
					for (let i = index; i < fileLines.length; i++) {
						if (canon(fileLines[i].trim()) === canon(defStr.trim())) {
							index = i + 1;
							break;
						}
					}
				}
			}
			const section = peekNextSection(this.lines, this.index);
			const newIndex = findContext(fileLines, section.context, index, section.eof);
			if (newIndex === -1) {
				throw new CodexError(`Failed to find context:\n${section.context.join("\n")}`);
			}
			for (const chunk of section.chunks) {
				chunk.origIndex += newIndex;
				chunks.push(chunk);
			}
			index = newIndex + section.context.length;
			this.index = section.endIndex;
		}
		return chunks;
	}

	// Splices the hunks into the text. hasChunks is false when the patch has no hunks.
	apply(text: string, chunks: PatchChunk[]): { newLines: string[]; hasChunks: boolean } {
		const ordered = [...chunks].sort((a, b) => a.origIndex - b.origIndex);
		const lines = text.split("\n");
		const newLines: string[] = [];
		let index = 0;
		for (const chunk of ordered) {
			newLines.push(...lines.slice(index, chunk.origIndex));
			newLines.push(...chunk.insLines);
			index = chunk.origIndex + chunk.delLines.length;
		}
		newLines.push(...lines.slice(index));
		return { newLines, hasChunks: ordered.length > 0 };
	}

	private isDone(prefixes: string[]): boolean {
		if (this.index >= this.lines.length) return true;
		return prefixes.some((prefix) => this.lines[this.index].startsWith(prefix.trim()));
	}

	private readStr(prefix: string): string {
		if (this.index >= this.lines.length) {
			throw new CodexError(`Index: ${this.index} >= ${this.lines.length}`);
		}
		if (!this.lines[this.index].startsWith(prefix)) return "";
		const text = this.lines[this.index].slice(prefix.length);
		this.index += 1;
		return text;
	}
}
