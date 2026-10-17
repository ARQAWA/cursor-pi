#!/usr/bin/env bun
// Checks the cursor-namespace WebSearch and WebFetch tools. Renders and error texts are compared with Cursor Desktop 3.25.6's
// own tools (through tools/cursor-oracle.mjs) on the same inputs. WebFetch runs end to end against a local HTTP fixture server,
// and WebSearch end to end against tools/lib/fake-provider.mjs for both providers, asserting the request shape and the text.
// Needs the extracted bundle (bun tools/extract-cursor.mjs). Usage: BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/check-web.mjs

import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { fakeCodexKey, startFakeProvider } from "./lib/fake-provider.mjs";
import { capturedConciseInstruction } from "../extensions/cursor-pi/dynamic/captured-instructions.ts";
import { getDynamicTool } from "../extensions/cursor-pi/dynamic/registry.ts";
import { registerCursorNamespace } from "../extensions/cursor-pi/tools/namespace/index.ts";
import { executeWebFetch, renderFetchContent } from "../extensions/cursor-pi/tools/namespace/web-fetch.ts";
import { capAnswer, executeWebSearch, renderWebSearchReferences } from "../extensions/cursor-pi/tools/namespace/web-search.ts";
import { parseAnthropicStream, parseCodexStream } from "../extensions/cursor-pi/tools/namespace/web-search-provider.ts";
import { truncateContent } from "../extensions/cursor-pi/tools/namespace/web-output.ts";

// Run with HOME set to a temp folder (HOME=$(mktemp -d) bun tools/check-web.mjs), so files written under ~/.cursor-pi land there.
const WORKSPACE = mkdtempSync(join(tmpdir(), "web-check-workspace-"));

let checks = 0;
let failures = 0;
function report(name, ok, detail = "") {
	checks += 1;
	if (ok) {
		console.log(`ok ${name}`);
		return;
	}
	failures += 1;
	console.log(`FAIL ${name}`);
	if (detail) console.log(detail);
}
const shown = (text) => JSON.stringify(text.length > 400 ? `${text.slice(0, 400)}...` : text);

const cursor = await loadCursor();
initModule(cursor, "../agent/dist/tools/core/web-search.js");
initModule(cursor, "../agent/dist/tools/core/web-fetch/web-fetch.js");

const TEMPORARY_TEXT = "The web search provider returned an error; this may be temporary. Please try again.";
const GENERIC_SEARCH = "An error occurred while searching the web";
const SEARCH_TITLE = "Web search results";
const URL_A = "https://example.com/a";
const RELEASES = "https://github.com/BurntSushi/ripgrep/releases";
const QUERY = "ripgrep latest release";
const ANSWER = "Ripgrep 15.2.0 is the latest release. [1]";

// Cursor's own tools run with a stub listener (no approval is refused) and a stream of the JSON arguments.
const streamOf = (text) => (async function* () { yield text; })();
function cursorHandler() {
	return {
		emitPartialToolCall: async () => undefined,
		executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx),
		listener: { query: async (_ctx, query) => ({ result: { case: query.query.case.replace("Query", "Response"), value: { result: { case: "approved", value: {} } } } }) },
	};
}
// Cursor's text for a call: its render of the result, or of the error it serialized.
async function cursorText(tool, args) {
	const callCtx = cursor.createContext();
	try {
		const result = await tool.execute(callCtx, cursorHandler(), streamOf(JSON.stringify(args)), { toolCallId: "web-probe" });
		return (await tool.render(callCtx, result, {})).content[0].text;
	} catch (error) {
		return (await tool.render(callCtx, tool.serializeError(error).tool.value.result, {})).content[0].text;
	}
}
const fetchTool = (service) => cursor.createWebFetchTool(service, "latest", {});
const searchTool = (service) => cursor.createWebSearchTool(service, "latest", { conversationStartedDate: "2026-10-17" });

