import iconv from "iconv-lite";
import jschardet from "jschardet";

// Cursor reads the first 8 KB of a file to decide whether it is binary and which encoding it has.
export const FORMAT_HEADER_BYTES = 8192;

const ESCAPE_BYTE = 27;
const MAX_FILE_ENCODINGS = 100;

export interface FileFormat {
	encoding: string;
	isBinaryFile: boolean;
	isImageFile: boolean;
}

// Cursor's getFormatForFile, from the header bytes.
export function formatForHeader(header: Buffer): FileFormat {
	return formatForBuffer(header.length === FORMAT_HEADER_BYTES ? withoutCutUtf8Character(header) : header);
}

function formatForBuffer(header: Buffer): FileFormat {
	if (header.length === 0) return { encoding: "UTF-8", isBinaryFile: false, isImageFile: false };
	const multiByte = detectUtf16(header) ?? detectUtf32(header);
	if (multiByte !== undefined) return { encoding: multiByte, isBinaryFile: false, isImageFile: false };
	if (!isBufferText(header)) {
		return { encoding: "binary", isBinaryFile: true, isImageFile: isBufferAnImage(header) };
	}
	if (isUtf8(header) && (!header.includes(ESCAPE_BYTE) || !isAscii(header))) {
		return { encoding: "UTF-8", isBinaryFile: false, isImageFile: false };
	}
	const detected = jschardet.detect(header);
	const encoding = detected.confidence > 0.7 ? (detected.encoding ?? "utf-8") : "utf-8";
	return { encoding: encoding === "ascii" ? "utf-8" : encoding, isBinaryFile: false, isImageFile: false };
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

function isPrintable(byte: number): boolean {
	return (byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13;
}

function isBufferText(buffer: Buffer): boolean {
	const len = Math.min(FORMAT_HEADER_BYTES, buffer.length);
	if (len === 0) return true;
	for (let i = 0; i < len; i++) {
		if (buffer[i] === 0) return false;
	}
	let nonPrintable = 0;
	for (let i = 0; i < len; i++) {
		const byte = buffer[i];
		if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) nonPrintable++;
	}
	return (nonPrintable / len) * 100 < 5;
}

function isBufferAnImage(buffer: Buffer): boolean {
	if (buffer.length < 4) return false;
	if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return true;
	if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return true;
	if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return true;
	if (buffer.length >= 6 && buffer.toString("ascii", 0, 4) === "GIF8" && (buffer[4] === 55 || buffer[4] === 57) && buffer[5] === 97) return true;
	return false;
}

function detectUtf16(buffer: Buffer): string | undefined {
	if (buffer.length < 4) return undefined;
	if (buffer[0] === 255 && buffer[1] === 254 && !(buffer[2] === 0 && buffer[3] === 0)) return "UTF-16LE";
	if (buffer[0] === 254 && buffer[1] === 255) return "UTF-16BE";
	let le = 0;
	let be = 0;
	const samples = Math.min(50, Math.floor(buffer.length / 2));
	for (let i = 0; i < samples * 2; i += 2) {
		if (i + 1 >= buffer.length) break;
		if (buffer[i + 1] === 0 && isPrintable(buffer[i])) le++;
		if (buffer[i] === 0 && isPrintable(buffer[i + 1])) be++;
	}
	if (le > samples * 0.8) return "UTF-16LE";
	if (be > samples * 0.8) return "UTF-16BE";
	return undefined;
}

function detectUtf32(buffer: Buffer): string | undefined {
	if (buffer.length < 8) return undefined;
	if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 254 && buffer[3] === 255) return "UTF-32BE";
	if (buffer[0] === 255 && buffer[1] === 254 && buffer[2] === 0 && buffer[3] === 0) return "UTF-32LE";
	let be = 0;
	let le = 0;
	const samples = Math.min(50, Math.floor(buffer.length / 4));
	for (let i = 0; i < samples * 4; i += 4) {
		if (i + 3 >= buffer.length) break;
		if (buffer[i] === 0 && buffer[i + 1] === 0 && buffer[i + 2] === 0 && isPrintable(buffer[i + 3])) be++;
		if (buffer[i + 1] === 0 && buffer[i + 2] === 0 && buffer[i + 3] === 0 && isPrintable(buffer[i])) le++;
	}
	if (be > samples * 0.8) return "UTF-32BE";
	if (le > samples * 0.8) return "UTF-32LE";
	return undefined;
}

function isUtf8(buffer: Buffer): boolean {
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	try {
		decoder.decode(buffer);
		return true;
	} catch {
		return false;
	}
}

function isAscii(buffer: Buffer): boolean {
	for (const byte of buffer) {
		if (byte >= 128) return false;
	}
	return true;
}

function normalizeReadEncoding(encoding: string): string {
	const normalized = encoding.toLowerCase();
	if (normalized === "utf-8") return "utf8";
	if (normalized === "utf-8-bom" || normalized === "utf-8 bom") return "utf8bom";
	if (normalized === "latin-1") return "latin1";
	return normalized;
}

const cachedEncodings = new Map<string, string>();

// Cursor remembers the encoding a file was read with; later reads of that file start from it.
export function rememberEncoding(file: string, encoding: string): void {
	cachedEncodings.delete(file);
	cachedEncodings.set(file, encoding);
	if (cachedEncodings.size <= MAX_FILE_ENCODINGS) return;
	const oldest = cachedEncodings.keys().next().value;
	if (oldest !== undefined) cachedEncodings.delete(oldest);
}

export interface DecodedText {
	text: string;
	encoding: string;
}

function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// Cursor's streaming reader: the bytes decode with the encoding the file was read with before, else the detected one.
// UTF-8 is decoded strictly, and invalid UTF-8 falls back to latin1. A leading byte-order mark is dropped.
export function decodeTextFile(bytes: Buffer, format: FileFormat, file: string): DecodedText {
	const requested = normalizeReadEncoding(cachedEncodings.get(file) ?? format.encoding);
	const iconvEncoding = requested === "utf8bom" ? "utf8" : requested;
	if (iconvEncoding !== "utf8" && iconv.encodingExists(iconvEncoding)) {
		return { text: stripBom(iconv.decode(bytes, iconvEncoding)), encoding: requested };
	}
	try {
		const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
		const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
		return { text: stripBom(text), encoding: hasBom ? "utf8bom" : "utf8" };
	} catch {
		return { text: bytes.toString("latin1"), encoding: "latin1" };
	}
}
