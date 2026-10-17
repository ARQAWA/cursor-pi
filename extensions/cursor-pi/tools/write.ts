// The Write tool: the edit tool Cursor's code gives Anthropic models, registered with the declaration Cursor builds.
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";
import { localEditIO, parseEditArgs, runWrite, toolResult, type WriteArgs } from "./edit/common.ts";

const WRITE = declaration("Write");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: WRITE.name,
		label: WRITE.name,
		description: WRITE.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeWrite(params, signal, ctx),
	});
}

export async function executeWrite(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext) {
	const parsed = parseEditArgs(params, { path: "string", contents: "string" }, {});
	if ("failure" in parsed) return toolResult(parsed.failure);
	return toolResult(await runWrite(parsed.args as unknown as WriteArgs, localEditIO(ctx), signal));
}
