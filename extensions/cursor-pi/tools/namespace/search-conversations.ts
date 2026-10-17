import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { type ArgIssue, checkType, invalidArguments } from "../cursor-args.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";

// Cursor's SearchConversations (agent/dist/tools/core/search-conversations/search-conversations.js, its executor and its
// formatter in record-ci-investigation-findings.js), for the cursor namespace. The index is a scan of the transcripts Pi writes
// under ~/.cursor-pi/projects/<slug>/agent-transcripts/<id>/<id>.jsonl.
const NAMESPACE = "cursor";
const SEARCH_CONVERSATIONS = capturedNamespaceDeclaration("SearchConversations");
// Cursor's executor: the default and maximum limits, and the deadline the search runs under.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SEARCH_DEADLINE_MS = 1500;
// Cursor's title cap, and the snippet window around the first body match.
const TITLE_LIMIT = 512;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 80;
const EMPTY_QUERY = "Query must not be empty";
const CANCELLED = "Search cancelled";

export interface SearchHit {
	conversationId: string;
	title: string;
	source: "local";
	updatedAtMs: number;
	snippet?: string;
}

export interface SearchSuccess {
	hits: SearchHit[];
	truncated: boolean;
	partial: boolean;
	rebuilding: boolean;
}

interface Conversation {
	id: string;
	title: string;
	texts: string[];
	updatedAtMs: number;
}

interface TranscriptFile {
	id: string;
	path: string;
	updatedAtMs: number;
}

interface BodyText {
	text: string;
	lower: string;
}

export function register(): void {
	registerDynamicTool({ namespace: NAMESPACE, declaration: SEARCH_CONVERSATIONS, conciseInstructions: capturedConciseInstruction(SEARCH_CONVERSATIONS.name), execute: executeSearchConversations });
}

// Argument errors come from Cursor's zod parse before the executor runs, so they are errors; so are the executor's errors.
export async function executeSearchConversations(params: unknown, signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const issues: ArgIssue[] = [];
	const args = parseArgs(params, issues);
	if (args === undefined) return { text: invalidArguments(issues), isError: true };
	const outcome = searchConversations(args.query, args.limit, signal, Date.now() + SEARCH_DEADLINE_MS);
	if ("error" in outcome) return { text: outcome.error, isError: true };
	return { text: renderSearchResult(outcome), isError: false };
}

// zod's reading of the schema: query is a string of at least one character; limit is an optional integer from 1 to 100.
function parseArgs(params: unknown, issues: ArgIssue[]): { query: string; limit: number } | undefined {
	if (!checkType(params, "object", [], issues)) return undefined;
	const fields = params as Record<string, unknown>;
	if (checkType(fields.query, "string", ["query"], issues) && (fields.query as string).length < 1) {
		issues.push({ path: ["query"], message: "String must contain at least 1 character(s)" });
	}
	let limit = DEFAULT_LIMIT;
	if (fields.limit !== undefined && checkType(fields.limit, "number", ["limit"], issues)) {
		const value = fields.limit as number;
		if (!Number.isInteger(value)) issues.push({ path: ["limit"], message: "Expected integer, received float" });
		if (value < 1) issues.push({ path: ["limit"], message: "Number must be greater than or equal to 1" });
		if (value > MAX_LIMIT) issues.push({ path: ["limit"], message: "Number must be less than or equal to 100" });
		limit = value;
	}
	if (issues.length > 0) return undefined;
	return { query: fields.query as string, limit };
}

// Cursor's search: every term must match the same conversation, a quoted phrase as one term. The newest matches come first,
// one more than the limit is found to know whether results were omitted, and the scan stops at the deadline as partial.
export function searchConversations(query: string, limit: number, signal: AbortSignal | undefined, deadlineAt: number): SearchSuccess | { error: string } {
	const terms = parseTerms(query);
	if (terms.length === 0) return { error: EMPTY_QUERY };
	const matches: SearchHit[] = [];
	let partial = false;
	for (const transcript of transcriptsNewestFirst()) {
		if (signal?.aborted) return { error: CANCELLED };
		if (Date.now() > deadlineAt) {
			partial = true;
			break;
		}
		const conversation = readConversation(transcript);
		if (conversation === undefined) continue;
		const hit = matchConversation(conversation, terms);
		if (hit !== undefined) matches.push(hit);
	}
	matches.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.conversationId.localeCompare(b.conversationId));
	return { hits: matches.slice(0, limit), truncated: matches.length > limit, partial, rebuilding: false };
}

// Unquoted words and quoted phrases, in lower case; empty ones are dropped.
function parseTerms(query: string): string[] {
	const terms: string[] = [];
	for (const match of query.matchAll(/"([^"]*)"|(\S+)/g)) {
		const term = (match[1] ?? match[2] ?? "").trim().toLowerCase();
		if (term !== "") terms.push(term);
	}
	return terms;
}