// Renders and error texts against Cursor's tools, on the same service outputs.
const page = "# Title\n\nBody text with a [link](https://example.com).";
const longPage = Array.from({ length: 30000 }, (_, i) => `line ${i}`).join("\n");
const theirsPage = await cursorText(fetchTool(async () => ({ content: page })), { url: URL_A });
report("WebFetch success: text equals Cursor's", theirsPage === renderFetchContent(URL_A, page), `  cursor: ${shown(theirsPage)}`);
const theirsLong = await cursorText(fetchTool(async () => ({ content: longPage })), { url: URL_A });
report("WebFetch long page: truncated text equals Cursor's", theirsLong === renderFetchContent(URL_A, truncateContent(longPage, 100_000)), `  cursor: length ${theirsLong.length}, tail ${shown(theirsLong.slice(-120))}\n  ours:   length ${renderFetchContent(URL_A, truncateContent(longPage, 100_000)).length}`);
const theirsServiceError = await cursorText(fetchTool(async () => ({ error: "upstream refused" })), { url: URL_A });
report("WebFetch service error: Cursor's error-with-url text", theirsServiceError === `Error fetching URL ${URL_A}: upstream refused`, `  cursor: ${shown(theirsServiceError)}`);
// Cursor's serializeError maps a status error to its status text; its execute pipeline turns the same error into the generic text.
const statusTool = fetchTool(async () => ({ content: "" }));
const theirsStatus = (await statusTool.render(cursor.createContext(), statusTool.serializeError(vm.runInContext("new Error('status code: 404')", cursor)).tool.value.result, {})).content[0].text;
report("WebFetch thrown status: Cursor's status text", theirsStatus === "Error: Error fetching URL, status code: 404", `  cursor: ${shown(theirsStatus)}`);
const theirsBadUrl = await cursorText(fetchTool(async () => ({ content: "" })), { url: "not a url" });
report("WebFetch bad URL: Cursor's text", theirsBadUrl === "Error: Invalid URL: must include http:// or https://", `  cursor: ${shown(theirsBadUrl)}`);
const theirsProtocol = await cursorText(fetchTool(async () => ({ content: "" })), { url: "ftp://example.com/a" });
report("WebFetch protocol: Cursor's text", theirsProtocol === "Error: Invalid URL protocol: ftp: (must be http or https)", `  cursor: ${shown(theirsProtocol)}`);

const answer = "Ripgrep 15.2.0 was released on July 15, 2026. [1]";
const theirsAnswer = await cursorText(searchTool(async () => ({ answer, documents: [] })), { search_term: QUERY });
report("WebSearch success: text equals Cursor's", theirsAnswer === renderWebSearchReferences([{ title: SEARCH_TITLE, url: "", chunk: answer }]), `  cursor: ${shown(theirsAnswer)}`);
const longAnswer = "answer line\n".repeat(10000);
const theirsLongAnswer = await cursorText(searchTool(async () => ({ answer: longAnswer, documents: [] })), { search_term: QUERY });
report("WebSearch long answer: truncation text equals Cursor's", theirsLongAnswer === renderWebSearchReferences([{ title: SEARCH_TITLE, url: "", chunk: await capAnswer(longAnswer, undefined) }]), `  cursor tail: ${shown(theirsLongAnswer.slice(-120))}`);
const theirs503 = await cursorText(searchTool(async () => { throw new Error("API request failed: 503 Service Unavailable"); }), { search_term: QUERY });
report("WebSearch 503: Cursor's temporary text", theirs503 === `Error: ${TEMPORARY_TEXT}`, `  cursor: ${shown(theirs503)}`);
const theirs400 = await cursorText(searchTool(async () => { throw new Error("API request failed: 400 Bad Request"); }), { search_term: QUERY });
report("WebSearch 400: Cursor's generic text", theirs400 === `Error: ${GENERIC_SEARCH}`, `  cursor: ${shown(theirs400)}`);

// The namespace entry point registers both tools with Cursor's concise lines.
registerCursorNamespace({ appendEntry() {} });
for (const name of ["WebSearch", "WebFetch"]) {
	const entry = getDynamicTool("cursor", name);
	report(`registry: ${name} is registered with Cursor's concise line`, entry !== undefined && entry.conciseInstructions === capturedConciseInstruction(name));
}

