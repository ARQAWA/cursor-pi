import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";
import { runApplyPatch } from "./apply-patch/edit-flow.ts";
import { createLocalPatchIO } from "./apply-patch/local-io.ts";

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

export async function executeApplyPatch(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext) {
	const input = (params as { input?: unknown } | undefined)?.input;
	const io = createLocalPatchIO({
		workspace: ctx.cwd,
		approve: (title, message) => (ctx.hasUI ? ctx.ui.confirm(title, message) : Promise.resolve(false)),
	});
	const result = await runApplyPatch(typeof input === "string" ? input : "", io, signal);
	return { content: [{ type: "text" as const, text: result.text }], details: undefined, isError: result.isError };
}