// Cursor's projects are the folders under ~/.cursor-pi/projects; the search covers all of them, newest transcript first.
function projectsRoot(): string {
	return join(homedir(), ".cursor-pi", "projects");
}

function entriesOf(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function transcriptsNewestFirst(): TranscriptFile[] {
	const files: TranscriptFile[] = [];
	for (const project of entriesOf(projectsRoot())) {
		const transcripts = join(projectsRoot(), project, "agent-transcripts");
		for (const id of entriesOf(transcripts)) {
			const path = join(transcripts, id, `${id}.jsonl`);
			try {
				files.push({ id, path, updatedAtMs: Math.trunc(statSync(path).mtimeMs) });
			} catch {
				continue;
			}
		}
	}
	return files.sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id));
}

function flatten(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

interface TranscriptLine {
	role?: unknown;
	message?: { content?: unknown };
}

// The visible user and assistant text of one transcript; its title is the first user query. Other lines are skipped.
function readConversation(transcript: TranscriptFile): Conversation | undefined {
	let content: string;
	try {
		content = readFileSync(transcript.path, "utf8");
	} catch {
		return undefined;
	}
	const texts: string[] = [];
	let title: string | undefined;
	for (const line of content.split("\n")) {
		if (line.trim() === "") continue;
		let entry: TranscriptLine | null;
		try {
			entry = JSON.parse(line) as TranscriptLine | null;
		} catch {
			continue;
		}
		if (entry === null || typeof entry !== "object") continue;
		if (entry.role !== "user" && entry.role !== "assistant") continue;
		const parts = Array.isArray(entry.message?.content) ? (entry.message?.content as unknown[]) : [];
		const visible = parts
			.flatMap((part) => {
				const block = part as { type?: unknown; text?: unknown } | null;
				return block?.type === "text" && typeof block.text === "string" ? [flatten(block.text)] : [];
			})
			.filter((text) => text !== "");
		if (visible.length === 0) continue;
		if (title === undefined && entry.role === "user") title = visible.join(" ").slice(0, TITLE_LIMIT);
		texts.push(...visible);
	}
	return { id: transcript.id, title: title ?? "", texts, updatedAtMs: transcript.updatedAtMs };
}

// A conversation matches when every term is in its title or in one of its visible texts.
function matchConversation(conversation: Conversation, terms: string[]): SearchHit | undefined {
	const title = conversation.title.toLowerCase();
	const bodies = conversation.texts.map((text): BodyText => ({ text, lower: text.toLowerCase() }));
	for (const term of terms) {
		if (!title.includes(term) && !bodies.some((body) => body.lower.includes(term))) return undefined;
	}
	const snippet = bodySnippet(bodies, terms);
	return {
		conversationId: conversation.id,
		title: conversation.title,
		source: "local",
		updatedAtMs: conversation.updatedAtMs,
		...(snippet === undefined ? {} : { snippet }),
	};
}

// The window around the earliest term in the first visible text that holds one; a title-only match has no snippet.
function bodySnippet(bodies: BodyText[], terms: string[]): string | undefined {
	for (const body of bodies) {
		const found = terms.map((term) => body.lower.indexOf(term)).filter((index) => index >= 0);
		if (found.length === 0) continue;
		const index = Math.min(...found);
		const start = Math.max(0, index - SNIPPET_BEFORE);
		const end = Math.min(body.text.length, index + SNIPPET_AFTER);
		return `${start > 0 ? "…" : ""}${body.text.slice(start, end)}${end < body.text.length ? "…" : ""}`;
	}
	return undefined;
}

// Cursor's formatConversationSearchResult for a success: the count line, one entry per hit, then the flags.
export function renderSearchResult(success: SearchSuccess): string {
	const count = success.hits.length;
	const lines = count === 0 ? ["No matching conversations found."] : [`Found ${count} conversation${count === 1 ? "" : "s"}:`, ...success.hits.map(formatHit)];
	if (success.truncated) lines.push("Additional matches were omitted because the result limit was reached.");
	if (success.rebuilding) lines.push("The conversation search index is rebuilding; results may be incomplete.");
	if (success.partial) lines.push("Search stopped early; partial results were returned.");
	return lines.join("\n");
}

function formatHit(hit: SearchHit, index: number): string {
	const updated = hit.updatedAtMs === 0 ? "unknown" : new Date(hit.updatedAtMs).toISOString();
	const lines = [`${index + 1}. [${hit.source}] "${hit.title}" (id: ${hit.conversationId}, updated: ${updated})`];
	if (hit.snippet !== undefined && hit.snippet.length > 0) lines.push(`   snippet: ${hit.snippet}`);
	return lines.join("\n");
}
