import { createJimp } from "@jimp/core";
import bmp, { msBmp } from "@jimp/js-bmp";
import gif from "@jimp/js-gif";
import jpeg from "@jimp/js-jpeg";
import png from "@jimp/js-png";
import tiff from "@jimp/js-tiff";
import { methods as resizeMethods } from "@jimp/plugin-resize";
import { decodePngDownscaled, throwIfPngPixelDataShort } from "./png.ts";

// Cursor's model image limits. An image inside them goes to the model byte for byte.
const MAX_IMAGE_DIMENSION = 1024;
const MAX_WEBP_IMAGE_DIMENSION = 1280;
const MAX_IMAGE_SIZE_BYTES = 1024 * 1024;
const MIN_IMAGE_DIMENSION = 8;
const MAX_DECODE_PIXELS = 178956970;
const MAX_DECODE_SIDE = 1e6;
const WEBP_PASSTHROUGH_DIMENSIONS = [
	{ width: 1280, height: 800 },
	{ width: 1456, height: 840 },
];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR_CHUNK_BYTES = 25;
const PNG_IEND_TRAILER = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const UNDECODABLE_PREFIX = "File is not a valid image:";
// This build registers no WebP codec, so WebP data that needs decoding fails with this message.
const WEBP_CODEC_MISSING = "webp codec not registered: registerWebpCodec() must be called by a Node server before decoding/encoding webp";

interface Dimensions {
	width: number;
	height: number;
}

type ImageFormat = "png" | "jpeg" | "gif" | "bmp" | "tiff" | "id3";

export interface ImageBytes {
	data: Buffer;
	mimeType: string;
}

export type PreparedImage = { kind: "image"; image: ImageBytes } | { kind: "undecodable"; reason: string };

type DecodeCheck = { kind: "unchecked" } | { kind: "decodes" } | { kind: "undecodable"; reason: string };

// The image surface the read path uses from Cursor's jimp instance.
export interface JimpImage {
	width: number;
	height: number;
	mime?: string;
	resize(size: { w: number; h: number }): void;
	getBuffer(mime: string): Promise<Buffer>;
}

export interface MinimalJimp {
	read(data: Buffer): Promise<JimpImage>;
	fromBitmap(bitmap: { data: Buffer; width: number; height: number }): JimpImage;
}

// Cursor's undecodableImageReason: the message for image data that cannot be decoded.
export function undecodableImageReason(detail: string): string {
	return `${UNDECODABLE_PREFIX} its data could not be decoded (${detail}). A truncated or hand-copied file does this; write it again from the original bytes with code.`;
}

// The MIME type of the image formats the read tool sends to the model, sniffed from the bytes.
export function imageMimeOfBytes(bytes: Buffer): string | undefined {
	if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	const head = bytes.toString("ascii", 0, 6);
	if (head === "GIF87a" || head === "GIF89a") return "image/gif";
	if (isWebp(bytes)) return "image/webp";
	return undefined;
}

let jimp: MinimalJimp | undefined;

// Cursor's getMinimalJimp: the decoders and the resize plugin the image path is built with. The created instance has
// the methods of MinimalJimp at runtime; the cast only names the surface used here.
function getMinimalJimp(): MinimalJimp {
	jimp ??= createJimp({ formats: [png, jpeg, bmp, msBmp, gif, tiff], plugins: [resizeMethods] }) as unknown as MinimalJimp;
	return jimp;
}

// Cursor's prepareImageForModel for the executor: resize when needed, then check the result still decodes.
export async function prepareImageForModel(data: Buffer): Promise<PreparedImage> {
	let image: ImageBytes;
	try {
		image = await resizeImageBufferIfNeeded(data, {});
	} catch (error) {
		const original = await checkImageDecodes(data);
		if (original.kind === "undecodable") return { kind: "undecodable", reason: original.reason };
		throw error;
	}
	const resized = await checkImageDecodes(image.data);
	return resized.kind === "undecodable" ? { kind: "undecodable", reason: resized.reason } : { kind: "image", image };
}

// Cursor's boundInlineImageForModel, which the read tool applies to the executor's bytes. A failure keeps the bytes.
export async function boundInlineImageForModel(bytes: Buffer): Promise<Buffer> {
	let resized: ImageBytes;
	try {
		resized = await resizeImageBufferIfNeeded(bytes, { webpWithoutCodec: "passthrough" });
	} catch {
		return bytes;
	}
	return resized.data.length === bytes.length && resized.data.equals(bytes) ? bytes : resized.data;
}

