// Cursor's text formats for local files: detection from the bytes, decoding, the per-file encoding memory, and the
// encoding and line endings a write uses. Ported from Cursor's encoding module and its local read executor.
import { isAscii, isUtf8 } from "node:buffer";
import { open, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import iconv from "iconv-lite";
import jschardet from "jschardet";

export const MAX_TEXT_SIZE = 8 * 1024 * 1024;
export const MAX_OFS_FILE_SIZE = 50 * 1024 * 1024;

const FORMAT_HEADER_BYTES = 8192;
const MAX_FILE_ENCODINGS = 100;
const UTF8 = "utf8";
const UTF8_BOM = "utf8bom";
const LATIN1 = "latin1";
const DETECTED_UTF8 = "UTF-8";
const ESCAPE_BYTE = 27;
const UTF8_BOM_BYTES = Buffer.from([0xef, 0xbb, 0xbf]);
const UNICODE_BOM_BYTES: Record<string, Buffer> = {
	utf16le: Buffer.from([0xff, 0xfe]),
	utf16be: Buffer.from([0xfe, 0xff]),
	utf32le: Buffer.from([0xff, 0xfe, 0x00, 0x00]),
	utf32be: Buffer.from([0x00, 0x00, 0xfe, 0xff]),
};
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".m4v"]);
export const BINARY_EXTENSIONS = new Set([
	".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".svg", ".pdf", ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".dylib", ".bin",
	...VIDEO_EXTENSIONS,
]);
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|ico|bmp|svg)$/i;
const ENCODING_MAPPINGS: Record<string, string> = {
	"windows-1250": "cp1250", "windows-1251": "cp1251", "windows-1252": "cp1252", "windows-1253": "cp1253", "windows-1254": "cp1254", "windows-1255": "cp1255", "windows-1256": "cp1256", "windows-1257": "cp1257", "windows-1258": "cp1258", "iso-8859-1": "iso88591", "iso-8859-2": "iso88592", "iso-8859-5": "iso88595", "iso-8859-6": "iso88596", "iso-8859-7": "iso88597", "iso-8859-8": "iso88598", "iso-8859-9": "iso88599", "iso-8859-15": "iso885915", "iso-8859-16": "iso885916", shift_jis: "shiftjis", "euc-jp": "eucjp", "euc-kr": "euckr", "iso-2022-jp": "iso2022jp", "iso-2022-kr": "iso2022kr", gb2312: "gb2312", gbk: "gbk", gb18030: "gb18030", big5: "big5", "big5-hkscs": "big5hkscs", "koi8-r": "koi8r", "koi8-u": "koi8u", ibm855: "cp855", ibm866: "cp866", maccyrillic: "maccyrillic", "utf-16le": "utf16le", "utf-16be": "utf16be", "utf-32le": "utf32le", "utf-32be": "utf32be", johab: "johab", cp949: "cp949", cp932: "cp932",
};
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const LATIN1_DECODER = new TextDecoder("latin1");
const FILE_ENCODINGS = new Map<string, string>();

export interface TextFormat {
	encoding: string;
	lineEnding: "CRLF" | "LF";
	isBinaryFile: boolean;
	isImageFile: boolean;
	isVideoFile: boolean;
}

export interface StreamedText {
	content: string;
	totalLines: number;
	truncated: boolean;
	cacheEncoding: string;
}

export class InvalidUtf8Error extends Error {}

type DecoderConfig = { kind: "strictUtf8"; cacheEncoding: string } | { kind: "iconv"; decoderEncoding: string; cacheEncoding: string };

function getFileExtension(filePath: string): string {
	const lower = filePath.toLowerCase();
	const dot = lower.lastIndexOf(".");
	return dot === -1 ? "" : lower.substring(dot);
}

function defaultTextFormat(): TextFormat {
	return { encoding: UTF8, lineEnding: process.platform === "win32" ? "CRLF" : "LF", isBinaryFile: false, isImageFile: false, isVideoFile: false };
}

function getFormatFromFileExtension(filePath: string): TextFormat {
	const ext = getFileExtension(filePath);
	return { encoding: "binary", lineEnding: "LF", isBinaryFile: true, isImageFile: IMAGE_EXTENSIONS.test(ext), isVideoFile: VIDEO_EXTENSIONS.has(ext) };
}

