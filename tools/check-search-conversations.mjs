#!/usr/bin/env bun
// Checks SearchConversations against Cursor Desktop 3.25.6's own code. The declaration is compared with Cursor's module source;
// renders and argument or executor errors run through Cursor's tool on the same data; the local search runs on fixture
// transcripts in a temporary HOME and must give the text Cursor's formatter writes. Bun reads HOME once per process, so the
// end-to-end cases run in child processes that start with their own HOME. Needs the extracted bundle
// (bun tools/extract-cursor.mjs). Exits non-zero on any FAIL.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { capturedNamespaceDeclaration } from "../extensions/cursor-pi/tools/namespace/captured.ts";
import { executeSearchConversations, register, renderSearchResult } from "../extensions/cursor-pi/tools/namespace/search-conversations.ts";
import { getDynamicTool } from "../extensions/cursor-pi/dynamic/registry.ts";

const END_TO_END_FLAG = "--end-to-end";
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const WALLET_HIT = `Found 1 conversation:\n1. [local] "How does wallet_sync store checkpoints?" (id: conv-wallet, updated: ${iso(1780000000)})\n   snippet: How does wallet_sync store checkpoints?`;
const FIXTURE_CASES = [
	{ name: "match on a keyword", args: { query: "wallet_sync" }, text: WALLET_HIT, isError: false },
	{ name: "match on a quoted phrase", args: { query: '"wallet_sync store"' }, text: WALLET_HIT, isError: false },
	{ name: "no match", args: { query: "kubernetes" }, text: "No matching conversations found.", isError: false },
	{ name: "every keyword must match the same conversation", args: { query: "wallet delete" }, text: "No matching conversations found.", isError: false },
	{ name: "quoted phrase in the wrong order", args: { query: '"store wallet_sync"' }, text: "No matching conversations found.", isError: false },
	{ name: "default limit returns all three", args: { query: "agent" }, text: `Found 3 conversations:\n1. [local] "agent third" (id: conv-a3, updated: ${iso(1780000202)})\n   snippet: agent third\n2. [local] "agent second" (id: conv-a2, updated: ${iso(1780000201)})\n   snippet: agent second\n3. [local] "agent first" (id: conv-a1, updated: ${iso(1780000200)})\n   snippet: agent first`, isError: false },
	{ name: "limit keeps the newest and reports omission", args: { query: "agent", limit: 2 }, text: `Found 2 conversations:\n1. [local] "agent third" (id: conv-a3, updated: ${iso(1780000202)})\n   snippet: agent third\n2. [local] "agent second" (id: conv-a2, updated: ${iso(1780000201)})\n   snippet: agent second\nAdditional matches were omitted because the result limit was reached.`, isError: false },
	{ name: "empty query after trimming", args: { query: "   " }, text: "Query must not be empty", isError: true },
	{ name: "empty query", args: { query: "" }, text: "Invalid arguments:\nquery: String must contain at least 1 character(s)", isError: true },
	{ name: "limit below one", args: { query: "x", limit: 0 }, text: "Invalid arguments:\nlimit: Number must be greater than or equal to 1", isError: true },
	{ name: "missing query", args: {}, text: "Invalid arguments:\nquery: Required", isError: true },
];
const EMPTY_HOME_CASES = [{ name: "no transcripts at all", args: { query: "wallet_sync" }, text: "No matching conversations found.", isError: false }];

// Child mode: run the cases against the HOME the parent gave this process, and print one JSON line per case.
if (process.argv[2] === END_TO_END_FLAG) {
	const { executeSearchConversations: run } = await import("../extensions/cursor-pi/tools/namespace/search-conversations.ts");
	for (const testCase of process.argv[3] === "empty" ? EMPTY_HOME_CASES : FIXTURE_CASES) {
		const mine = await run(testCase.args, undefined, {});
		const ok = mine.text === testCase.text && mine.isError === testCase.isError;
		console.log(JSON.stringify({ name: testCase.name, ok, detail: ok ? "" : `  ours:   ${JSON.stringify(mine.text)}\n  want:   ${JSON.stringify(testCase.text)}` }));
	}
	process.exit(0);
}

