import { ReadToolError } from "./errors.ts";
import { MAX_TEXT_SIZE, type TextRead } from "./lines.ts";

// Cursor Pi keeps terminal captures and agent-tool outputs under .cursor-pi/projects/<id>/terminals and
// .cursor-pi/projects/<id>/agent-tools. Only that tree gets the terminal reader; Cursor's own .cursor/projects tree is left
// to Cursor.
const CURSOR_PI_DIR = ".cursor-pi";

const TERMINAL_BLOCK_DELIMITER = Buffer.from("\n---\n");
const TERMINAL_FOOTER_MAX_BYTES = 4096;
const TERMINAL_DETECT_MIN_PAIRED_MATCHES = 8;

// Magic numbers of binary formats. An agent-tool output that starts with one of these is rejected as binary.
const KNOWN_BINARY_MAGIC_PREFIXES: Buffer[] = [
	Buffer.from("%PDF-", "ascii"),
	Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]),
	Buffer.from([80, 75, 3, 4]),
	Buffer.from([80, 75, 5, 6]),
	Buffer.from([80, 75, 7, 8]),
	Buffer.from([127, 69, 76, 70]),
	Buffer.from([254, 237, 250, 206]),
	Buffer.from([254, 237, 250, 207]),
	Buffer.from([206, 250, 237, 254]),
	Buffer.from([207, 250, 237, 254]),
	Buffer.from([77, 90, 144]),
	Buffer.from([0, 97, 115, 109]),
	Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	Buffer.from([255, 216, 255]),
	Buffer.from("GIF87a", "ascii"),
	Buffer.from("GIF89a", "ascii"),
	Buffer.from("SQLite format 3\x00", "ascii"),
	Buffer.from([31, 139]),
	Buffer.from("BZh", "ascii"),
	Buffer.from([253, 55, 122, 88, 90, 0]),
	Buffer.from([40, 181, 47, 253]),
	Buffer.from([55, 122, 188, 175, 39, 28]),
	Buffer.from([82, 97, 114, 33, 26, 7, 0]),
	Buffer.from([82, 97, 114, 33, 26, 7, 1, 0]),
];

interface ProjectSubdirMatch {
	remainingPath: string[];
}

// The path segments after .cursor-pi/projects/<id>/<targetDir>, or null when the path is not in that tree.
function matchProjectSubdir(path: string, targetDir: string): ProjectSubdirMatch | null {
	const parts = path.split(/[/\\]+/).filter((part) => part);
	for (let i = 0; i < parts.length - 2; i++) {
		if (parts[i] === CURSOR_PI_DIR && parts[i + 1] === "projects" && parts[i + 3] === targetDir) {
			return { remainingPath: parts.slice(i + 4) };
		}
	}
	return null;
}

export function isTerminalFilePath(file: string): boolean {
	const match = matchProjectSubdir(file, "terminals");
	return match !== null && match.remainingPath.length === 1 && /^\d+\.txt$/.test(match.remainingPath[0]);
}

export function isAgentToolOutputFile(file: string): boolean {
	const match = matchProjectSubdir(file, "agent-tools");
	return match !== null && match.remainingPath.length === 1 && match.remainingPath[0].endsWith(".txt");
}

export function looksLikeKnownBinaryFormat(raw: Buffer): boolean {
	return KNOWN_BINARY_MAGIC_PREFIXES.some((prefix) => raw.length >= prefix.length && raw.subarray(0, prefix.length).equals(prefix));
}

// The frontmatter ends after the first "\n---\n" that follows a leading "---\n"; 0 when there is none.
function frontmatterEnd(raw: Buffer): number {
	if (raw.length < 5 || raw[0] !== 45 || raw[1] !== 45 || raw[2] !== 45 || raw[3] !== 10) return 0;
	const at = raw.indexOf(TERMINAL_BLOCK_DELIMITER, 4);
	return at === -1 ? 0 : at + TERMINAL_BLOCK_DELIMITER.length;
}