interface ResizeOptions {
	webpWithoutCodec?: "passthrough";
}

// Cursor's resizeImageBufferIfNeeded: bytes already inside the limits are returned as they are; otherwise the image is
// decoded, scaled down to the limit, and encoded again in its own format.
async function resizeImageBufferIfNeeded(data: Buffer, options: ResizeOptions): Promise<ImageBytes> {
	if (isWebp(data)) return resizeWebp(data, options);
	const header = readRasterDimensions(data);
	if (header !== undefined && data.length <= MAX_IMAGE_SIZE_BYTES && !targetFit(header.width, header.height, MAX_IMAGE_DIMENSION).needsResize) {
		return { data, mimeType: header.mimeType };
	}
	const format = sniffJimpFormat(data);
	if (format !== undefined) throwIfJimpCannotDecodeSafely(data, format);
	if (format === "png") await throwIfPngPixelDataShort(data);
	const Jimp = getMinimalJimp();
	const fit = header === undefined ? undefined : targetFit(header.width, header.height, MAX_IMAGE_DIMENSION);
	const downscaled =
		header?.mimeType === "image/png" && fit?.needsResize === true
			? await decodePngDownscaled({ data, width: fit.width, height: fit.height }).catch(() => undefined)
			: undefined;
	const image = downscaled === undefined ? await Jimp.read(data) : Jimp.fromBitmap(downscaled);
	const mimeType = jimpMimeType(image);
	const { width, height, needsResize } = targetFit(image.width, image.height, MAX_IMAGE_DIMENSION);
	if (downscaled === undefined && !needsResize && data.length <= MAX_IMAGE_SIZE_BYTES) {
		return { data, mimeType };
	}
	let newWidth = width;
	let newHeight = height;
	if (needsResize) image.resize({ w: newWidth, h: newHeight });
	let result = await image.getBuffer(mimeType);
	while (result.length > MAX_IMAGE_SIZE_BYTES && newWidth > MIN_IMAGE_DIMENSION && newHeight > MIN_IMAGE_DIMENSION) {
		newWidth = Math.max(MIN_IMAGE_DIMENSION, Math.round(newWidth * 0.8));
		newHeight = Math.max(MIN_IMAGE_DIMENSION, Math.round(newHeight * 0.8));
		image.resize({ w: newWidth, h: newHeight });
		result = await image.getBuffer(mimeType);
	}
	return { data: result, mimeType };
}

// WebP has no decoder in this build: data within the limits, or any data with a passthrough option, is returned
// unchanged; other WebP data fails with Cursor's codec message.
function resizeWebp(data: Buffer, options: ResizeOptions): ImageBytes {
	const dimensions = readWebpDimensions(data);
	const isModelCanvas =
		dimensions !== undefined && WEBP_PASSTHROUGH_DIMENSIONS.some((canvas) => canvas.width === dimensions.width && canvas.height === dimensions.height);
	const withinDimensionCap =
		dimensions !== undefined && (isModelCanvas || !targetFit(dimensions.width, dimensions.height, MAX_WEBP_IMAGE_DIMENSION).needsResize);
	if (withinDimensionCap && data.length <= MAX_IMAGE_SIZE_BYTES) return { data, mimeType: "image/webp" };
	if (options.webpWithoutCodec === "passthrough") return { data, mimeType: "image/webp" };
	throwIfOverDecodeLimit(dimensions);
	throw new Error(WEBP_CODEC_MISSING);
}

// Cursor's checkImageDecodes: decodes the data with the same decoders. WebP is unchecked because no codec exists.
async function checkImageDecodes(data: Buffer): Promise<DecodeCheck> {
	if (isWebp(data)) return { kind: "unchecked" };
	const format = sniffJimpFormat(data);
	if (format === undefined) return { kind: "unchecked" };
	throwIfJimpCannotDecodeSafely(data, format);
	const Jimp = getMinimalJimp();
	try {
		if (format === "png") await throwIfPngPixelDataShort(data);
		await Jimp.read(data);
		return { kind: "decodes" };
	} catch (error) {
		return { kind: "undecodable", reason: error instanceof Error ? error.message : String(error) };
	}
}

function jimpMimeType(image: { mime?: string }): string {
	switch (image.mime) {
		case "image/png":
		case "image/bmp":
		case "image/tiff":
		case "image/x-ms-bmp":
		case "image/gif":
		case "image/jpeg":
			return image.mime;
		default:
			return "image/png";
	}
}