// Provider stream parsing: url citations are read from Codex and Anthropic streams.
const sse = (events) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const CODEX_SSE = sse([
	["response.output_item.done", { type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "Ripgrep 15.2.0 [1].", annotations: [{ type: "url_citation", title: "Releases", url: RELEASES, start_index: 0, end_index: 0 }] }] } }],
	["response.completed", { type: "response.completed", response: { output: [] } }],
]);
const CITATION_SSE = sse([
	["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } }],
	["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Ripgrep 15.2.0." } }],
	["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "citations_delta", citation: { type: "web_search_result_location", url: RELEASES, title: "Releases", cited_text: "15.2.0" } } }],
	["content_block_stop", { type: "content_block_stop", index: 0 }],
	["message_stop", { type: "message_stop" }],
]);
const codexParsed = parseCodexStream(CODEX_SSE);
report("Codex stream: text and url citation", JSON.stringify(codexParsed) === JSON.stringify({ text: "Ripgrep 15.2.0 [1].", sources: [{ title: "Releases", url: RELEASES }] }), `  parsed: ${shown(JSON.stringify(codexParsed))}`);
const anthropicParsed = parseAnthropicStream(CITATION_SSE);
report("Anthropic stream: text and citation", JSON.stringify(anthropicParsed) === JSON.stringify({ text: "Ripgrep 15.2.0.", sources: [{ title: "Releases", url: RELEASES }] }), `  parsed: ${shown(JSON.stringify(anthropicParsed))}`);

// A local HTTP fixture server for WebFetch.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const HTML = '<!doctype html><html><head><title>Fixture Page</title></head><body><nav>Menu links</nav><article><h1>Fixture heading</h1><p>First paragraph with a <a href="https://example.com/x">link</a>.</p><ul><li>item one</li><li>item two</li></ul></article><footer>Site footer</footer></body></html>';
const BIG_TEXT = Array.from({ length: 4000 }, (_, i) => `line ${i}: xxxxxxxxxx`).join("\n");
const TOO_LARGE = "a".repeat(5 * 1024 * 1024 + 1);
const LIMIT = 5 * 1024 * 1024;

function send(res, status, type, body) {
	res.writeHead(status, { "content-type": type });
	res.end(body);
}
function listen(server) {
	return new Promise((resolveListen) => server.listen(0, "127.0.0.1", () => resolveListen(`http://127.0.0.1:${server.address().port}`)));
}
const fixture = createServer((req, res) => {
	const { pathname } = new URL(req.url, "http://fixture");
	switch (pathname) {
		case "/html":
			return send(res, 200, "text/html; charset=utf-8", HTML);
		case "/redirect":
			res.writeHead(302, { location: "/html" });
			return res.end();
		case "/missing":
			return send(res, 404, "text/plain", "not here");
		case "/big-text":
			return send(res, 200, "text/plain; charset=utf-8", BIG_TEXT);
		case "/too-large":
			return send(res, 200, "text/plain; charset=utf-8", TOO_LARGE);
		case "/binary":
			return send(res, 200, "image/png", PNG);
		default:
			return send(res, 500, "text/plain", "unexpected path");
	}
});
const base = await listen(fixture);

