import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const CALL_DYNAMIC_TOOL = declaration("CallDynamicTool");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: CALL_DYNAMIC_TOOL.name,
		label: CALL_DYNAMIC_TOOL.name,
		description: CALL_DYNAMIC_TOOL.description,
		parameters: CALL_DYNAMIC_TOOL.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeCallDynamicTool(params, signal, ctx),
	});
}

export async function executeCallDynamicTool(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("CallDynamicTool not implemented yet");
}
