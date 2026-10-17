#!/usr/bin/env bun
// Runs a two-turn scripted session through Cursor Pi, then checks the transcript that Pi writes under HOME against the file
// Cursor's own TranscriptStore (tools/cursor-oracle.mjs) writes for the same messages, fed at the same points: a checkpoint
// after each step and a turn_ended marker after each agent run. The line shapes are compared with Cursor's files as well.
// Usage: bun tools/check-transcripts.mjs    Exits non-zero on any FAIL.

import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runScriptedSession } from "./capture-session.mjs";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { slugifyPath, transcriptsDirFor } from "../extensions/cursor-pi/tools/shell/paths.ts";

const MODEL = "anthropic/claude-opus-5-5";
const PROMPTS = ["List the TypeScript files.", "Which file is the entry point?"];
const GLOB_ARGUMENTS = { glob_pattern: "**/*.ts" };
const TEXTS = ["Found one TypeScript file.", "The entry point is src/app.ts."];
const TURNS = [{ calls: [{ name: "Glob", arguments: GLOB_ARGUMENTS }] }, { text: TEXTS[0] }, { text: TEXTS[1] }];

// The messages Cursor's writer receives, in order. A checkpoint follows each step (turn_end in Pi), and a turn_ended marker
// follows each agent run (agent_end in Pi). The tool result is stored, but Cursor's transcript writes no line for it. The
// user texts are the ones Pi sent, with their <timestamp> and <user_query> wrapper, so the oracle gets what Cursor's state
// would hold for those turns.
function checkpointsFor(firstUserText, secondUserText) {
	return [
		{
			messages: [
				{ role: "user", content: firstUserText },
				{ role: "assistant", content: [{ type: "tool-call", toolCallId: "call_1", toolName: "Glob", args: GLOB_ARGUMENTS }] },
				{ role: "tool", content: [{ type: "tool-result", toolCallId: "call_1", toolName: "Glob", result: "src/app.ts" }] },
			],
		},
		{ messages: [{ role: "assistant", content: [{ type: "text", text: TEXTS[0] }] }] },
		{ turnEnded: { status: "success" } },
		{
			messages: [
				{ role: "user", content: secondUserText },
				{ role: "assistant", content: [{ type: "text", text: TEXTS[1] }] },
			],
		},
		{ turnEnded: { status: "success" } },
	];
}