const ctxUi = { cwd: WORKSPACE, hasUI: true, ui: { confirm: async () => true } };
const html = await executeWebFetch({ url: `${base}/html` }, undefined, ctxUi);
report("WebFetch html: markdown with the article heading and links", !html.isError && html.text.startsWith(`# Content from ${base}/html\n\n`) && html.text.includes("Fixture heading") && html.text.includes("item one") && html.text.includes("item two") && html.text.includes("[link](https://example.com/x)"), `  text: ${shown(html.text)}`);
console.log(`quoted WebFetch html text: ${shown(html.text)}`);
const bodyOf = (text) => text.slice(text.indexOf("\n\n") + 2);
const redirect = await executeWebFetch({ url: `${base}/redirect` }, undefined, ctxUi);
report("WebFetch redirect: followed to the target content", !redirect.isError && redirect.text.startsWith(`# Content from ${base}/redirect\n\n`) && bodyOf(redirect.text) === bodyOf(html.text), `  text: ${shown(redirect.text)}`);
const missing = await executeWebFetch({ url: `${base}/missing` }, undefined, ctxUi);
report("WebFetch 404: status error text", missing.isError && missing.text === "Error: Error fetching URL, status code: 404", `  text: ${shown(missing.text)}`);
const big = await executeWebFetch({ url: `${base}/big-text` }, undefined, ctxUi);
const written = /written to file: (.+)\n/.exec(big.text)?.[1];
report("WebFetch large page: written to an agent-tools file", !big.isError && written !== undefined && written.startsWith(join(homedir(), ".cursor-pi", "projects")) && readFileSync(written, "utf8") === BIG_TEXT && big.text.startsWith(`# Content from ${base}/big-text\n\nContent written to file: `), `  text: ${shown(big.text)}`);
console.log(`quoted WebFetch large text: ${shown(big.text)}`);
const tooLarge = await executeWebFetch({ url: `${base}/too-large` }, undefined, ctxUi);
report("WebFetch too large: size error text", tooLarge.isError && tooLarge.text === `Error fetching URL ${base}/too-large: Response is larger than ${LIMIT} bytes`, `  text: ${shown(tooLarge.text)}`);
const binary = await executeWebFetch({ url: `${base}/binary` }, undefined, ctxUi);
report("WebFetch binary: unsupported type text", binary.isError && binary.text === `Error fetching URL ${base}/binary: Unsupported content type: image/png`, `  text: ${shown(binary.text)}`);
const refused = await executeWebFetch({ url: "http://127.0.0.1:1/x" }, undefined, ctxUi);
report("WebFetch unreachable host: generic fetch error", refused.isError && refused.text === "Error: An error occurred while fetching the URL", `  text: ${shown(refused.text)}`);
const badUrl = await executeWebFetch({ url: "not a url" }, undefined, ctxUi);
report("WebFetch bad URL: text equals Cursor's", badUrl.isError && badUrl.text === theirsBadUrl, `  text: ${shown(badUrl.text)}`);
const declined = await executeWebFetch({ url: `${base}/html` }, undefined, { cwd: WORKSPACE, hasUI: false });
report("WebFetch without approval: rejected text", declined.isError && declined.text === "Web fetch rejected: User rejected the web fetch", `  text: ${shown(declined.text)}`);
const missingArg = await executeWebFetch({}, undefined, ctxUi);
report("WebFetch missing url: argument error", missingArg.isError && missingArg.text === "Invalid arguments:\nurl: Required", `  text: ${shown(missingArg.text)}`);

// WebSearch end to end against the fake provider, for both providers, asserting the request and the rendered text.
function searchCtx(provider, modelId, baseUrl, apiKey) {
	return {
		cwd: WORKSPACE,
		model: { provider, id: modelId, baseUrl },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey, headers: {}, baseUrl }) },
	};
}
const expectedText = renderWebSearchReferences([{ title: SEARCH_TITLE, url: "", chunk: ANSWER }]);
for (const [provider, modelId] of [["openai-codex", "gpt-5.1-codex"], ["anthropic", "claude-sonnet-4-5"]]) {
	const fake = await startFakeProvider({ provider, turns: [{ text: ANSWER }] });
	const apiKey = provider === "openai-codex" ? fakeCodexKey() : "sk-ant-api03-fixture";
	const result = await executeWebSearch({ search_term: QUERY }, undefined, searchCtx(provider, modelId, fake.baseUrl, apiKey));
	report(`WebSearch ${provider}: rendered text`, !result.isError && result.text === expectedText, `  text: ${shown(result.text)}`);
	if (provider === "openai-codex") console.log(`quoted WebSearch codex text: ${shown(result.text)}`);
	report(`WebSearch ${provider}: one request, no fixture errors`, fake.requests.length === 1 && fake.errors.length === 0, `  errors: ${fake.errors.map(String)}`);
	const request = fake.requests[0];
	if (provider === "openai-codex") {
		report("WebSearch codex: request shape", request.path === "/codex/responses" && request.body.model === modelId && request.body.stream === true && JSON.stringify(request.body.tools) === '[{"type":"web_search"}]' && request.body.input[0].content[0].text === QUERY && request.headers["chatgpt-account-id"] === "capture" && request.headers.originator === "pi", `  body: ${shown(JSON.stringify(request.body))}`);
	} else {
		report("WebSearch anthropic: request shape", request.path === "/v1/messages" && request.body.model === modelId && JSON.stringify(request.body.tools) === '[{"type":"web_search_20250305","name":"web_search"}]' && request.body.messages[0].content === QUERY && request.headers["x-api-key"] === "[REDACTED]" && request.headers["anthropic-version"] === "2023-06-01", `  body: ${shown(JSON.stringify(request.body))}`);
	}
	fake.close();
}

