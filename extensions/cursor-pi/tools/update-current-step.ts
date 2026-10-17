import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { currentStepArgsError } from "./update-current-step/args.ts";
import { declaration } from "./declarations.ts";

const UPDATE_CURRENT_STEP = declaration("UpdateCurrentStep");
// Footer status key that shows the current step.
const STATUS_KEY = "cursor-pi-current-step";
const RECORDED_TEXT = "Progress update recorded.";

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

// Shows the step in the footer. A call with only the final fields leaves the footer as it is.
export async function executeUpdateCurrentStep(
	params: unknown,
	_signal: AbortSignal | undefined,
	ctx: ExtensionToolContext,
): Promise<{ content: { type: "text"; text: string }[]; details: undefined }> {
	const error = currentStepArgsError(params);
	if (error !== undefined) return { content: [{ type: "text", text: `Error: ${error}` }], details: undefined };
	const step = (params as { current_step?: string }).current_step?.trim() ?? "";
	if (step !== "") ctx.ui.setStatus(STATUS_KEY, step);
	return { content: [{ type: "text", text: RECORDED_TEXT }], details: undefined };
}