const MODULE_PATH = "modules/__/agent/dist/tools/core/search-conversations/search-conversations.js";
const cursor = await loadCursor();
initModule(cursor, "../agent/dist/tools/core/search-conversations/search-conversations.js");
for (const name of ["createSearchConversationsTool", "ConversationSearchHit", "ConversationSearchSuccess", "ConversationSearchSource"]) {
	if (cursor[name] === undefined) throw new Error(`${name} is not in the Cursor bundle`);
}

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

// Declaration: the captured tool is the one Cursor's module declares, with the same description and parameter texts.
const declared = capturedNamespaceDeclaration("SearchConversations");
const moduleText = readFileSync(path.join(os.tmpdir(), "cursor-3.25.6-f0df777c", MODULE_PATH), "utf8");
report("declaration: name and required query", declared.name === "SearchConversations" && JSON.stringify(declared.parameters.required) === JSON.stringify(["query"]));
report("declaration: description is Cursor's", moduleText.includes(declared.description));
report("declaration: query description is Cursor's", moduleText.includes(declared.parameters.properties.query.description));
report("declaration: limit description is Cursor's", moduleText.includes(declared.parameters.properties.limit.description));
register();
report("registry: SearchConversations is registered in the cursor namespace", getDynamicTool("cursor", "SearchConversations") !== undefined);

// Renderer: Cursor's formatter on the same hits, flags and counts.
async function cursorRender(success) {
	const tool = cursor.createSearchConversationsTool({ get: () => ({}) });
	const rendered = await tool.render(cursor.createContext(), { result: { case: "success", value: success } }, {});
	return rendered.content[0].text;
}
const RENDER_CASES = [
	{
		name: "two hits, one title-only with no date",
		hits: [
			{ conversationId: "c1", title: "Trading bot module overview", source: "local", updatedAtMs: Date.UTC(2026, 9, 10, 18, 28, 5, 678), snippet: "… PostgreSQL `wallet_sync_state`; журнал запусков …" },
			{ conversationId: "c2", title: "Untitled", source: "local", updatedAtMs: 0 },
		],
		flags: { truncated: false, partial: false, rebuilding: false },
	},
	{ name: "no hits", hits: [], flags: { truncated: false, partial: false, rebuilding: false } },
	{
		name: "one hit with every flag set",
		hits: [{ conversationId: "c3", title: "agent third", source: "local", updatedAtMs: 1780000202000, snippet: "agent third" }],
		flags: { truncated: true, partial: true, rebuilding: true },
	},
];
for (const testCase of RENDER_CASES) {
	const cursorSuccess = new cursor.ConversationSearchSuccess({
		hits: testCase.hits.map((hit) => new cursor.ConversationSearchHit({
			conversationId: hit.conversationId,
			title: hit.title,
			source: cursor.ConversationSearchSource.LOCAL,
			updatedAtMs: BigInt(hit.updatedAtMs),
			...(hit.snippet === undefined ? {} : { snippet: hit.snippet }),
		})),
		...testCase.flags,
	});
	const theirs = await cursorRender(cursorSuccess);
	const mine = renderSearchResult({ hits: testCase.hits, ...testCase.flags });
	report(`render ${testCase.name}: text equals Cursor's`, mine === theirs, `  ours:   ${JSON.stringify(mine)}\n  cursor: ${JSON.stringify(theirs)}`);
}

