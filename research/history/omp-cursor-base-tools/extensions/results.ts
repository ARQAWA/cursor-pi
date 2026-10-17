import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ANSWER_MAX_CHARS = 80_000;
const OUTPUT_MAX_CHARS = 100_000;
const CHARS_PER_TOKEN = 4;
const BUDGET_TOKENS = 150_000;
const BUDGET_TOKEN_FLOOR = 50_000;

type Fields = Record<string, unknown>;

type ArtifactSource = {
	getArtifactsDir(): string;
	getSessionFile(): string | null | undefined;
};

type TurnBudget = { budgetChars: number; used: number };

// Per agent id, so that concurrent sessions keep their own turn budgets.
const budgets = new Map<string, TurnBudget>();
const answers = new Map<string, string>();
// Structural view of a finalized assistant message that holds a codebase_explorer's yield call.
type AssistantMessageLike = { content: readonly unknown[]; stopReason: unknown };
// The latest finalized assistant message of each codebase_explorer, per agent id.
const explorerMessages = new Map<string, AssistantMessageLike>();

const PREVIEW = /<preview full-output="agent:\/\/([\w-]+)">([\s\S]*?)<\/preview>/g;
const FULL_OUTPUT = /^Full output: artifact:\/\/(\d+)$/gm;
const ELISION = /\[…[^\]\n]*elided…\]/;
const ARTIFACT_REF = /artifact:\/\/(\d+)/;
const FENCE_OPEN = "Command output:\n\n```\n";
const FENCE_CLOSE = "\n```";

function fields(value: unknown): Fields | undefined {
	return typeof value === "object" && value !== null ? (value as Fields) : undefined;
}

// Marks an eval result that carries a nested tool result: results.ts already counted that inner result when it ran.
const NESTED_BUDGET_KEY = "nestedBudgeted";

function nestedBudgeted(event: { toolName: string; details: unknown }): boolean {
	return event.toolName === "eval" && fields(event.details)?.[NESTED_BUDGET_KEY] === true;
}

function artifactsDir(source: ArtifactSource): string | undefined {
	try {
		const dir = source.getArtifactsDir();
		if (dir) return dir;
	} catch {}
	try {
		const session = source.getSessionFile();
		return session ? session.replace(/\.jsonl$/, "") : undefined;
	} catch {
		return undefined;
	}
}

function isRegularFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

// The artifact named `<id>.<ext>` in the artifacts directory.
function artifactFile(dir: string, id: string): string | undefined {
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return undefined;
	}
	const name = names.find(n => n.startsWith(`${id}.`));
	if (name === undefined) return undefined;
	const file = join(dir, name);
	return isRegularFile(file) ? file : undefined;
}

// Cuts text to limit characters and names the continuation line after the cut.
function cutText(text: string, limit: number, label: string, path: string): string {
	if (text.length <= limit) return text;
	const shown = text.slice(0, limit);
	const line = (shown.match(/\n/g)?.length ?? 0) + 1;
	return `${shown}\n[${label} cut at ${limit.toLocaleString("en-US")} characters. Read the rest with read path=${path} offset=${line}]`;
}

// A structured subagent answer is a JSON string literal or object; plain text is returned as it is.
function decodeAnswer(raw: string): string {
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value === "string") return value;
		if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
	} catch {}
	return raw;
}

function answerText(dir: string, id: string, stamp: unknown): string | undefined {
	const key = `${dir}\0${String(stamp)}\0${id}`;
	const cached = answers.get(key);
	if (cached !== undefined) return cached;
	const file = join(dir, `${id}.md`);
	if (!isRegularFile(file)) return undefined;
	const text = decodeAnswer(readFileSync(file, "utf8"));
	answers.set(key, text);
	return text;
}

function rewriteAnswers(text: string, dir: string | undefined, stamp: unknown): string {
	if (dir === undefined) return text;
	return text
		.replace(PREVIEW, (whole: string, id: string) => {
			const full = answerText(dir, id, stamp);
			if (full === undefined) return whole;
			// A whole answer gets omp's own whole-answer envelope; only a longer one stays a cut preview.
			if (full.length <= ANSWER_MAX_CHARS) return `<output>${full}</output>`;
			return `<preview full-output="agent://${id}">${cutText(full, ANSWER_MAX_CHARS, "Answer", `agent://${id}`)}</preview>`;
		})
		.replace(FULL_OUTPUT, (whole: string, id: string) => {
			const file = artifactFile(dir, id);
			if (file === undefined) return whole;
			return `Full output:\n${cutText(readFileSync(file, "utf8"), ANSWER_MAX_CHARS, "Output", file)}`;
		});
}

