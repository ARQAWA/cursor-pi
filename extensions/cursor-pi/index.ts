import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promptForModel, SUPPORTED_MODELS } from "./prompts.ts";

export default function cursorPi(pi: ExtensionAPI): void {
	// A returned systemPrompt replaces the whole system prompt for the run.
	pi.on("before_agent_start", (_event, ctx) => {
		const prompt = ctx.model ? promptForModel(ctx.model.id) : undefined;
		return prompt ? { systemPrompt: prompt.text } : undefined;
	});

	pi.on("input", (_event, ctx) => {
		if (ctx.model && promptForModel(ctx.model.id)) return { action: "continue" };
		ctx.ui.notify(
			`Cursor Pi has no prompt for model ${ctx.model?.id ?? "none"}. Supported: ${SUPPORTED_MODELS.join(", ")}`,
			"error",
		);
		return { action: "handled" };
	});
}