// The user message Pi sent for a prompt, as the model received it: the text of the first request that carries the prompt.
function userTextSent(requests, prompt) {
	for (const request of requests) {
		for (const message of request.body.messages ?? []) {
			if (message.role !== "user") continue;
			const text = typeof message.content === "string" ? message.content : (message.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("");
			if (text.includes(prompt)) return text;
		}
	}
	return undefined;
}

// The shapes of Cursor's lines: role and content part types, or turn_ended and its status.
const EXPECTED_SHAPES = ["user:text", "assistant:tool_use", "assistant:text", "turn_ended:success", "user:text", "assistant:text", "turn_ended:success"];

let checks = 0;
let failures = 0;

function report(ok, name, detail = "") {
	checks += 1;
	if (ok) {
		console.log(`ok ${name}`);
		return;
	}
	failures += 1;
	console.log(`FAIL ${name}`);
	if (detail) console.log(detail);
}

function shapeOf(line) {
	if (line.type === "turn_ended") return `turn_ended:${line.status}`;
	return `${line.role}:${line.message.content.map((part) => part.type).join("+")}`;
}

// Cursor's TranscriptStore, run in the oracle. Each checkpoint goes through writeFromStateIncremental, as Cursor's Desktop
// writer calls it, and the returned map holds every file the store wrote, by path.
async function cursorFiles(projectDir, conversationId, checkpoints) {
	const cursor = await loadCursor();
	initModule(cursor, "../agent-transcript/dist/index.js");
	const ctx = cursor.createContext();
	const files = new Map();
	const blobs = new Map();
	const state = { rootPromptMessagesJson: [], summaryArchives: [] };
	const store = new cursor.TranscriptStore(
		projectDir,
		{ getBlob: async (_ctx, blobId) => blobs.get(blobId) },
		async (file, content) => {
			files.set(file, content);
		},
		{
			writeText: false,
			writeJsonl: true,
			streamFullJsonlWrites: true,
			appendFile: async (file, content) => {
				files.set(file, (files.get(file) ?? "") + content);
			},
		},
	);
	let count = 0;
	for (const checkpoint of checkpoints) {
		for (const message of checkpoint.messages ?? []) {
			const blobId = `blob-${state.rootPromptMessagesJson.length}`;
			blobs.set(blobId, new TextEncoder().encode(JSON.stringify(message)));
			state.rootPromptMessagesJson.push(blobId);
		}
		const options = checkpoint.turnEnded ? { turnEnded: checkpoint.turnEnded } : {};
		const written = await store.writeFromStateIncremental(ctx, state, conversationId, count, options);
		if (written !== state.rootPromptMessagesJson.length) {
			throw new Error(`Cursor's writer returned ${written}, expected ${state.rootPromptMessagesJson.length}`);
		}
		count = written;
	}
	return files;
}

function textDiff(expected, actual) {
	let i = 0;
	while (i < expected.length && expected[i] === actual[i]) i++;
	const around = (text) => JSON.stringify(text.slice(Math.max(0, i - 60), i + 120));
	return `  first difference at character ${i} (oracle ${expected.length} characters, ours ${actual.length})\n  oracle: ${around(expected)}\n  ours:   ${around(actual)}`;
}

async function main() {
	// The child's HOME is this temp folder, so its ~/.cursor-pi writes stay out of the real home and the check reads them here.
	const home = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-transcripts-home-")));
	const ws = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-transcripts-ws-")));
	try {
		await mkdir(path.join(ws, "src"), { recursive: true });
		await writeFile(path.join(ws, "src", "app.ts"), "export function main() {\n  return 1;\n}\n");
		const run = await runScriptedSession({ model: MODEL, cwd: ws, prompt: PROMPTS, turns: TURNS, homeDir: home });
		report(
			run.code === 0 && run.errors.length === 0,
			"Pi exits 0 for both prompts without extension or provider errors",
			`  exit ${run.code}; errors: ${run.errors.join(" | ")}\n${run.stderr.slice(-1500)}`,
		);
		report(run.requests.length === TURNS.length, `the script answered ${TURNS.length} requests`, `  requests: ${run.requests.length}`);

		const [firstUserText, secondUserText] = PROMPTS.map((prompt) => userTextSent(run.requests, prompt));
		report(
			firstUserText !== undefined && secondUserText !== undefined,
			"the captured requests hold each prompt's user message",
			`  first: ${JSON.stringify(firstUserText)}\n  second: ${JSON.stringify(secondUserText)}`,
		);
		if (firstUserText === undefined || secondUserText === undefined) return;

		const projectDir = path.join(home, ".cursor-pi", "projects", slugifyPath(ws));
		const transcriptsDir = transcriptsDirFor(projectDir);
		const folders = await readdir(transcriptsDir).catch(() => []);
		report(folders.length === 1, "one conversation folder under ~/.cursor-pi/projects/<slug>/agent-transcripts", `  folders: ${folders.join(", ") || "none"}\n${run.stderr.slice(-800)}`);
		if (folders.length !== 1) return;
		const [conversationId] = folders;
		const file = path.join(transcriptsDir, conversationId, `${conversationId}.jsonl`);
		const ours = await readFile(file, "utf8").catch(() => undefined);
		report(ours !== undefined, "the transcript is <id>/<id>.jsonl", `  missing: ${file}`);
		if (ours === undefined) return;

		const shapeList = ours.trimEnd().split("\n").map((text) => shapeOf(JSON.parse(text)));
		report(
			JSON.stringify(shapeList) === JSON.stringify(EXPECTED_SHAPES),
			"line shapes match Cursor's transcript lines",
			`  got:      ${shapeList.join(", ")}\n  expected: ${EXPECTED_SHAPES.join(", ")}`,
		);

		const oracle = await cursorFiles(projectDir, conversationId, checkpointsFor(firstUserText, secondUserText));
		const expected = oracle.get(file);
		report(
			oracle.size === 1 && expected !== undefined,
			"Cursor's writer produces one file at the same path",
			`  oracle paths: ${[...oracle.keys()].join(", ") || "none"}`,
		);
		if (expected !== undefined) {
			report(ours === expected, `transcript bytes equal Cursor's TranscriptStore output (${shapeList.length} lines)`, textDiff(expected, ours));
		}
	} finally {
		await rm(ws, { recursive: true, force: true });
		await rm(home, { recursive: true, force: true });
	}
}

try {
	await main();
} catch (error) {
	failures += 1;
	console.log(`FAIL ${error?.stack ?? error}`);
}
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