// Applies rewrite to every text part of a message (or to its string content); returns the same object when nothing changed.
function withText<T>(message: T, rewrite: (text: string) => string): T {
	const record = fields(message);
	if (record === undefined) return message;
	const content = record.content;
	if (typeof content === "string") {
		const text = rewrite(content);
		return text === content ? message : ({ ...record, content: text } as T);
	}
	if (!Array.isArray(content)) return message;
	let changed = false;
	const parts = content.map((part: unknown) => {
		const p = fields(part);
		if (p?.type !== "text" || typeof p.text !== "string") return part;
		const text = rewrite(p.text);
		if (text === p.text) return part;
		changed = true;
		return { ...p, text };
	});
	return changed ? ({ ...record, content: parts } as T) : message;
}

// Bash/eval output that was cut and spilled to an artifact: its fence body (or the whole text) is replaced by the artifact text.
function expandElided(text: string, dir: string): string {
	if (!ELISION.test(text)) return text;
	const ref = text.match(ARTIFACT_REF);
	if (ref === null) return text;
	const file = artifactFile(dir, ref[1]!);
	if (file === undefined) return text;
	const full = readFileSync(file, "utf8");
	const open = text.indexOf(FENCE_OPEN);
	if (open >= 0) {
		const start = open + FENCE_OPEN.length;
		const end = text.lastIndexOf(FENCE_CLOSE);
		if (end >= start) return text.slice(0, start) + cutText(full, OUTPUT_MAX_CHARS, "Output", file) + text.slice(end);
	}
	return cutText(full, OUTPUT_MAX_CHARS, "Output", file);
}

function expandOutputs(content: readonly unknown[], dir: string | undefined): readonly unknown[] {
	if (dir === undefined) return content;
	let changed = false;
	const next = content.map(part => {
		const p = fields(part);
		if (p?.type !== "text" || typeof p.text !== "string") return part;
		const text = expandElided(p.text, dir);
		if (text === p.text) return part;
		changed = true;
		return { ...p, text };
	});
	return changed ? next : content;
}

// Native engine guidance that names gateways this harness does not expose; each rule rewrites one known sentence or clause.
const NATIVE_HINT_RULES: readonly (readonly [RegExp, string])[] = [
	[
		/Coordinate while peers run via `write agent:\/\/<id>` \(or `agent:\/\/all` to broadcast\)\./g,
		"To send an agent message, fetch harness.send_message with get_tools, then call it through eval. Use agent all to send to every agent.",
	],
	[/`write agent:\/\/<id>` messages a live agent\./g, "Send agent messages through the discovered harness.send_message operation via eval."],
	[
		/([\w-]+) is now idle — message it via `write agent:\/\/\1` to follow up; transcript at history:\/\/\1/g,
		"$1 is now idle — follow up through harness.send_message via eval with agent $1; transcript at history://$1",
	],
	[
		/([\w-]+) was stopped but is still resumable — message it via `write agent:\/\/\1` to resume; transcript at history:\/\/\1/g,
		"$1 was stopped but is still resumable — message it through harness.send_message via eval with agent $1 to resume; transcript at history://$1",
	],
	[
		/message them via `write agent:\/\/<id>`/g,
		"message them through the discovered harness.send_message operation via eval",
	],
	[/via `write agent:\/\/<id>` \(`agent:\/\/all` broadcasts\)/g, "through harness.send_message via eval (agent all broadcasts)"],
	[/ `write proc:\/\/<id>\/kill` cancels\/stops; omit `content`\./g, ""],
	[/; clear it with `write proc:\/\/(?:<[\w-]+>|[\w-]+)\/kill`/g, ""],
];

// Child payloads (<output>, <preview>) and the bash output fence keep their bytes; the fence runs to the last closing fence.
const PROTECTED_BLOCKS = /(<output>[\s\S]*?<\/output>|<preview\b[^>]*>[\s\S]*?<\/preview>|Command output:\n\n```\n[\s\S]*\n```)/;

// Tools whose results can carry native engine guidance; `read` qualifies only for proc:// paths.
const HINT_TOOLS = new Set(["task", "wait", "eval", "bash"]);
const ASYNC_RESULT_TYPE = "async-result";

function carriesNativeHints(toolName: string, input: unknown): boolean {
	if (HINT_TOOLS.has(toolName)) return true;
	const path = fields(input)?.path;
	return toolName === "read" && typeof path === "string" && path.startsWith("proc://");
}

