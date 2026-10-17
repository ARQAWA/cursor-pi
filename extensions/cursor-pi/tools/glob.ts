import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";
import { formatGlob, GLOB_CHAR_BUDGET, mapToGlob, toolText, truncateOutput, type ToolText } from "./rg/format.ts";
import { classifyRipgrepMessage, searchWorkspace } from "./rg/search.ts";

const GLOB = declaration("Glob");

interface GlobParams {
	glob_pattern: string;
	target_directory?: string;
}

// Cursor's normalizeGlob: forward slashes, no leading or trailing slash, and a **/ prefix unless present.
function normalizeGlob(glob: string): string {
	let result = glob.replace(/\\/g, "/");
	if (result.startsWith("/")) result = result.substring(1);
	if (result.endsWith("/")) result = result.substring(0, result.length - 1);
	if (!result.startsWith("**/")) result = `**/${result}`;
	return result;
}

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: GLOB.name,
		label: GLOB.name,
		description: GLOB.description,
		parameters: GLOB.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGlob(params, signal, ctx),
	});
}

export async function executeGlob(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<ToolText> {
	const args = params as GlobParams;
	try {
		const glob = normalizeGlob(args.glob_pattern);
		if (glob === "**/") throw new Error('glob_pattern is empty. Pass "*" to match every file.');
		const success = await searchWorkspace(
			{ pattern: "", path: args.target_directory, glob, outputMode: "files_with_matches", caseInsensitive: false, multiline: false },
			ctx.cwd,
			signal,
		);
		const result = mapToGlob(success);
		if (result === undefined) return toolText("glob_file_search didn't return the result");
		return toolText(formatGlob(result, result.path || "."));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// Cursor cuts the message in serializeError and again in the formatter.
		return toolText(truncateOutput(truncateOutput(classifyRipgrepMessage(message), GLOB_CHAR_BUDGET), GLOB_CHAR_BUDGET), true);
	}
}
