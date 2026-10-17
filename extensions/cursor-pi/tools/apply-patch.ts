import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const APPLY_PATCH = declaration("ApplyPatch");
const LARK_GRAMMAR = APPLY_PATCH.format?.definition as string;
// The captured ApplyPatch has no parameters. Grammar sampling needs an object with exactly one required string
// property, so the patch text arrives as `input`, which is Pi's default grammar input property.
const GRAMMAR_CARRIER = { type: "object", properties: { input: { type: "string" } }, required: ["input"] };

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: APPLY_PATCH.name,
		label: APPLY_PATCH.name,
		description: APPLY_PATCH.description,
		parameters: GRAMMAR_CARRIER as unknown as TSchema,
		constrainedSampling: { type: "grammar", variants: { openai_lark: LARK_GRAMMAR } },
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeApplyPatch(params, signal, ctx),
	});
}

export async function executeApplyPatch(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("ApplyPatch not implemented yet");
}