function throwIfOverDecodeLimit(size: Dimensions | undefined): void {
	if (size === undefined) throw new Error("image dimensions could not be read before decoding");
	const { width, height } = size;
	if (!(width * height <= MAX_DECODE_PIXELS)) {
		throw new Error(`image dimensions ${width}x${height} exceed the ${MAX_DECODE_PIXELS} pixel decode limit`);
	}
	if (!(Math.max(width, height) <= MAX_DECODE_SIDE)) {
		throw new Error(`image dimensions ${width}x${height} exceed the ${MAX_DECODE_SIDE} pixel side limit`);
	}
}

function throwIfJimpCannotDecodeSafely(data: Buffer, format: ImageFormat): void {
	if (format === "tiff") throw new Error("TIFF images are not supported; convert the image to PNG or JPEG");
	if (format === "id3") throw new Error("images that start with an ID3 tag are not supported");
	if (format === "jpeg") return;
	throwIfOverDecodeLimit(readDeclaredDimensions(data, format));
}

function sniffJimpFormat(data: Buffer): ImageFormat | undefined {
	const leading = data.toString("latin1", 0, 6);
	if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "png";
	if (leading.startsWith("\u00ff\u00d8\u00ff")) return "jpeg";
	if (leading === "GIF87a" || leading === "GIF89a") return "gif";
	if (leading.startsWith("BM")) return "bmp";
	if (leading.startsWith("II*\u0000") || leading.startsWith("MM\u0000*")) return "tiff";
	if (leading.startsWith("ID3")) return "id3";
	return undefined;
}

function readDeclaredDimensions(data: Buffer, format: ImageFormat): Dimensions | undefined {
	switch (format) {
		case "png":
			return readPngIhdrBounds(data);
		case "gif":
			return readGifDimensions(data);
		case "bmp":
			return data.length < 26 ? undefined : { width: data.readUInt32LE(18), height: Math.abs(data.readInt32LE(22)) };
		default:
			return undefined;
	}
}

// Cursor's targetFitImageSize: the size an image is scaled to so its long side fits the limit, and whether it changes.
function targetFit(width: number, height: number, maxDimension: number): Dimensions & { needsResize: boolean } {
	if (width < 1 || height < 1) return { width, height, needsResize: false };
	const long = Math.max(width, height);
	if (long <= maxDimension) return { width, height, needsResize: false };
	const short = Math.min(width, height);
	if (short < MIN_IMAGE_DIMENSION) return { width, height, needsResize: false };
	let scale = maxDimension / long;
	let newWidth = Math.max(1, Math.round(width * scale));
	let newHeight = Math.max(1, Math.round(height * scale));
	if (newWidth < MIN_IMAGE_DIMENSION || newHeight < MIN_IMAGE_DIMENSION) {
		scale = MIN_IMAGE_DIMENSION / short;
		newWidth = Math.max(MIN_IMAGE_DIMENSION, Math.round(width * scale));
		newHeight = Math.max(MIN_IMAGE_DIMENSION, Math.round(height * scale));
	}
	return { width: newWidth, height: newHeight, needsResize: newWidth !== width || newHeight !== height };
}

// The dimensions and type of a PNG or JPEG whose structure is complete; undefined otherwise.
function readRasterDimensions(data: Buffer): (Dimensions & { mimeType: string }) | undefined {
	return readPngDimensions(data) ?? readJpegDimensions(data);
}

function readPngDimensions(buffer: Buffer): (Dimensions & { mimeType: string }) | undefined {
	if (
		buffer.length < PNG_SIGNATURE.length + PNG_IHDR_CHUNK_BYTES + PNG_IEND_TRAILER.length ||
		!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
		buffer.readUInt32BE(8) !== 13 ||
		buffer.toString("ascii", 12, 16) !== "IHDR" ||
		!buffer.subarray(buffer.length - PNG_IEND_TRAILER.length).equals(PNG_IEND_TRAILER)
	) {
		return undefined;
	}
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	if (width < 1 || height < 1) return undefined;
	return { mimeType: "image/png", width, height };
}

// Largest IHDR size in the PNG, read from the chunk list without decoding.
function readPngIhdrBounds(buffer: Buffer): Dimensions | undefined {
	let size: Dimensions | undefined;
	let at = PNG_SIGNATURE.length;
	while (at + 16 <= buffer.length) {
		if (buffer.toString("ascii", at + 4, at + 8) === "IHDR") {
			const found = { width: buffer.readUInt32BE(at + 8), height: buffer.readUInt32BE(at + 12) };
			size = { width: Math.max(size?.width ?? 0, found.width), height: Math.max(size?.height ?? 0, found.height) };
		}
		at += 12 + buffer.readUInt32BE(at);
	}
	return size;
}