function lineEndingFromCounts(crlfCount: number, lfOnlyCount: number): "CRLF" | "LF" {
	if (crlfCount === 0 && lfOnlyCount === 0) return "LF";
	const crlfPercentage = (crlfCount / (crlfCount + lfOnlyCount)) * 100;
	return crlfPercentage >= 5 ? "CRLF" : "LF";
}

function determineLineEndingsForBuffer(buffer: Buffer): "CRLF" | "LF" {
	let crlfCount = 0;
	let lfOnlyCount = 0;
	for (let i = 0; i < buffer.length; i++) {
		if (buffer[i] === 10) {
			if (i > 0 && buffer[i - 1] === 13) crlfCount++;
			else lfOnlyCount++;
		}
	}
	return lineEndingFromCounts(crlfCount, lfOnlyCount);
}

function determineLineEndingsForText(text: string): "CRLF" | "LF" {
	const lfCount = text.match(/\n/g)?.length ?? 0;
	const crlfCount = text.match(/\r\n/g)?.length ?? 0;
	return lineEndingFromCounts(crlfCount, lfCount - crlfCount);
}

function isBufferText(buffer: Buffer): boolean {
	const length = Math.min(FORMAT_HEADER_BYTES, buffer.length);
	if (length === 0) return true;
	for (let i = 0; i < length; i++) {
		if (buffer[i] === 0) return false;
	}
	let nonPrintableCount = 0;
	for (let i = 0; i < length; i++) {
		const byte = buffer[i];
		if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) nonPrintableCount++;
	}
	return (nonPrintableCount / length) * 100 < 5;
}

function isBufferAnImage(buffer: Buffer): boolean {
	if (buffer.length < 4) return false;
	if (buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71 && buffer[4] === 13 && buffer[5] === 10 && buffer[6] === 26 && buffer[7] === 10) return true;
	if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return true;
	if (buffer.length >= 12 && buffer[0] === 82 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 70 && buffer[8] === 87 && buffer[9] === 69 && buffer[10] === 66 && buffer[11] === 80) return true;
	if (buffer.length >= 6 && buffer[0] === 71 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 56 && (buffer[4] === 55 || buffer[4] === 57) && buffer[5] === 97) return true;
	return false;
}

function withoutCutUtf8Character(header: Buffer): Buffer {
	for (let i = header.length - 1; i >= Math.max(0, header.length - 3); i--) {
		const byte = header[i];
		if (byte < 128) return header;
		if (byte >= 192) {
			const characterLength = byte >= 240 ? 4 : byte >= 224 ? 3 : 2;
			return header.length - i < characterLength ? header.subarray(0, i) : header;
		}
	}
	return header;
}

function detectUtf16Encoding(buffer: Buffer): string | null {
	if (buffer.length < 4) return null;
	if (buffer[0] === 255 && buffer[1] === 254 && !(buffer[2] === 0 && buffer[3] === 0)) return "UTF-16LE";
	if (buffer[0] === 254 && buffer[1] === 255) return "UTF-16BE";
	let utf16LeMatches = 0;
	let utf16BeMatches = 0;
	const samplesToCheck = Math.min(50, Math.floor(buffer.length / 2));
	for (let i = 0; i < samplesToCheck * 2; i += 2) {
		if (i + 1 >= buffer.length) break;
		if (buffer[i + 1] === 0) {
			const char = buffer[i];
			if ((char >= 32 && char <= 126) || char === 9 || char === 10 || char === 13) utf16LeMatches++;
		}
		if (buffer[i] === 0) {
			const char = buffer[i + 1];
			if ((char >= 32 && char <= 126) || char === 9 || char === 10 || char === 13) utf16BeMatches++;
		}
	}
	if (utf16LeMatches > samplesToCheck * 0.8) return "UTF-16LE";
	if (utf16BeMatches > samplesToCheck * 0.8) return "UTF-16BE";
	return null;
}

function detectUtf32Encoding(buffer: Buffer): string | null {
	if (buffer.length < 8) return null;
	if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 254 && buffer[3] === 255) return "UTF-32BE";
	if (buffer[0] === 255 && buffer[1] === 254 && buffer[2] === 0 && buffer[3] === 0) return "UTF-32LE";
	let utf32BeMatches = 0;
	let utf32LeMatches = 0;
	const samplesToCheck = Math.min(50, Math.floor(buffer.length / 4));
	for (let i = 0; i < samplesToCheck * 4; i += 4) {
		if (i + 3 >= buffer.length) break;
		if (buffer[i] === 0 && buffer[i + 1] === 0 && buffer[i + 2] === 0) {
			const char = buffer[i + 3];
			if ((char >= 32 && char <= 126) || char === 9 || char === 10 || char === 13) utf32BeMatches++;
		}
		if (buffer[i + 1] === 0 && buffer[i + 2] === 0 && buffer[i + 3] === 0) {
			const char = buffer[i];
			if ((char >= 32 && char <= 126) || char === 9 || char === 10 || char === 13) utf32LeMatches++;
		}
	}
	if (utf32BeMatches > samplesToCheck * 0.8) return "UTF-32BE";
	if (utf32LeMatches > samplesToCheck * 0.8) return "UTF-32LE";
	return null;
}