// Errors: Cursor's tool run on the same arguments; its thrown error's model-visible text must be ours.
const streamOf = (text) => (async function* () { yield text; })();
async function cursorSearch(args, executorResult) {
	const tool = cursor.createSearchConversationsTool({ get: () => ({ execute: async () => executorResult }) });
	const interactionHandler = {
		emitPartialToolCall: async () => undefined,
		executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx),
	};
	const callCtx = cursor.createContext();
	try {
		const result = await tool.execute(callCtx, interactionHandler, streamOf(JSON.stringify(args)), { toolCallId: "search-probe" });
		return { text: (await tool.render(callCtx, result, {})).content[0].text, isError: false };
	} catch (error) {
		return { text: error.modelVisibleErrorMessage ?? error.message, isError: true };
	}
}
const EXECUTOR_EMPTY = { result: { case: "success", value: new cursor.ConversationSearchSuccess({ hits: [], truncated: false, partial: false, rebuilding: false }) } };
const ARG_CASES = [{}, { query: "" }, { query: 5 }, { query: "x", limit: 0 }, { query: "x", limit: 101 }, { query: "x", limit: 1.5 }, { query: "x", limit: "5" }, { query: "x", limit: null }, []];
for (const args of ARG_CASES) {
	const theirs = await cursorSearch(args, EXECUTOR_EMPTY);
	const mine = await executeSearchConversations(args, undefined, {});
	report(`arguments ${JSON.stringify(args)}: text equals Cursor's`, theirs.isError && mine.isError && mine.text === theirs.text, `  ours:   ${JSON.stringify(mine.text)}\n  cursor: ${JSON.stringify(theirs.text)}`);
}
{
	const executorError = { result: { case: "error", value: { error: "Query must not be empty" } } };
	const theirs = await cursorSearch({ query: "   " }, executorError);
	const mine = await executeSearchConversations({ query: "   " }, undefined, {});
	report("executor error: whitespace query text equals Cursor's", theirs.isError && mine.isError && mine.text === theirs.text, `  ours:   ${JSON.stringify(mine.text)}\n  cursor: ${JSON.stringify(theirs.text)}`);
}

// End to end: fixture transcripts in a temporary HOME, searched by the tool in a child process that has that HOME.
function writeTranscript(home, project, id, seconds, messages) {
	const dir = path.join(home, ".cursor-pi", "projects", project, "agent-transcripts", id);
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${id}.jsonl`);
	const lines = messages.map(([role, text]) => JSON.stringify({ role, message: { content: [{ type: "text", text }] } }));
	writeFileSync(file, `${[...lines, JSON.stringify({ type: "turn_ended", status: "success" })].join("\n")}\n`);
	utimesSync(file, seconds, seconds);
}
function runChild(home, mode) {
	const result = spawnSync(process.execPath, [import.meta.path, END_TO_END_FLAG, mode], { env: { ...process.env, HOME: home }, encoding: "utf8" });
	if (result.status !== 0) {
		report(`end to end ${mode}: child process ran`, false, result.stderr || result.stdout);
		return;
	}
	for (const line of result.stdout.split("\n").filter((text) => text.startsWith("{"))) {
		const entry = JSON.parse(line);
		report(`end to end ${entry.name}`, entry.ok, entry.detail);
	}
}
const fixtureHome = mkdtempSync(path.join(os.tmpdir(), "search-conversations-"));
writeTranscript(fixtureHome, "alpha-proj", "conv-wallet", 1780000000, [["user", "How does wallet_sync store checkpoints?"], ["assistant", "wallet_sync keeps its state in the wallet_sync_state table."]]);
writeTranscript(fixtureHome, "beta-proj", "conv-delete", 1780000100, [["user", "Fix the Delete tool"], ["assistant", "The Delete tool now asks once for approval."]]);
writeTranscript(fixtureHome, "beta-proj", "conv-a1", 1780000200, [["user", "agent first"]]);
writeTranscript(fixtureHome, "beta-proj", "conv-a2", 1780000201, [["user", "agent second"]]);
writeTranscript(fixtureHome, "beta-proj", "conv-a3", 1780000202, [["user", "agent third"]]);
runChild(fixtureHome, "fixtures");
runChild(mkdtempSync(path.join(os.tmpdir(), "search-conversations-empty-")), "empty");

console.log(`${checks - failures} of ${checks} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
