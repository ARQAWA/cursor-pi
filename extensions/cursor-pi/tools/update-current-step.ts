import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const UPDATE_CURRENT_STEP = declaration("UpdateCurrentStep");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: UPDATE_CURRENT_STEP.name,
		label: UPDATE_CURRENT_STEP.name,
		description: UPDATE_CURRENT_STEP.description,
		parameters: UPDATE_CURRENT_STEP.parameters as unknown as TSchema,
		// Not part of the main toolset: registered, but inactive until something activates it.
		defaultActive: false,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeUpdateCurrentStep(params, signal, ctx),
	});
}

export async function executeUpdateCurrentStep(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("UpdateCurrentStep not implemented yet");
}
