import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";
import { applyPagination, formatSearchError, formatSearchResult, SearchResultCache, toolText, type OutputMode, type ToolText } from "./rg/format.ts";
import { classifyRipgrepMessage, searchWorkspace, type SearchRequest } from "./rg/search.ts";

const RG = declaration("rg");
const MAX_INT32 = 2_147_483_647;
const searchCache = new SearchResultCache();

interface RgParams {
	pattern: string;
	path?: string;
	glob?: string;
	output_mode?: OutputMode;
	"-B"?: number;
	"-A"?: number;
	"-C"?: number;
	"-i"?: boolean;
	type?: string;
	head_limit?: number;
	offset?: number;
	multiline?: boolean;
}

// Cursor's toGrepInt32: rounds the number and clamps it to 0..int32 max.
function toInt32(value: number | undefined, round: (n: number) => number): number | undefined {
	if (value === undefined) return undefined;
	return Math.min(Math.max(round(value), 0), MAX_INT32);
}

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: RG.name,
		label: RG.name,
		description: RG.description,
		parameters: RG.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeRg(params, signal, ctx),
	});
}

export async function executeRg(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<ToolText> {
	const args = params as RgParams;
	try {
		if (args.pattern === "") throw new Error('pattern is empty. Pass "." to match every line.');
		for (const flag of ["-A", "-B", "-C"] as const) {
			const lines = args[flag];
			if (lines !== undefined && lines < 0) throw new Error(`${flag} is ${lines}. Pass 0 or more context lines.`);
		}
		const request: SearchRequest = {
			pattern: args.pattern,
			path: args.path,
			glob: args.glob,
			type: args.type,
			outputMode: args.output_mode ?? "content",
			caseInsensitive: args["-i"] === true,
			multiline: args.multiline === true,
			contextBefore: toInt32(args["-B"], Math.ceil),
			contextAfter: toInt32(args["-A"], Math.ceil),
			context: toInt32(args["-C"], Math.ceil),
		};
		const offset = toInt32(args.offset, Math.floor) ?? 0;
		const headLimit = toInt32(args.head_limit, Math.ceil) || undefined;
		// Cursor caches the full result of the last five searches; pagination runs on the cached result.
		let success = searchCache.get(request);
		if (success === undefined) {
			success = await searchWorkspace(request, ctx.cwd, signal);
			searchCache.set(request, success);
		}
		return toolText(formatSearchResult({ ...success, union: applyPagination(success.union, offset, headLimit) }));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return toolText(formatSearchError(classifyRipgrepMessage(message, args.pattern)), true);
	}
}
