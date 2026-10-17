import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { promptForModel } from "../prompts.ts";
import { compactWithClaude } from "./claude.ts";
import { compactWithCodex, resolveCodexItem } from "./codex.ts";
import { type AgentMessage, compactionLimit, expandCompactionMessages, latestCompaction, userMessage } from "./entries.ts";
import { CLAUDE_CONTEXT_COMPACTED_HEADERS } from "./texts.ts";

function contextMessageOf(
	ctx: ExtensionContext,
	contextText: (ctx: ExtensionContext) => string | undefined,
): AgentMessage | undefined {
	const text = contextText(ctx);
	return text === undefined ? undefined : userMessage(text);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Pi's own threshold check is off (compaction.enabled is false), so the native threshold runs here, when a run settles.
async function compactWhenOverLimit(ctx: ExtensionContext): Promise<void> {
	const limit = compactionLimit(ctx.model);
	const tokens = ctx.getContextUsage()?.tokens;
	if (limit === undefined || tokens === null || tokens === undefined || tokens < limit) return;
	try {
		await new Promise<void>((resolve, reject) => ctx.compact({ onComplete: () => resolve(), onError: reject }));
	} catch (error) {
		ctx.ui.notify(`Cursor Pi could not compact the context: ${messageOf(error)}`, "error");
	}
}

// Compaction is provider-native: Codex's remote compaction for GPT models on openai-codex, Claude Code's summary for Claude
// models on anthropic. Pi's summarizer never runs, because every compaction returns a result from here or is cancelled.
export function registerCompaction(pi: ExtensionAPI, contextText: (ctx: ExtensionContext) => string | undefined): void {
	pi.on("session_before_compact", async (event, ctx) => {
		try {
			const model = ctx.model;
			const contextMessage = contextMessageOf(ctx, contextText);
			if (model !== undefined && promptForModel(model.id) !== undefined) {
				if (model.provider === "openai-codex") {
					return { compaction: await compactWithCodex(pi, ctx, event.signal, contextMessage) };
				}
				if (model.provider === "anthropic") {
					return { compaction: await compactWithClaude(pi, ctx, event.signal, contextMessage) };
				}
			}
			throw new Error(`no compaction for ${model?.provider ?? "no provider"} ${model?.id ?? "model"}`);
		} catch (error) {
			// An error here must not reach Pi's summarizer, so the compaction is cancelled.
			ctx.ui.notify(`Cursor Pi could not compact the context: ${messageOf(error)}`, "error");
			return { cancel: true };
		}
	});

	// The next request carries the compaction: the retained messages and the item for Codex, the summary for Claude.
	pi.on("context", (event, ctx) => {
		const messages = expandCompactionMessages(ctx, event.messages);
		return messages === event.messages ? undefined : { messages };
	});

	// A Codex request puts the session's compaction item where its marker message stands.
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.api !== "openai-codex-responses") return undefined;
		const next = resolveCodexItem(event.payload, ctx);
		return next === event.payload ? undefined : next;
	});

	// The first request after a Claude compaction carries Claude Code's context-compacted headers, once.
	let announced: string | undefined;
	pi.on("before_provider_headers", (event, ctx) => {
		if (ctx.model?.provider !== "anthropic") return;
		const entry = latestCompaction(ctx);
		if (entry?.details?.kind !== "claude" || entry.id === announced) return;
		announced = entry.id;
		Object.assign(event.headers, CLAUDE_CONTEXT_COMPACTED_HEADERS);
	});

	// Runs when a run settles, not before the next run: compact() aborts the run it is called from, so awaiting it inside
	// before_agent_start would wait on the run that waits for it.
	pi.on("agent_settled", (_event, ctx) => compactWhenOverLimit(ctx));
}
