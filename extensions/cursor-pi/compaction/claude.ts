import type { ExtensionAPI, ExtensionContext, ProjectedSessionEntry } from "@earendil-works/pi-coding-agent";
import { type AgentMessage, expandCompactionMessages, tokensBeforeOf } from "./entries.ts";
import { callNative, type LlmMessage } from "./native.ts";
import { CLAUDE_COMPACTION_HEADERS, compactionInstruction, summaryOf } from "./texts.ts";

// Claude Code's instruction goes at the end of the last user message: a newline after the user's text, then the instruction
// as its own text part.
export function appendInstruction(messages: LlmMessage[]): LlmMessage[] {
	const instruction = { type: "text" as const, text: compactionInstruction() };
	const last = messages.at(-1);
	if (last?.role !== "user") {
		return [...messages, { role: "user", content: [instruction], timestamp: Date.now() } as LlmMessage];
	}
	const parts = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : [...last.content];
	const tail = parts.at(-1);
	if (tail?.type === "text") parts[parts.length - 1] = { ...tail, text: `${tail.text}\n` };
	return [...messages.slice(0, -1), { ...last, content: [...parts, instruction] } as LlmMessage];
}

function withoutCacheControl(block: unknown): unknown {
	if (block === null || typeof block !== "object" || !("cache_control" in block)) return block;
	const { cache_control: _cacheControl, ...rest } = block as Record<string, unknown>;
	return rest;
}

// Claude Code's cache marker for a compaction request: one ephemeral marker, on the last block of the last assistant message
// that is sent. Markers on other messages are removed.
export function withLastAssistantCacheControl(payload: unknown): unknown {
	const body = payload as { messages?: { role?: unknown; content?: unknown }[] };
	if (!Array.isArray(body.messages)) return payload;
	const messages = body.messages.map((message) => ({
		...message,
		content: Array.isArray(message.content) ? message.content.map(withoutCacheControl) : message.content,
	}));
	const last = messages.findLastIndex((message) => message.role === "assistant");
	if (last >= 0) {
		const content = messages[last].content;
		const blocks = Array.isArray(content) ? [...content] : [{ type: "text", text: String(content) }];
		const tail = blocks.length - 1;
		blocks[tail] = { ...(blocks[tail] as object), cache_control: { type: "ephemeral" } };
		messages[last] = { ...messages[last], content: blocks };
	}
	return { ...body, messages };
}

function keptEntryId(entries: ProjectedSessionEntry[], message: AgentMessage): string {
	const entry = entries.find((projected) => projected.messages.includes(message));
	if (entry === undefined) throw new Error("the first kept message has no session entry");
	return entry.sourceEntry.id;
}

// Claude Code's compaction: the conversation up to its last round is summarized, and the last round is kept verbatim. The
// summary goes into the entry; the continuation message that carries it is written when the next request is built.
export async function compactWithClaude(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	contextMessage: AgentMessage | undefined,
) {
	const projection = ctx.sessionManager.buildSessionProjection();
	const history = expandCompactionMessages(ctx, projection.messages);
	const cut = history.findLastIndex((message) => message.role === "assistant");
	const summarized = cut < 0 ? history : history.slice(0, cut);
	if (summarized.length === 0) throw new Error("Nothing to compact");
	const firstKept = cut < 0 ? undefined : keptEntryId(projection.entries, history[cut]);
	const reply = await callNative(pi, ctx, {
		messages: contextMessage === undefined ? summarized : [contextMessage, ...summarized],
		signal,
		headers: CLAUDE_COMPACTION_HEADERS,
		transformLlm: appendInstruction,
		onPayload: withLastAssistantCacheControl,
	});
	const text = reply.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
	return {
		summary: summaryOf(text),
		// Null keeps no entry before the compaction; the kept round is the one that Claude Code keeps verbatim.
		firstKeptEntryId: (firstKept ?? null) as unknown as string,
		tokensBefore: tokensBeforeOf(ctx),
		details: { kind: "claude" as const },
	};
}