const oauth = await startFakeProvider({ provider: "anthropic", turns: [{ text: ANSWER }] });
const oauthResult = await executeWebSearch({ search_term: QUERY }, undefined, searchCtx("anthropic", "claude-sonnet-4-5", oauth.baseUrl, "sk-ant-oat01-fixture"));
report("WebSearch anthropic OAuth: rendered text", oauthResult.text === expectedText, `  text: ${shown(oauthResult.text)}`);
const oauthRequest = oauth.requests[0];
report("WebSearch anthropic OAuth: beta, client and identity", (oauthRequest.headers["anthropic-beta"] ?? "").includes("oauth-2025-04-20") && (oauthRequest.headers["user-agent"] ?? "").startsWith("claude-cli/") && oauthRequest.headers["x-api-key"] === undefined && oauthRequest.body.system[0].text === "You are Claude Code, Anthropic's official CLI for Claude.", `  headers: ${shown(JSON.stringify(oauthRequest.headers))}`);
oauth.close();

// Provider failures and citations, from stand-in servers that answer with one fixed status and body.
const anthropicKey = "sk-ant-api03-fixture";
const stub503 = createServer((req, res) => { req.resume(); req.on("end", () => send(res, 503, "application/json", '{"error":{"message":"busy"}}')); });
const base503 = await listen(stub503);
const err503 = await executeWebSearch({ search_term: QUERY }, undefined, searchCtx("anthropic", "claude-sonnet-4-5", base503, anthropicKey));
report("WebSearch 503: text equals Cursor's", err503.isError && err503.text === `Error: ${TEMPORARY_TEXT}` && err503.text === theirs503, `  text: ${shown(err503.text)}`);
stub503.close();
const stub400 = createServer((req, res) => { req.resume(); req.on("end", () => send(res, 400, "application/json", '{"error":{"message":"bad"}}')); });
const base400 = await listen(stub400);
const err400 = await executeWebSearch({ search_term: QUERY }, undefined, searchCtx("anthropic", "claude-sonnet-4-5", base400, anthropicKey));
report("WebSearch 400: text equals Cursor's", err400.isError && err400.text === `Error: ${GENERIC_SEARCH}` && err400.text === theirs400, `  text: ${shown(err400.text)}`);
stub400.close();
const stubCite = createServer((req, res) => { req.resume(); req.on("end", () => send(res, 200, "text/event-stream", CITATION_SSE)); });
const baseCite = await listen(stubCite);
const cited = await executeWebSearch({ search_term: QUERY }, undefined, searchCtx("anthropic", "claude-sonnet-4-5", baseCite, anthropicKey));
report("WebSearch citations: sources listed under the answer", cited.text === renderWebSearchReferences([{ title: SEARCH_TITLE, url: "", chunk: `Ripgrep 15.2.0.\n\nSources:\n- Releases (${RELEASES})` }]), `  text: ${shown(cited.text)}`);
stubCite.close();
const noModel = await executeWebSearch({ search_term: QUERY }, undefined, { cwd: WORKSPACE, model: undefined, modelRegistry: {} });
report("WebSearch without a model: generic error", noModel.isError && noModel.text === `Error: ${GENERIC_SEARCH}`, `  text: ${shown(noModel.text)}`);
const noTerm = await executeWebSearch({}, undefined, searchCtx("anthropic", "claude-sonnet-4-5", base, anthropicKey));
report("WebSearch missing search_term: argument error", noTerm.isError && noTerm.text === "Invalid arguments:\nsearch_term: Required", `  text: ${shown(noTerm.text)}`);

fixture.close();
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
