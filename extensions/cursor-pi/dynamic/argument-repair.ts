// Cursor's lenient reading of a stringified `arguments` value (dynamic-tool-argument-repair.js): the whole text as an object,
// the one object the text can be read as, or the object in front of leaked <parameter> markup.
import { jsonTokens, namesAKeyTwice } from "../tools/cursor-args.ts";

type JsonObject = Record<string, unknown>;

export interface LenientArguments {
	args: JsonObject;
	repaired: boolean;
	envelopeFields?: Record<string, string>;
}

const READING_SEARCH_BUDGET = 250_000;
const LEAKED_PARAMETER = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)(?=<(?:antml:)?parameter\b|<\/|$)/gi;

function parseJsonObject(text: string): JsonObject | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : undefined;
	} catch {
		return undefined;
	}
}

function parseWholeObject(text: string): JsonObject | undefined {
	return namesAKeyTwice(text) ? undefined : parseJsonObject(text);
}

function decodeLeadingJsonObject(blob: string): { value: JsonObject; rest: string } | undefined {
	const start = blob.indexOf("{");
	if (start < 0) return undefined;
	let depth = 0;
	for (const token of jsonTokens(blob, start)) {
		if (token.kind !== "punctuation") continue;
		if (token.char === "{") depth++;
		else if (token.char === "}" && --depth === 0) {
			const value = parseJsonObject(blob.slice(start, token.index + 1));
			return value === undefined ? undefined : { value, rest: blob.slice(token.index + 1) };
		}
	}
	return undefined;
}

function structuralClosingBraces(blob: string, start: number): number[] {
	const out: number[] = [];
	for (const token of jsonTokens(blob, start)) {
		if (token.kind === "punctuation" && token.char === "}") out.push(token.index);
	}
	return out;
}

function readLeakedParameters(markup: string): Record<string, string> | undefined {
	const fields: Record<string, string> = {};
	for (const match of markup.matchAll(LEAKED_PARAMETER)) {
		const name = match[1];
		const value = match[2];
		if (name !== undefined && value !== undefined && value.trim() !== "") fields[name] = value.trim();
	}
	return Object.keys(fields).length > 0 ? fields : undefined;
}

// Every distinct object the text can be read as by dropping one closing brace; undefined when the search is too large.
function faithfulReadings(blob: string): JsonObject[] | undefined {
	const start = blob.indexOf("{");
	if (start < 0) return [];
	const closingBraces = structuralClosingBraces(blob, start);
	if (closingBraces.length * blob.length > READING_SEARCH_BUDGET) return undefined;
	const byFingerprint = new Map<string, JsonObject>();
	const add = (value: JsonObject | undefined) => {
		if (value === undefined) return;
		const fingerprint = JSON.stringify(value);
		if (!byFingerprint.has(fingerprint)) byFingerprint.set(fingerprint, value);
	};
	const decoded = decodeLeadingJsonObject(blob);
	const leading = decoded !== undefined && !namesAKeyTwice(blob.slice(start, blob.length - decoded.rest.length)) ? decoded : undefined;
	const tail = leading?.rest.trim() ?? "";
	if (leading !== undefined && /^[\s,\]}]*$/.test(tail)) add(leading.value);
	for (const index of closingBraces) add(parseWholeObject(blob.slice(start, index) + blob.slice(index + 1)));
	return [...byFingerprint.values()];
}

export function parseArgumentsLeniently(blob: string): LenientArguments | undefined {
	const direct = parseJsonObject(blob);
	if (direct !== undefined) return { args: direct, repaired: false };
	const readings = faithfulReadings(blob);
	if (readings === undefined || readings.length > 1) return undefined;
	if (readings.length === 1) return { args: readings[0] ?? {}, repaired: true };
	const decoded = decodeLeadingJsonObject(blob);
	const leaked = decoded === undefined ? undefined : readLeakedParameters(decoded.rest.trim());
	if (decoded === undefined || leaked === undefined) return undefined;
	return Object.keys(leaked).some((field) => field !== "description") ? undefined : { args: decoded.value, repaired: true, envelopeFields: leaked };
}
