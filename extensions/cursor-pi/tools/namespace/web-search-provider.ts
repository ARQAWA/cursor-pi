import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

// WebSearch through the current model's own provider, reached the way Pi reaches it: the Codex Responses endpoint for
// openai-codex, and the Messages endpoint for anthropic, each with its web search tool. Pi's ai package has no web search,
// so the request is built here, with the auth that Pi's model registry resolves.

export interface SearchSource {
	title: string;
	url: string;
}

export interface ProviderSearchAnswer {
	text: string;
	sources: SearchSource[];
}

// A failed provider request. `status` is the HTTP status when the provider answered at all.
export class ProviderSearchError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "ProviderSearchError";
		this.status = status;
	}
}

// The endpoints and identity headers Pi's providers use (openai-codex-responses.ts, anthropic-messages.ts).
const CODEX_DEFAULT_BASE_URL = "https://chatgpt.com/backend-api";
const CODEX_JWT_CLAIM = "https://api.openai.com/auth";
const CODEX_ORIGINATOR = "pi";
const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 4096;
const CLAUDE_CODE_VERSION = "2.1.280";
const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const SEARCH_INSTRUCTIONS = "Search the web for the user's query. Answer it briefly from the results and name the sources you used.";
const REQUEST_TIMEOUT_MS = 120_000;

type Json = Record<string, any>;

interface ProviderRequest {
	query: string;
	modelId: string;
	apiKey: string;
	headers: Record<string, string>;
	baseUrl: string;
	signal: AbortSignal;
}

// Runs the search on the current model's provider, with the credentials Pi's model registry gives for that model.
export async function searchWithProvider(ctx: ExtensionToolContext, query: string, signal: AbortSignal | undefined): Promise<ProviderSearchAnswer> {
	const model = ctx.model;
	if (model === undefined) throw new ProviderSearchError("no model is selected");
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new ProviderSearchError(auth.error);
	if (auth.apiKey === undefined) throw new ProviderSearchError(`no API key for ${model.provider}`);
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const request: ProviderRequest = {
		query,
		modelId: model.id,
		apiKey: auth.apiKey,
		headers: auth.headers ?? {},
		baseUrl: auth.baseUrl ?? model.baseUrl,
		signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
	};
	switch (model.provider) {
		case "openai-codex":
			return codexSearch(request);
		case "anthropic":
			return anthropicSearch(request);
		default:
			throw new ProviderSearchError(`web search is not available for provider ${model.provider}`);
	}
}

async function codexSearch(request: ProviderRequest): Promise<ProviderSearchAnswer> {
	const base = request.baseUrl.trim() === "" ? CODEX_DEFAULT_BASE_URL : request.baseUrl.trim().replace(/\/+$/, "");
	const url = base.endsWith("/codex/responses") ? base : `${base}/codex/responses`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			...request.headers,
			originator: CODEX_ORIGINATOR,
			authorization: `Bearer ${request.apiKey}`,
			"chatgpt-account-id": codexAccountId(request.apiKey),
			"OpenAI-Beta": "responses=experimental",
			accept: "text/event-stream",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: request.modelId,
			store: false,
			stream: true,
			instructions: SEARCH_INSTRUCTIONS,
			input: [{ role: "user", content: [{ type: "input_text", text: request.query }] }],
			tools: [{ type: "web_search" }],
			tool_choice: "auto",
			parallel_tool_calls: false,
		}),
		signal: request.signal,
	});
	if (!response.ok) throw new ProviderSearchError(`the provider answered with status ${response.status}`, response.status);
	return parseCodexStream(await response.text());
}

