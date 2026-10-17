import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildContextMessageText } from "./context-message.ts";
import { resolveTimeZone, wrapUserTurn } from "./user-turn.ts";
import { promptForModel, SUPPORTED_MODELS } from "./prompts.ts";
import { registerAllTools, registerCapturedToolPayload } from "./tools/index.ts";
import { register as registerTranscripts } from "./transcripts.ts";
import { registerGoalContinuation } from "./goals/continuation.ts";
import { setMcpApprovalPrompt, type McpApprovalRequest } from "./mcp/index.ts";

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

// An MCP server that is not approved yet is asked about in the Pi dialog. Without a UI, it is skipped.
function registerMcpApprovals(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (_event, ctx) => {
		setMcpApprovalPrompt(
			ctx.hasUI
				? (request: McpApprovalRequest) =>
						ctx.ui.confirm(
							"Allow MCP server?",
							`${request.name} (${request.configPath})\n${"command" in request.server ? [request.server.command, ...(request.server.args ?? [])].join(" ") : request.server.url}`,
						)
				: undefined,
		);
		return undefined;
	});
}

function registerContextMessage(pi: ExtensionAPI): void {
	// Builds the context message once per session, on its first run.
	pi.on("before_agent_start", async (_event, ctx) => {
		if (storedContextText(ctx) !== undefined) return undefined;
		try {
			const text = await buildContextMessageText({ cwd: ctx.cwd, sessionId: ctx.sessionManager.getSessionId() });
			pi.appendEntry(CONTEXT_ENTRY, { text });
		} catch (error) {
			ctx.ui.notify(`Cursor Pi could not build the context message: ${error instanceof Error ? error.message : String(error)}`, "error");
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
	registerTranscripts(pi);
	registerGoalContinuation(pi);
	registerMcpApprovals(pi);
	// A returned systemPrompt replaces the whole system prompt for the run.
	pi.on("before_agent_start", (_event, ctx) => {
		const prompt = ctx.model ? promptForModel(ctx.model.id) : undefined;
		return prompt ? { systemPrompt: prompt.text } : undefined;
	});

	pi.on("input", (event, ctx) => {
		if (ctx.model && promptForModel(ctx.model.id)) {
			return { action: "transform", text: wrapUserTurn(event.text, new Date(), resolveTimeZone()) };
		}
		ctx.ui.notify(
			`Cursor Pi has no prompt for model ${ctx.model?.id ?? "none"}. Supported: ${SUPPORTED_MODELS.join(", ")}`,
			"error",
		);
		return { action: "handled" };
	});
}
