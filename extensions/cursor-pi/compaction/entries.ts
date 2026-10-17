import {
	type CompactionEntry,
	type ExtensionContext,
	getLatestCompactionEntry,
	type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import { promptForModel } from "../prompts.ts";
import { transcriptPathOf } from "../transcripts.ts";
import { CODEX_ITEM_MARKER, continuationText } from "./texts.ts";

export type AgentMessage = SessionMessageEntry["message"];

// What Cursor Pi keeps in a compaction entry. Codex keeps the server's compaction item and the user messages it retains;
// Claude keeps nothing beyond the entry's summary text.
export interface CodexCompaction {
	kind: "codex";
	item: unknown;
	retained: AgentMessage[];
}
export interface ClaudeCompaction {
	kind: "claude";
}
export type CursorCompactionEntry = CompactionEntry<CodexCompaction | ClaudeCompaction>;

// Claude Code's own threshold: the window less the reserve for the summary, less the auto-compact buffer.
const CLAUDE_SUMMARY_RESERVE = 20_000;
const CLAUDE_AUTOCOMPACT_BUFFER = 13_000;

// The compaction entry that the current branch projects, when Cursor Pi wrote it.
export function latestCompaction(ctx: ExtensionContext): CursorCompactionEntry | undefined {
	const entry = getLatestCompactionEntry(ctx.sessionManager.getBranch());
	return entry?.details === undefined ? undefined : (entry as CursorCompactionEntry);
}

// The projected messages with the latest compaction written out. Pi projects it as one summary message; Codex keeps its
// retained user messages and then the compaction item, and Claude keeps its continuation message.
export function expandCompactionMessages(ctx: ExtensionContext, messages: AgentMessage[]): AgentMessage[] {
	const entry = latestCompaction(ctx);
	const index = messages.findIndex((message) => message.role === "compactionSummary");
	if (entry === undefined || index < 0) return messages;
	const written =
		entry.details?.kind === "codex"
			? [...entry.details.retained, userMessage(CODEX_ITEM_MARKER, entry.timestamp)]
			: [userMessage(continuationText(entry.summary, transcriptPathOf(ctx)), entry.timestamp)];
	return [...messages.slice(0, index), ...written, ...messages.slice(index + 1)];
}

export function userMessage(text: string, timestamp: string | number = Date.now()): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: typeof timestamp === "number" ? timestamp : Date.parse(timestamp),
	};
}

// The tokens of the context before a compaction, as Pi estimates them.
export function tokensBeforeOf(ctx: ExtensionContext): number {
	return ctx.getContextUsage()?.tokens ?? 0;
}

// The context size at which a run compacts first: Codex's auto-compact limit (its default is 90% of the window), or Claude
// Code's threshold. Undefined for a model Cursor Pi has no compaction for.
export function compactionLimit(model: ExtensionContext["model"]): number | undefined {
	if (model === undefined || promptForModel(model.id) === undefined) return undefined;
	if (model.provider === "openai-codex") return Math.floor((model.contextWindow * 9) / 10);
	if (model.provider === "anthropic") {
		return model.contextWindow - Math.min(model.maxTokens, CLAUDE_SUMMARY_RESERVE) - CLAUDE_AUTOCOMPACT_BUFFER;
	}
	return undefined;
}
