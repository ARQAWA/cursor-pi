import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentMessage, expandCompactionMessages, latestCompaction, tokensBeforeOf } from "./entries.ts";
import { callNative } from "./native.ts";
import { CODEX_ITEM_MARKER } from "./texts.ts";

// Codex's budget for the user messages that a remote compaction retains (RETAINED_MESSAGE_TOKEN_BUDGET).
const RETAINED_MESSAGE_TOKEN_BUDGET = 64_000;

type UserMessage = Extract<AgentMessage, { role: "user" }>;
type UserPart = Exclude<UserMessage["content"], string>[number];

// Codex's approximate token count of a text: one token per four bytes, rounded up.
function approxTokens(text: string): number {
	return Math.ceil(Buffer.byteLength(text, "utf8") / 4);
}

function textsOf(message: UserMessage): string[] {
	return typeof message.content === "string"
		? [message.content]
		: message.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
}

function isMarkerMessage(message: UserMessage): boolean {
	return textsOf(message).includes(CODEX_ITEM_MARKER);
}

// The longest prefix of the text that is at most the given number of bytes, cut at a character boundary.
function cutToBytes(text: string, bytes: number): string {
	let used = 0;
	let kept = "";
	for (const character of text) {
		const size = Buffer.byteLength(character, "utf8");
		if (used + size > bytes) break;
		used += size;
		kept += character;
	}
	return kept;
}

// The message with its text cut to the token budget, as Codex cuts an oversized message: the newest text is kept and nothing
// after it. Undefined when no text is left.
function cutMessage(message: UserMessage, tokens: number): UserMessage | undefined {
	if (typeof message.content === "string") {
		const text = cutToBytes(message.content, tokens * 4);
		return text === "" ? undefined : { ...message, content: text };
	}
	let left = tokens;
	const content: UserPart[] = [];
	for (const part of message.content) {
		if (part.type !== "text") {
			content.push(part);
			continue;
		}
		if (left <= 0) continue;
		const need = approxTokens(part.text);
		if (need <= left) {
			content.push(part);
			left -= need;
			continue;
		}
		content.push({ ...part, text: cutToBytes(part.text, left * 4) });
		left = 0;
	}
	const kept: UserMessage = { ...message, content };
	return textsOf(kept).some((text) => text !== "") ? kept : undefined;
}

// Codex's retention for a remote compaction: the user messages, newest first, within the budget. The kept messages keep
// their original order.
export function retainUserMessages(messages: AgentMessage[]): UserMessage[] {
	let remaining = RETAINED_MESSAGE_TOKEN_BUDGET;
	const kept: UserMessage[] = [];
	for (const message of messages.slice().reverse()) {
		if (remaining <= 0 || message.role !== "user" || isMarkerMessage(message)) continue;
		const tokens = Math.max(1, textsOf(message).reduce((sum, text) => sum + approxTokens(text), 0));
		if (tokens <= remaining) {
			kept.push(message);
			remaining -= tokens;
			continue;
		}
		const cut = cutMessage(message, remaining);
		if (cut === undefined) continue;
		kept.push(cut);
		remaining = 0;
	}
	return kept.reverse();
}

// The compaction item in a stream event, when the event carries one.
export function compactionItemOf(event: unknown): unknown {
	const { type, item } = (event ?? {}) as { type?: unknown; item?: { type?: unknown } };
	return type === "response.output_item.done" && item?.type === "compaction" ? item : undefined;
}

function isMarkerItem(item: unknown): boolean {
	const content = (item as { content?: unknown } | null)?.content;
	if (typeof content === "string") return content === CODEX_ITEM_MARKER;
	return Array.isArray(content) && content.some((part) => (part as { text?: unknown }).text === CODEX_ITEM_MARKER);
}

// The payload with each marker message replaced by the session's Codex compaction item, as the server returned it.
export function resolveCodexItem(payload: unknown, ctx: ExtensionContext): unknown {
	const body = payload as { input?: unknown[] };
	if (!Array.isArray(body.input) || !body.input.some(isMarkerItem)) return payload;
	const entry = latestCompaction(ctx);
	if (entry?.details?.kind !== "codex") {
		throw new Error("the request has a compaction marker, but the session has no Codex compaction");
	}
	const item = entry.details.item;
	return { ...body, input: body.input.map((input) => (isMarkerItem(input) ? item : input)) };
}

// Codex's remote compaction request: the session's request with the compaction trigger as its last item.
export function withCompactionTrigger(payload: unknown): unknown {
	const body = payload as { input?: unknown[] };
	return { ...body, input: [...(body.input ?? []), { type: "compaction_trigger" }] };
}

// The compaction result for a Codex remote compaction. The entry has no summary text: the item is what the next request carries.
export async function compactWithCodex(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	contextMessage: AgentMessage | undefined,
) {
	const history = expandCompactionMessages(ctx, ctx.sessionManager.buildSessionProjection().messages);
	const retained = retainUserMessages(history);
	let item: unknown;
	await callNative(pi, ctx, {
		messages: contextMessage === undefined ? history : [contextMessage, ...history],
		signal,
		headers: { "x-codex-beta-features": "remote_compaction_v2" },
		onPayload: (payload) => withCompactionTrigger(resolveCodexItem(payload, ctx)),
		onProviderStreamEvent: (data) => {
			const found = compactionItemOf(data);
			if (found === undefined) return;
			if (item !== undefined) throw new Error("Codex returned more than one compaction item");
			item = found;
		},
	});
	if (item === undefined) throw new Error("Codex returned no compaction item");
	return {
		summary: "",
		// Null keeps no entry before the compaction, so Pi projects the compaction entry and the entries after it.
		firstKeptEntryId: null as unknown as string,
		tokensBefore: tokensBeforeOf(ctx),
		details: { kind: "codex" as const, item, retained },
	};
}
