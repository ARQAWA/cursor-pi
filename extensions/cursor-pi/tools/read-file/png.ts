import { Readable } from "node:stream";
import { createInflate } from "node:zlib";

// PNG handling for the read tool: the pixel-data length check and a downscaled RGBA decoder used before a large PNG is
// resized. Both follow the behavior of Cursor's image path.

const PNG_SIGNATURE_BYTES = 8;
const BIT_DEPTHS = [1, 2, 4, 8, 16];
const CHANNELS_BY_COLOR_TYPE: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DOWNSCALE_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
const ADAM7_PASSES = [
	[0, 0, 8, 8],
	[4, 0, 8, 8],
	[0, 4, 4, 8],
	[2, 0, 4, 4],
	[0, 2, 2, 4],
	[1, 0, 2, 2],
	[0, 1, 1, 2],
];

interface PixelLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	interlaced: boolean;
	idat: Buffer[];
}

function readPixelLayout(data: Buffer): PixelLayout | undefined {
	let header: Omit<PixelLayout, "idat"> | undefined;
	const idat: Buffer[] = [];
	let at = PNG_SIGNATURE_BYTES;
	while (at + 12 <= data.length) {
		const length = data.readUInt32BE(at);
		const type = data.toString("ascii", at + 4, at + 8);
		const body = data.subarray(at + 8, at + 8 + length);
		if (type === "IHDR" && header === undefined && body.length === 13) {
			const channels = CHANNELS_BY_COLOR_TYPE[body[9]];
			if (channels === undefined || !BIT_DEPTHS.includes(body[8]) || body[12] > 1) return undefined;
			header = {
				width: body.readUInt32BE(0),
				height: body.readUInt32BE(4),
				bitsPerPixel: channels * body[8],
				interlaced: body[12] === 1,
			};
		} else if (type === "IDAT") {
			idat.push(body);
		} else if (type === "IEND") {
			break;
		}
		at += length + 12;
	}
	return header === undefined || idat.length === 0 ? undefined : { ...header, idat };
}

// Bytes of pixel data (filter byte included) that the header implies.
function expectedPixelBytes({ width, height, bitsPerPixel, interlaced }: PixelLayout): number {
	const bytes = (w: number, h: number) => (w <= 0 || h <= 0 ? 0 : h * (1 + Math.ceil((w * bitsPerPixel) / 8)));
	if (!interlaced) return bytes(width, height);
	return ADAM7_PASSES.reduce((sum, [x, y, dx, dy]) => sum + bytes(Math.ceil((width - x) / dx), Math.ceil((height - y) / dy)), 0);
}

// Throws when the IDAT stream inflates to fewer bytes than the header implies.
export async function throwIfPngPixelDataShort(data: Buffer): Promise<void> {
	const layout = readPixelLayout(data);
	if (layout === undefined) return;
	const expected = expectedPixelBytes(layout);
	let inflated = 0;
	const stream = Readable.from(layout.idat).pipe(createInflate());
	for await (const chunk of stream) {
		inflated += chunk.length;
		if (inflated >= expected) {
			stream.destroy();
			return;
		}
	}
	throw new Error(`PNG pixel data ends after ${inflated} of ${expected} bytes`);
}

interface DownscaleLayout {
	width: number;
	height: number;
	channels: number;
	idat: Buffer[];
}

// The 8-bit, non-interlaced layout the downscaler reads. A palette or tRNS chunk makes the image unsupported.
function readDownscaleLayout(data: Buffer): DownscaleLayout | undefined {
	let header: Omit<DownscaleLayout, "idat"> | undefined;
	const idat: Buffer[] = [];
	let at = PNG_SIGNATURE_BYTES;
	while (at + 12 <= data.length) {
		const length = data.readUInt32BE(at);
		const type = data.toString("ascii", at + 4, at + 8);
		const body = data.subarray(at + 8, at + 8 + length);
		if (body.length !== length) return undefined;
		if (type === "IHDR") {
			const channels = DOWNSCALE_CHANNELS[body[9]];
			if (header !== undefined || length !== 13 || body[8] !== 8 || body[12] !== 0 || channels === undefined) return undefined;
			header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), channels };
		} else if (type === "IDAT") {
			idat.push(body);
		} else if (type === "tRNS") {
			return undefined;
		} else if (type === "IEND") {
			break;
		}
		at += length + 12;
	}
	return header === undefined || idat.length === 0 ? undefined : { ...header, idat };
}