function isStandaloneJpegMarker(marker: number): boolean {
	return marker === 1 || (marker >= 208 && marker <= 216);
}

function isDecodableJpegFrame(marker: number): boolean {
	return marker === 192 || marker === 193 || marker === 194;
}

function isUndecodableJpegFrame(marker: number): boolean {
	return marker >= 195 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204;
}

function readJpegDimensions(buffer: Buffer): (Dimensions & { mimeType: string }) | undefined {
	if (buffer.length < 4 || buffer[0] !== 255 || buffer[1] !== 216 || buffer[buffer.length - 2] !== 255 || buffer[buffer.length - 1] !== 217) {
		return undefined;
	}
	let offset = 2;
	while (offset + 4 <= buffer.length) {
		if (buffer[offset] !== 255) return undefined;
		const marker = buffer[offset + 1];
		if (marker === 255) {
			offset += 1;
			continue;
		}
		if (isStandaloneJpegMarker(marker)) {
			offset += 2;
			continue;
		}
		if (marker === 218 || marker === 217 || isUndecodableJpegFrame(marker)) return undefined;
		const segmentLength = buffer.readUInt16BE(offset + 2);
		if (segmentLength < 2) return undefined;
		if (isDecodableJpegFrame(marker)) {
			if (segmentLength < 8 || offset + 9 > buffer.length) return undefined;
			const height = buffer.readUInt16BE(offset + 5);
			const width = buffer.readUInt16BE(offset + 7);
			if (width < 1 || height < 1) return undefined;
			return { mimeType: "image/jpeg", width, height };
		}
		offset += 2 + segmentLength;
	}
	return undefined;
}

function isWebp(buffer: Buffer): boolean {
	return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}

function readWebpDimensions(buffer: Buffer): Dimensions | undefined {
	if (!isWebp(buffer) || buffer.length < 16) return undefined;
	const fourCC = buffer.toString("ascii", 12, 16);
	if (fourCC === "VP8 ") {
		if (buffer.length < 30 || buffer[23] !== 157 || buffer[24] !== 1 || buffer[25] !== 42) return undefined;
		return { width: (buffer[26] | (buffer[27] << 8)) & 16383, height: (buffer[28] | (buffer[29] << 8)) & 16383 };
	}
	if (fourCC === "VP8L") {
		if (buffer.length < 25 || buffer[20] !== 47) return undefined;
		const bits = (buffer[21] | (buffer[22] << 8) | (buffer[23] << 16) | (buffer[24] << 24)) >>> 0;
		return { width: (bits & 16383) + 1, height: ((bits >> 14) & 16383) + 1 };
	}
	if (fourCC === "VP8X") {
		if (buffer.length < 30) return undefined;
		return {
			width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
			height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
		};
	}
	return undefined;
}

// The logical screen, grown to the first image descriptor's frame when that frame is larger.
function readGifDimensions(buffer: Buffer): Dimensions | undefined {
	if (buffer.length < 13) return undefined;
	const screen = { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
	let at = 13 + gifPaletteBytes(buffer[10]);
	while (at < buffer.length) {
		if (buffer[at] === 44 && at + 10 <= buffer.length) {
			return {
				width: Math.max(screen.width, buffer.readUInt16LE(at + 5)),
				height: Math.max(screen.height, buffer.readUInt16LE(at + 7)),
			};
		}
		if (buffer[at] === 33 && buffer[at + 1] === 249) {
			at += 8;
		} else if (buffer[at] === 33 && buffer[at + 1] === 254) {
			at = skipGifSubBlocks(buffer, at + 2);
		} else if (buffer[at] === 33 && buffer[at + 1] === 255) {
			at = buffer[at + 2] === 11 ? skipGifSubBlocks(buffer, at + 14) : at + 19;
		} else {
			break;
		}
	}
	return screen;
}

function gifPaletteBytes(flags: number): number {
	return flags & 128 ? 3 << ((flags & 7) + 1) : 0;
}

function skipGifSubBlocks(buffer: Buffer, start: number): number {
	let at = start;
	while (at < buffer.length && buffer[at] !== 0) at += 1 + buffer[at];
	return at + 1;
}
