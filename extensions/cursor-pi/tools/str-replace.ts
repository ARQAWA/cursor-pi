// The StrReplace tool: the edit tool Cursor's code gives Anthropic models, registered with the declaration Cursor builds.
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";
import { localEditIO, parseEditArgs, runStrReplace, toolResult, type StrReplaceArgs } from "./edit/common.ts";

const STR_REPLACE = declaration("StrReplace");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: STR_REPLACE.name,
		label: STR_REPLACE.name,
		description: STR_REPLACE.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeStrReplace(params, signal, ctx),
	});
}

export async function executeStrReplace(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext) {
	const parsed = parseEditArgs(params, { path: "string", old_string: "string", new_string: "string" }, { replace_all: "boolean" });
	if ("failure" in parsed) return toolResult(parsed.failure);
	return toolResult(await runStrReplace(parsed.args as unknown as StrReplaceArgs, localEditIO(ctx), signal));
}
