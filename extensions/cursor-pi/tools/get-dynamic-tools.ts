import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";

const GET_DYNAMIC_TOOLS = declaration("GetDynamicTools");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: GET_DYNAMIC_TOOLS.name,
		label: GET_DYNAMIC_TOOLS.name,
		description: GET_DYNAMIC_TOOLS.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGetDynamicTools(params, signal, ctx),
	});
}

export async function executeGetDynamicTools(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("GetDynamicTools not implemented yet");
}