function getFormatForBuffer(header: Buffer): TextFormat {
	if (header.length === 0) return defaultTextFormat();
	const multiByte = detectUtf16Encoding(header) ?? detectUtf32Encoding(header);
	if (multiByte) {
		const decoded = iconv.decode(header.subarray(0, FORMAT_HEADER_BYTES), mapToIconvEncoding(normalizeEncodingName(multiByte)));
		return { encoding: multiByte, lineEnding: determineLineEndingsForText(decoded), isBinaryFile: false, isImageFile: false, isVideoFile: false };
	}
	if (!isBufferText(header)) {
		return { encoding: "binary", lineEnding: "LF", isBinaryFile: true, isImageFile: isBufferAnImage(header), isVideoFile: false };
	}
	if (isUtf8(header) && (!header.includes(ESCAPE_BYTE) || !isAscii(header))) {
		return { encoding: DETECTED_UTF8, lineEnding: determineLineEndingsForBuffer(header), isBinaryFile: false, isImageFile: false, isVideoFile: false };
	}
	const detected = jschardet.detect(header) as { encoding: string | null; confidence: number };
	let encoding = detected.confidence > 0.7 ? detected.encoding : "utf-8";
	if (encoding === "ascii") encoding = "utf-8";
	return { encoding: encoding ?? "utf-8", lineEnding: determineLineEndingsForBuffer(header), isBinaryFile: false, isImageFile: false, isVideoFile: false };
}

async function readFirstBytes(file: string): Promise<Buffer> {
	const handle = await open(file, "r");
	try {
		const buffer = Buffer.allocUnsafe(FORMAT_HEADER_BYTES);
		const { bytesRead } = await handle.read(buffer, 0, FORMAT_HEADER_BYTES, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await handle.close();
	}
}

export async function getFormatForFile(file: string): Promise<TextFormat> {
	const header = await readFirstBytes(file);
	const format = getFormatForBuffer(header.length === FORMAT_HEADER_BYTES ? withoutCutUtf8Character(header) : header);
	if (!format.isBinaryFile) return { ...format, isVideoFile: false };
	return { ...format, isVideoFile: VIDEO_EXTENSIONS.has(getFileExtension(file)) };
}

async function getBestFormatForPath(possiblePath: string, workspaceRoot: string): Promise<TextFormat> {
	try {
		return await getFormatForFile(possiblePath);
	} catch {}
	if (BINARY_EXTENSIONS.has(getFileExtension(possiblePath))) return getFormatFromFileExtension(possiblePath);
	return getFormatForWorkspace(workspaceRoot);
}

const IGNORED_DIRS = new Set(["node_modules", ".git", ".svn", ".hg", "dist", "build", "out", ".next", ".cache", "coverage", "__pycache__", ".venv", "venv", ".turbo"]);

async function* walkDirectory(dir: string): AsyncGenerator<string> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (!IGNORED_DIRS.has(entry.name)) yield* walkDirectory(fullPath);
		} else if (entry.isFile()) {
			yield fullPath;
		}
	}
}

// A new file takes the format most of the first 100 workspace files share, as Cursor's write does.
async function getFormatForWorkspace(workspaceRoot: string): Promise<TextFormat> {
	const formatCounts = new Map<string, { format: TextFormat; count: number }>();
	let filesProcessed = 0;
	for await (const filePath of walkDirectory(workspaceRoot)) {
		if (filesProcessed >= 100) break;
		try {
			const format = await getFormatForFile(filePath);
			if (!format.isBinaryFile) {
				const key = `${format.encoding}:${format.lineEnding}`;
				const existing = formatCounts.get(key);
				if (existing) {
					existing.count++;
					if (existing.count >= 3) return existing.format;
				} else {
					formatCounts.set(key, { format, count: 1 });
				}
			}
			filesProcessed++;
		} catch {}
	}
	let mostCommon: { format: TextFormat; count: number } | undefined;
	for (const entry of formatCounts.values()) {
		if (!mostCommon || entry.count > mostCommon.count) mostCommon = entry;
	}
	return mostCommon?.format ?? defaultTextFormat();
}