// Reverses one PNG scanline filter in place; `previous` is the already unfiltered row above.
function unfilterRow(filter: number, row: Uint8Array, previous: Uint8Array, bytesPerPixel: number): void {
	if (filter === 0) return;
	for (let i = 0; i < row.length; i++) {
		const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
		const up = previous[i];
		switch (filter) {
			case 1:
				row[i] += left;
				break;
			case 2:
				row[i] += up;
				break;
			case 3:
				row[i] += (left + up) >> 1;
				break;
			case 4: {
				const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
				const estimate = left + up - upLeft;
				const distanceLeft = Math.abs(estimate - left);
				const distanceUp = Math.abs(estimate - up);
				const distanceUpLeft = Math.abs(estimate - upLeft);
				row[i] += distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft ? left : distanceUp <= distanceUpLeft ? up : upLeft;
				break;
			}
			default:
				throw new Error(`unknown PNG filter type ${filter}`);
		}
	}
}

// Adds one unfiltered input row to the output columns it maps to, weighting colour by alpha.
function addRow(row: Uint8Array, channels: number, columnOf: Uint32Array, sums: Float64Array, counts: Uint32Array): void {
	const gray = channels < 3;
	for (let x = 0, i = 0; x < columnOf.length; x++, i += channels) {
		const r = row[i];
		const g = gray ? r : row[i + 1];
		const b = gray ? r : row[i + 2];
		const a = channels === 2 ? row[i + 1] : channels === 4 ? row[i + 3] : 255;
		const o = columnOf[x] * 4;
		sums[o] += r * a;
		sums[o + 1] += g * a;
		sums[o + 2] += b * a;
		sums[o + 3] += a;
		counts[columnOf[x]]++;
	}
}

// Writes one finished output row as RGBA and clears the accumulators.
function flushRow(out: Buffer, outY: number, width: number, sums: Float64Array, counts: Uint32Array): void {
	for (let x = 0; x < width; x++) {
		const o = x * 4;
		const alpha = sums[o + 3];
		const p = (outY * width + x) * 4;
		if (alpha > 0) {
			out[p] = Math.round(sums[o] / alpha);
			out[p + 1] = Math.round(sums[o + 1] / alpha);
			out[p + 2] = Math.round(sums[o + 2] / alpha);
			out[p + 3] = Math.round(alpha / counts[x]);
		}
	}
	sums.fill(0);
	counts.fill(0);
}

// Decodes a PNG to RGBA at a smaller size by averaging the source pixels that fall in each output cell. Returns undefined
// when the PNG is outside the supported layout or the requested size is not smaller than the source.
export async function decodePngDownscaled({ data, width, height }: { data: Buffer; width: number; height: number }): Promise<{ data: Buffer; width: number; height: number } | undefined> {
	const png = readDownscaleLayout(data);
	if (png === undefined || width > png.width || height > png.height) return undefined;
	const stride = png.width * png.channels;
	const columnOf = new Uint32Array(png.width);
	for (let x = 0; x < png.width; x++) columnOf[x] = Math.floor((x * width) / png.width);
	const sums = new Float64Array(width * 4);
	const counts = new Uint32Array(width);
	const out = Buffer.alloc(width * height * 4);
	let previous = new Uint8Array(stride);
	let current = new Uint8Array(stride);
	let filter = -1;
	let filled = 0;
	let y = 0;
	const inflated = Readable.from(png.idat).pipe(createInflate());
	for await (const chunk of inflated) {
		let at = 0;
		while (at < chunk.length && y < png.height) {
			if (filter < 0) {
				filter = chunk[at];
				at += 1;
				continue;
			}
			const take = Math.min(stride - filled, chunk.length - at);
			current.set(chunk.subarray(at, at + take), filled);
			filled += take;
			at += take;
			if (filled < stride) continue;
			unfilterRow(filter, current, previous, png.channels);
			addRow(current, png.channels, columnOf, sums, counts);
			const outY = Math.floor((y * height) / png.height);
			y += 1;
			if (y === png.height || Math.floor((y * height) / png.height) !== outY) flushRow(out, outY, width, sums, counts);
			[previous, current] = [current, previous];
			filter = -1;
			filled = 0;
		}
		if (y === png.height) break;
	}
	return y === png.height ? { data: out, width, height } : undefined;
}