function isPrintableOrWhitespace(byte: number): boolean {
	return (byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13;
}

function detectBodyEncoding(body: Buffer): "utf-16le" | "utf-16be" | "utf-8" {
	if (body.length >= 2) {
		if (body[0] === 255 && body[1] === 254) return "utf-16le";
		if (body[0] === 254 && body[1] === 255) return "utf-16be";
	}
	const sampleLength = Math.min(4096, body.length);
	if (sampleLength < 16) return "utf-8";
	let le = 0;
	let be = 0;
	for (let i = 0; i + 1 < sampleLength; i += 2) {
		const lo = body[i];
		const hi = body[i + 1];
		if (hi === 0 && isPrintableOrWhitespace(lo)) le++;
		if (lo === 0 && isPrintableOrWhitespace(hi)) be++;
	}
	if (le >= TERMINAL_DETECT_MIN_PAIRED_MATCHES && le >= 4 * Math.max(1, be)) return "utf-16le";
	if (be >= TERMINAL_DETECT_MIN_PAIRED_MATCHES && be >= 4 * Math.max(1, le)) return "utf-16be";
	return "utf-8";
}

// A footer is 2 or 3 ASCII lines: exit_code or error, an optional elapsed_ms, and ended_at.
function isValidFooterBody(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c !== 10 && (c < 32 || c > 126)) return false;
	}
	const lines = text.split("\n").filter((line) => line.length > 0);
	if (lines.length < 2 || lines.length > 3) return false;
	if (!/^(exit_code: (?:-?\d+|unknown)|error: .+)$/.test(lines[0])) return false;
	if (!lines[lines.length - 1].startsWith("ended_at: ")) return false;
	if (lines.length === 3 && !/^elapsed_ms: \d+$/.test(lines[1])) return false;
	return true;
}

// Where the footer block starts, or the buffer length when there is no valid footer.
function footerStart(raw: Buffer, minStart: number): number {
	const len = raw.length;
	if (len < TERMINAL_BLOCK_DELIMITER.length * 2) return len;
	if (raw[len - 1] !== 10 || raw[len - 2] !== 45 || raw[len - 3] !== 45 || raw[len - 4] !== 45 || raw[len - 5] !== 10) return len;
	const scanFloor = Math.max(minStart, len - TERMINAL_FOOTER_MAX_BYTES);
	const opening = raw.lastIndexOf(TERMINAL_BLOCK_DELIMITER, len - TERMINAL_BLOCK_DELIMITER.length - 1);
	if (opening === -1 || opening < scanFloor) return len;
	const footerText = raw.subarray(opening + TERMINAL_BLOCK_DELIMITER.length, len - 4).toString("utf-8");
	return isValidFooterBody(footerText) ? opening : len;
}

// The terminal capture as text: the frontmatter and footer are kept as they are, and the body is decoded in the encoding
// it was written in (UTF-16 with or without a byte-order mark, otherwise UTF-8).
export function decodeTerminalFile(raw: Buffer): string {
	const headerEnd = frontmatterEnd(raw);
	const frontmatter = headerEnd > 0 ? raw.subarray(0, headerEnd).toString("utf-8") : "";
	const footerAt = footerStart(raw, headerEnd);
	const footer = footerAt < raw.length ? raw.subarray(footerAt).toString("utf-8") : "";
	const body = raw.subarray(headerEnd, footerAt);
	const encoding = detectBodyEncoding(body);
	let text: string;
	if (encoding === "utf-16le") {
		text = body.toString("utf16le");
	} else if (encoding === "utf-16be") {
		const even = body.length - (body.length % 2);
		const swapped = Buffer.from(body.subarray(0, even));
		swapped.swap16();
		text = swapped.toString("utf16le");
	} else {
		text = body.toString("utf-8");
	}
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	return frontmatter + text + footer;
}

// Cursor's tryApplyRequestedReadRange: a range of lines from already decoded text. A range that starts past the end, or
// text that is empty, is returned whole with rangeApplied false.
function applyLineRange(content: string, totalLines: number, offset: number | undefined, limit: number | undefined): { content: string; rangeApplied: boolean } {
	if (offset === undefined && limit === undefined) return { content, rangeApplied: false };
	if (content === "") return { content, rangeApplied: false };
	const effectiveOffset = offset ?? 1;
	const effectiveLimit = limit ?? (effectiveOffset < 0 ? Math.abs(effectiveOffset) : totalLines);
	const start = effectiveOffset < 0 ? Math.max(0, totalLines + effectiveOffset) : Math.max(0, effectiveOffset - 1);
	if (start >= totalLines) return { content, rangeApplied: false };
	const end = Math.min(totalLines, start + effectiveLimit);
	return { content: content.split("\n").slice(start, end).join("\n"), rangeApplied: true };
}

// A terminal or agent-tool file read as text, with CRLF line endings turned into LF before the range is applied.
export function readTerminalFileText(raw: Buffer, offset: number | undefined, limit: number | undefined): TextRead {
	let content = decodeTerminalFile(raw).replaceAll("\r\n", "\n");
	const totalLines = content.split("\n").length;
	const ranged = applyLineRange(content, totalLines, offset, limit);
	content = ranged.content;
	if (content.length > MAX_TEXT_SIZE) content = content.substring(0, MAX_TEXT_SIZE);
	return { content, totalLines, rangeApplied: ranged.rangeApplied };
}

export const TERMINAL_BINARY_REASON = "File content is binary data, not text";