function normalizeEncodingName(encoding: string): string {
	const normalized = encoding.toLowerCase();
	if (normalized === "latin-1") return LATIN1;
	if (normalized === "utf-8") return UTF8;
	if (normalized === "utf-8-bom" || normalized === "utf-8 bom") return UTF8_BOM;
	return normalized;
}

function mapToIconvEncoding(encoding: string): string {
	return ENCODING_MAPPINGS[encoding] || encoding;
}

function stripUtf8Bom(text: string): string {
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function hasUtf8Bom(buffer: Buffer): boolean {
	return buffer.length >= UTF8_BOM_BYTES.length && buffer[0] === UTF8_BOM_BYTES[0] && buffer[1] === UTF8_BOM_BYTES[1] && buffer[2] === UTF8_BOM_BYTES[2];
}

async function fileStartsWith(file: string, prefix: Buffer): Promise<boolean> {
	try {
		return (await readFirstBytes(file)).subarray(0, prefix.length).equals(prefix);
	} catch {
		return false;
	}
}

function decodeWithUtf8Fallback(buffer: Buffer): { text: string; encoding: string } {
	try {
		return { text: UTF8_DECODER.decode(buffer), encoding: UTF8 };
	} catch {
		return { text: LATIN1_DECODER.decode(buffer), encoding: LATIN1 };
	}
}

function decodeBufferWithEncoding(buffer: Buffer, encoding: string): { text: string; encoding: string } {
	const normalized = normalizeEncodingName(encoding);
	if (normalized === UTF8 || normalized === UTF8_BOM || normalized === "ascii") {
		const decoded = decodeWithUtf8Fallback(buffer);
		if (normalized === UTF8_BOM && decoded.encoding === UTF8) return { text: decoded.text, encoding: UTF8_BOM };
		return decoded;
	}
	if (normalized === LATIN1) return { text: LATIN1_DECODER.decode(buffer), encoding: LATIN1 };
	try {
		const iconvEncoding = mapToIconvEncoding(normalized);
		if (iconv.encodingExists(iconvEncoding)) return { text: iconv.decode(buffer, iconvEncoding), encoding: normalized };
	} catch {}
	return decodeWithUtf8Fallback(buffer);
}

export function setFileEncoding(file: string, encoding: string): void {
	FILE_ENCODINGS.delete(file);
	FILE_ENCODINGS.set(file, encoding);
	if (FILE_ENCODINGS.size <= MAX_FILE_ENCODINGS) return;
	const oldestKey = FILE_ENCODINGS.keys().next().value;
	if (oldestKey !== undefined) FILE_ENCODINGS.delete(oldestKey);
}

// The text of a file as the model sees it: the decoded content with a leading BOM removed and CRLF as LF when the
// file is CRLF.
export async function readText(file: string, encodingHint?: string): Promise<string> {
	const buffer = await readFile(file);
	const format = getFormatForBuffer(buffer);
	if (format.isBinaryFile) throw new Error("Binary file cannot be decoded as text");
	const encodingToUse = encodingHint || FILE_ENCODINGS.get(file) || format.encoding;
	const { text, encoding } = decodeBufferWithEncoding(buffer, encodingToUse);
	const str = stripUtf8Bom(text);
	setFileEncoding(file, encoding === UTF8 && hasUtf8Bom(buffer) ? UTF8_BOM : encoding);
	return format.lineEnding === "CRLF" ? str.replaceAll("\r\n", "\n") : str;
}

function countLines(data: string): number {
	if (data === "") return 1;
	let lines = 1;
	for (let i = 0; i < data.length; i++) {
		if (data[i] === "\n") lines++;
	}
	return lines;
}

function decodeBinaryContent(content: string): Buffer {
	const cleaned = content.trim().replace(/\s/g, "");
	const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
	const minBase64Length = 50;
	const minDecodedRatio = 0.5;
	if (cleaned.length > minBase64Length && base64Pattern.test(cleaned)) {
		try {
			const decoded = Buffer.from(cleaned, "base64");
			if (decoded.length > 0 && decoded.length >= Math.floor(cleaned.length * minDecodedRatio)) return decoded;
		} catch {}
	}
	return Buffer.from(content, "latin1");
}

// The bytes a write produces: the file's encoding (remembered from the last read, else the file's own or the
// workspace's), its line endings, and a BOM when the file had one.
export async function getBufferForWrite(file: string, content: string, workspaceRoot: string): Promise<{ lines: number; buffer: Buffer }> {
	let format: TextFormat;
	try {
		format = await getBestFormatForPath(file, workspaceRoot);
	} catch {
		format = BINARY_EXTENSIONS.has(getFileExtension(file)) ? getFormatFromFileExtension(file) : defaultTextFormat();
	}
	const cachedEncoding = FILE_ENCODINGS.get(file);
	let bom: Buffer | undefined;
	if (!format.isBinaryFile) {
		const resolvedEncoding = normalizeEncodingName(cachedEncoding || format.encoding);
		const writeUtf8Bom = resolvedEncoding === UTF8_BOM || (resolvedEncoding === UTF8 && (await fileStartsWith(file, UTF8_BOM_BYTES)));
		const unicodeBom = UNICODE_BOM_BYTES[mapToIconvEncoding(resolvedEncoding)];
		if (writeUtf8Bom) bom = UTF8_BOM_BYTES;
		else if (unicodeBom && (await fileStartsWith(file, unicodeBom))) bom = unicodeBom;
		format = { ...format, encoding: writeUtf8Bom ? UTF8_BOM : resolvedEncoding };
		setFileEncoding(file, format.encoding);
	}
	const lines = countLines(content);
	const text = format.lineEnding === "CRLF" ? content.replace(/(?<!\r)\n/g, "\r\n") : content;
	if (format.encoding === "binary") return { lines, buffer: decodeBinaryContent(text) };
	const encoded = iconv.encode(bom ? stripUtf8Bom(text) : text, format.encoding === UTF8_BOM ? UTF8 : format.encoding, { defaultEncoding: UTF8 });
	return { lines, buffer: bom ? Buffer.concat([bom, encoded]) : encoded };
}

// The whole file decoded as a streamed read decodes it. Cursor's read ranges are not ported: ApplyPatch always reads
// the whole file.
export async function readTextStreaming(file: string, format: TextFormat, encodingHint?: string): Promise<StreamedText> {
	const requested = normalizeEncodingName(encodingHint || FILE_ENCODINGS.get(file) || format.encoding);
	const iconvEncoding = requested === UTF8_BOM ? UTF8 : requested;
	let config: DecoderConfig;
	if (iconvEncoding === UTF8) config = { kind: "strictUtf8", cacheEncoding: UTF8 };
	else if (iconv.encodingExists(iconvEncoding)) config = { kind: "iconv", decoderEncoding: iconvEncoding, cacheEncoding: requested };
	else config = { kind: "strictUtf8", cacheEncoding: UTF8 };
	try {
		return await decodeWhole(file, config);
	} catch (error) {
		if (error instanceof InvalidUtf8Error) return decodeWhole(file, { kind: "iconv", decoderEncoding: LATIN1, cacheEncoding: LATIN1 });
		throw error;
	}
}

async function decodeWhole(file: string, config: DecoderConfig): Promise<StreamedText> {
	const buffer = await readFile(file);
	let text: string;
	if (config.kind === "strictUtf8") {
		try {
			text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
		} catch (error) {
			if (error instanceof TypeError) throw new InvalidUtf8Error();
			throw error;
		}
	} else {
		text = iconv.decode(buffer, config.decoderEncoding);
	}
	let hadLeadingBom = false;
	if (text.charCodeAt(0) === 0xfeff) {
		hadLeadingBom = true;
		text = text.slice(1);
	}
	const parts = text.split("\n");
	const newlines = parts.length - 1;
	const crlfCount = parts.slice(0, newlines).filter((part) => part.endsWith("\r")).length;
	const normalizeCrlf = newlines > 0 && (crlfCount / newlines) * 100 >= 5;
	let content = parts.map((part, index) => (normalizeCrlf && index < newlines && part.endsWith("\r") ? part.slice(0, -1) : part)).join("\n");
	let truncated = false;
	if (content.length > MAX_TEXT_SIZE) {
		content = content.slice(0, MAX_TEXT_SIZE);
		truncated = true;
	}
	const cacheEncoding = config.kind === "strictUtf8" && hadLeadingBom ? UTF8_BOM : config.cacheEncoding;
	return { content, totalLines: parts.length, truncated, cacheEncoding };
}

export { DETECTED_UTF8 };