async function anthropicSearch(request: ProviderRequest): Promise<ProviderSearchAnswer> {
	const base = request.baseUrl.trim() === "" ? ANTHROPIC_DEFAULT_BASE_URL : request.baseUrl.trim().replace(/\/+$/, "");
	// OAuth tokens carry the Claude Code identity, beta flags and client headers that Pi sends with them.
	const oauth = request.apiKey.includes("sk-ant-oat");
	const auth = oauth
		? {
				authorization: `Bearer ${request.apiKey}`,
				"anthropic-beta": "claude-code-20250219,oauth-2025-04-20",
				"user-agent": `claude-cli/${CLAUDE_CODE_VERSION}`,
				"x-app": "cli",
			}
		: { "x-api-key": request.apiKey };
	const response = await fetch(`${base}/v1/messages`, {
		method: "POST",
		headers: {
			...request.headers,
			...auth,
			"anthropic-version": ANTHROPIC_VERSION,
			accept: "text/event-stream",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: request.modelId,
			max_tokens: ANTHROPIC_MAX_TOKENS,
			stream: true,
			system: oauth ? [{ type: "text", text: CLAUDE_CODE_IDENTITY }, { type: "text", text: SEARCH_INSTRUCTIONS }] : SEARCH_INSTRUCTIONS,
			messages: [{ role: "user", content: request.query }],
			tools: [{ type: "web_search_20250305", name: "web_search" }],
		}),
		signal: request.signal,
	});
	if (!response.ok) throw new ProviderSearchError(`the provider answered with status ${response.status}`, response.status);
	return parseAnthropicStream(await response.text());
}

// The account id Pi reads from the Codex token's JWT payload.
function codexAccountId(token: string): string {
	const payload = token.split(".")[1];
	const claims: Json | undefined = payload === undefined ? undefined : JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
	const accountId = claims?.[CODEX_JWT_CLAIM]?.chatgpt_account_id;
	if (typeof accountId !== "string" || accountId === "") throw new ProviderSearchError("no account id in the Codex token");
	return accountId;
}

// The data payloads of a server-sent events body, in order.
function sseEvents(body: string): Json[] {
	const events: Json[] = [];
	for (const block of body.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (data !== "" && data !== "[DONE]") events.push(JSON.parse(data) as Json);
	}
	return events;
}

// Sources by URL, first title kept. Only the sources the answer cites are added, as the provider marks them.
class SourceList {
	readonly list: SearchSource[] = [];
	private readonly seen = new Set<string>();

	add(title: unknown, url: unknown): void {
		if (typeof url !== "string" || url === "" || this.seen.has(url)) return;
		this.seen.add(url);
		this.list.push({ title: typeof title === "string" ? title : "", url });
	}
}

// The answer text and its url citations from a Codex Responses stream.
export function parseCodexStream(body: string): ProviderSearchAnswer {
	const texts: string[] = [];
	const sources = new SourceList();
	for (const event of sseEvents(body)) {
		if (event.type === "error" || event.type === "response.failed") {
			throw new ProviderSearchError(event.message ?? event.response?.error?.message ?? "the provider reported an error");
		}
		if (event.type !== "response.output_item.done" || event.item?.type !== "message") continue;
		for (const part of event.item.content ?? []) {
			if (part.type !== "output_text") continue;
			texts.push(part.text ?? "");
			for (const annotation of part.annotations ?? []) {
				if (annotation.type === "url_citation") sources.add(annotation.title, annotation.url);
			}
		}
	}
	return { text: texts.join(""), sources: sources.list };
}

// The text blocks of a Messages stream, joined in order, with the web search citations on them.
export function parseAnthropicStream(body: string): ProviderSearchAnswer {
	const blocks = new Map<number, string>();
	const sources = new SourceList();
	for (const event of sseEvents(body)) {
		switch (event.type) {
			case "content_block_start":
				if (event.content_block?.type === "text") {
					blocks.set(event.index, event.content_block.text ?? "");
					for (const citation of event.content_block.citations ?? []) addCitation(sources, citation);
				}
				break;
			case "content_block_delta":
				if (event.delta?.type === "text_delta") blocks.set(event.index, (blocks.get(event.index) ?? "") + event.delta.text);
				if (event.delta?.type === "citations_delta") addCitation(sources, event.delta.citation);
				break;
			case "error":
				throw new ProviderSearchError(event.error?.message ?? "the provider reported an error");
		}
	}
	const text = [...blocks.entries()]
		.sort(([a], [b]) => a - b)
		.map(([, block]) => block)
		.join("");
	return { text, sources: sources.list };
}

function addCitation(sources: SourceList, citation: Json | undefined): void {
	if (citation?.type === "web_search_result_location") sources.add(citation.title, citation.url);
}