// Async-result follow-ups and tool results of HINT_TOOLS; a read result has no path in a message, so it is adapted on tool_result only.
function carriesNativeHintsMessage(message: unknown): boolean {
	const m = fields(message);
	if (m?.role === "toolResult") return typeof m.toolName === "string" && HINT_TOOLS.has(m.toolName);
	return m?.role === "custom" && m.customType === ASYNC_RESULT_TYPE;
}

// Native incoming IRC records end with a generated footer paragraph before `</irc>`; the sender body comes before it and is never rewritten.
const IRC_INCOMING_TYPE = "irc:incoming";
const IRC_CLOSE = "\n</irc>";
const IRC_FOOTER_WRITE = /reply via `write` \(`path: "agent:\/\/([^"]+)"`, `content: "…"`\)/;

function carriesIrcIncoming(message: unknown): boolean {
	const m = fields(message);
	return m?.role === "custom" && m.customType === IRC_INCOMING_TYPE;
}

// Rewrites the reply instruction inside the footer paragraph only; the body, the sender id and the rest of the footer keep their bytes.
function adaptIrcIncomingFooter(text: string): string {
	const close = text.lastIndexOf(IRC_CLOSE);
	if (close < 0) return text;
	const at = text.lastIndexOf("\n\n", close);
	if (at < 0) return text;
	const start = at + 2;
	const footer = text.slice(start, close);
	const next = footer.replace(
		IRC_FOOTER_WRITE,
		(_whole: string, id: string) => `reply through the discovered harness.send_message operation via eval with agent ${id} and content`,
	);
	return next === footer ? text : text.slice(0, start) + next + text.slice(close);
}

