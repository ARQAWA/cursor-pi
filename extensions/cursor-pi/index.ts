import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildContextMessageText } from "./context-message.ts";
import { discoverCursorRules, renderRulesSection } from "./rules.ts";
import { promptForModel, SUPPORTED_MODELS } from "./prompts.ts";
import { registerAllTools, registerCapturedToolPayload } from "./tools/index.ts";

// Session entry holding the context text computed on the first run, so resumed sessions reuse it.
const CONTEXT_ENTRY = "cursor-pi-context";

function storedContextText(ctx: ExtensionContext): string | undefined {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === CONTEXT_ENTRY) {
			const text = (entry.data as { text?: unknown } | undefined)?.text;
			if (typeof text === "string") return text;
		}
	}
	return undefined;
}

function registerContextMessage(pi: ExtensionAPI): void {
	// Computes the rules once per session, on its first run.
	pi.on("before_agent_start", async (_event, ctx) => {
		if (storedContextText(ctx) !== undefined) return undefined;
		try {
			const rules = await discoverCursorRules(ctx.cwd);
			pi.appendEntry(CONTEXT_ENTRY, { text: buildContextMessageText({ rules: renderRulesSection(rules, [ctx.cwd]) }) });
		} catch (error) {
			ctx.ui.notify(`Cursor Pi could not load rules: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
		return undefined;
	});
	// Puts the context message before the user's first message in every request.
	pi.on("context", (event, ctx) => {
		const text = storedContextText(ctx);
		if (!text) return undefined;
		const message = { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() };
		return { messages: [message, ...event.messages] };
	});
}

export default function cursorPi(pi: ExtensionAPI): void {
	registerAllTools(pi);
	registerCapturedToolPayload(pi);
	registerContextMessage(pi);
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