function rewriteNativeHints(text: string): string {
	return NATIVE_HINT_RULES.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

// Odd pieces of split() are the protected blocks, which are kept as they are.
function adaptNativeHints(text: string): string {
	return text
		.split(PROTECTED_BLOCKS)
		.map((piece, i) => (i % 2 === 1 ? piece : rewriteNativeHints(piece)))
		.join("");
}

function adaptHintsInContent(content: readonly unknown[]): readonly unknown[] {
	let changed = false;
	const next = content.map(part => {
		const p = fields(part);
		if (p?.type !== "text" || typeof p.text !== "string") return part;
		const text = adaptNativeHints(p.text);
		if (text === p.text) return part;
		changed = true;
		return { ...p, text };
	});
	return changed ? next : content;
}

function budgetTokens(tokens: number, contextWindow: number, configured: unknown): number {
	if (tokens < BUDGET_TOKEN_FLOOR) return BUDGET_TOKENS;
	const threshold =
		typeof configured === "number" && configured > 0
			? configured
			: contextWindow - Math.max(16_384, 0.15 * contextWindow);
	return Math.max(0, Math.floor((threshold - tokens) / 2));
}

// Keeps the first characters of a turn's text that fit its remaining budget; the full text goes to a file.
function budgetContent(
	content: readonly unknown[],
	state: TurnBudget,
	dir: string | undefined,
	toolCallId: string,
): readonly unknown[] | undefined {
	const texts: string[] = [];
	for (const part of content) {
		const p = fields(part);
		if (p?.type === "text" && typeof p.text === "string") texts.push(p.text);
	}
	const full = texts.join("\n");
	if (state.used + full.length <= state.budgetChars) {
		state.used += full.length;
		return undefined;
	}
	if (dir === undefined) {
		state.used += full.length;
		return undefined;
	}
	const shown = full.slice(0, Math.max(0, state.budgetChars - state.used));
	const file = join(dir, `budget-${toolCallId}.txt`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, full);
	state.used += shown.length;
	const line = (shown.match(/\n/g)?.length ?? 0) + 1;
	const notice = `\n[Turn result budget reached: showing ${shown.length} of ${full.length} characters. Full result: ${file}; read it with read path=${file} offset=${line}]`;
	const out: unknown[] = [];
	let placed = false;
	for (const part of content) {
		const p = fields(part);
		if (p?.type !== "text" || typeof p.text !== "string") {
			out.push(part);
		} else if (!placed) {
			placed = true;
			out.push({ ...p, text: `${shown}${notice}` });
		}
	}
	return out;
}

// The text blocks of an assistant message joined with a newline, the way omp joins the text of a yield report.
function assistantText(content: readonly unknown[]): string {
	const texts: string[] = [];
	for (const part of content) {
		const p = fields(part);
		if (p?.type === "text" && typeof p.text === "string") texts.push(p.text);
	}
	return texts.join("\n");
}

// The length of a yield payload: a string's length, or the length of its JSON text.
function payloadSize(data: unknown): number {
	return typeof data === "string" ? data.length : (JSON.stringify(data) ?? "").length;
}

// Whether the last session_init entry leaves the subagent's output without a schema, so that its final text is the answer.
function hasNoOutputSchema(entries: readonly unknown[]): boolean {
	let init: Fields | undefined;
	for (const entry of entries) {
		const record = fields(entry);
		if (record?.type === "session_init") init = record;
	}
	if (init === undefined) return false;
	const schema = init.outputSchema;
	return schema === undefined || schema === null || schema === true;
}

export default function results(pi: ExtensionAPI) {
	pi.on("turn_start", (_event, ctx) => {
		const usage = ctx.getContextUsage();
		const tokens = usage?.tokens ?? 0;
		const contextWindow = usage?.contextWindow ?? 0;
		const configured: unknown = lookup("compaction.thresholdTokens")?.get(pi.pi.settings);
		budgets.set(ctx.agent.id, {
			budgetChars: CHARS_PER_TOKEN * budgetTokens(tokens, contextWindow, configured),
			used: 0,
		});
	});

	pi.on("context", (event, ctx) => {
		try {
			const dir = artifactsDir(ctx.sessionManager);
			let changed = false;
			const messages = event.messages.map(message => {
				const ircAdapted = carriesIrcIncoming(message) ? withText(message, adaptIrcIncomingFooter) : message;
				const hinted = carriesNativeHintsMessage(ircAdapted) ? withText(ircAdapted, adaptNativeHints) : ircAdapted;
				const next = withText(hinted, text => rewriteAnswers(text, dir, fields(message)?.timestamp));
				if (next !== message) changed = true;
				return next;
			});
			return changed ? { messages } : undefined;
		} catch {
			return undefined;
		}
	});

	// A codebase_explorer may write its report as text in the message that calls yield and pass only a short note in data; omp then delivers the note alone. Such a yield drops its data, so omp takes the message text as the report.
	pi.on("assistant_message", (event, ctx) => {
		try {
			if (ctx.agent.kind === "sub" && ctx.agent.name === "codebase_explorer") explorerMessages.set(ctx.agent.id, event.message);
			return undefined;
		} catch {
			return undefined;
		}
	});

	pi.on("tool_call", (event, ctx) => {
		try {
			if (event.toolName !== "yield" || ctx.agent.kind !== "sub" || ctx.agent.name !== "codebase_explorer") return undefined;
			const message = explorerMessages.get(ctx.agent.id);
			explorerMessages.delete(ctx.agent.id);
			if (message === undefined) return undefined;
			const input = event.input as Fields;
			const calls = message.content.filter(part => fields(part)?.type === "toolCall");
			if (calls.length !== 1 || fields(calls[0])?.id !== event.toolCallId) return undefined;
			if (message.stopReason === "error" || message.stopReason === "aborted" || message.stopReason === "length") return undefined;
			const report = assistantText(message.content);
			if (report.trim() === "") return undefined;
			if (input.data === undefined || input.error !== undefined || Array.isArray(input.type)) return undefined;
			if (!hasNoOutputSchema(ctx.sessionManager.getEntries())) return undefined;
			if (payloadSize(input.data) >= report.length) return undefined;
			return { input: { type: typeof input.type === "string" ? input.type : "result" } };
		} catch {
			return undefined;
		}
	});

	pi.on("tool_result", (event, ctx) => {
		try {
			const dir = artifactsDir(ctx.sessionManager);
			let content: readonly unknown[] = event.content;
			let changed = false;
			if (carriesNativeHints(event.toolName, event.input)) {
				const adapted = adaptHintsInContent(content);
				if (adapted !== content) {
					content = adapted;
					changed = true;
				}
			}
			if (event.toolName === "bash" || event.toolName === "eval") {
				const next = expandOutputs(content, dir);
				if (next !== content) {
					content = next;
					changed = true;
				}
			}
			const state = budgets.get(ctx.agent.id);
			if (state !== undefined && !nestedBudgeted(event)) {
				const next = budgetContent(content, state, dir, event.toolCallId);
				if (next !== undefined) {
					content = next;
					changed = true;
				}
			}
			return changed ? { content: content as typeof event.content } : undefined;
		} catch {
			return undefined;
		}
	});
}
