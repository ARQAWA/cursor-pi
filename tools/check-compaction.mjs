#!/usr/bin/env bun
// Checks compaction against the captured Codex and Claude Code compaction requests. Each scenario is a session run through
// Pi's RPC mode, because print mode sends "/compact" to the model as text: prompts, a compact command, then one more prompt.
// The fake provider answers from a script of turns and records every request. Exits non-zero on any FAIL.
// Usage: bun tools/check-compaction.mjs

import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fakeCodexKey, startFakeProvider } from "./lib/fake-provider.mjs";
import { compactionLimit } from "../extensions/cursor-pi/compaction/entries.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CURSOR_PI = path.join(ROOT, "bin", "cursor-pi");
const CAPTURED = path.join(ROOT, "research", "cursor", "reverse");
const CODEX_DIR = path.join(CAPTURED, "codex-prompts", "compaction", "live", "remote-compaction_gpt-5.6-sol");
const CLAUDE_DIR = path.join(CAPTURED, "claude-code-prompts", "compaction", "tui");
const ARM_SHORT = path.join(CAPTURED, "claude-code-prompts", "compaction", "prompts", "arm-short.txt");
const RUN_TIMEOUT_MS = 180_000;
const CODEX_ENCRYPTED = "gAAAA-fake-compaction";

let passed = 0;
const failed = [];

function report(name, ok, detail = "") {
	if (ok) {
		passed += 1;
		console.log(`ok ${name}`);
		return;
	}
	failed.push(name);
	console.log(`FAIL ${name}${detail === "" ? "" : `\n${detail}`}`);
}

function same(name, actual, expected) {
	report(name, JSON.stringify(actual) === JSON.stringify(expected), `  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
}

function note(text) {
	console.log(`note ${text}`);
}

async function readJson(file) {
	return JSON.parse(await readFile(file, "utf8"));
}

// The text of a Responses input item or an Anthropic message, whichever shape it has.
function textOf(item) {
	const content = item?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => part.text ?? "").join("");
}

function startRpc({ model, cwd, agentDir, homeDir }) {
	const args = ["--mode", "rpc", "--no-session", "--model", model];
	if (model.startsWith("anthropic/")) args.push("--api-key", "sk-ant-api03-capture");
	const child = spawn(CURSOR_PI, args, {
		cwd,
		env: { ...process.env, HOME: homeDir, PI_CODING_AGENT_DIR: agentDir },
		stdio: ["pipe", "pipe", "pipe"],
	});
	child.stdin.on("error", () => {});
	const received = [];
	let cursor = 0;
	let buffered = "";
	let stderr = "";
	let exited = false;
	let wake = () => {};
	child.stdout.on("data", (chunk) => {
		buffered += chunk;
		let at = buffered.indexOf("\n");
		while (at >= 0) {
			const line = buffered.slice(0, at);
			buffered = buffered.slice(at + 1);
			if (line.trim() !== "") {
				try {
					received.push(JSON.parse(line));
				} catch {
					stderr += `unparsed stdout line: ${line}\n`;
				}
			}
			at = buffered.indexOf("\n");
		}
		wake();
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const closed = new Promise((resolve) =>
		child.on("close", () => {
			exited = true;
			wake();
			resolve();
		}),
	);

	// Resolves with the first message after the last one read that the predicate accepts.
	function next(predicate, label) {
		return new Promise((resolve, reject) => {
			const deadline = setTimeout(() => {
				wake = () => {};
				reject(new Error(`timed out waiting for ${label}; stderr: ${stderr.slice(-800)}`));
			}, RUN_TIMEOUT_MS);
			const check = () => {
				while (cursor < received.length) {
					const message = received[cursor++];
					if (predicate(message)) {
						clearTimeout(deadline);
						wake = () => {};
						resolve(message);
						return;
					}
				}
				if (exited) {
					clearTimeout(deadline);
					wake = () => {};
					reject(new Error(`Pi exited before ${label}; stderr: ${stderr.slice(-800)}`));
					return;
				}
				wake = check;
			};
			check();
		});
	}

	const send = (command) => child.stdin.write(`${JSON.stringify(command)}\n`);
	let sequence = 0;
	return {
		async prompt(message) {
			const id = `prompt-${++sequence}`;
			send({ id, type: "prompt", message });
			const response = await next((m) => m.type === "response" && m.id === id, id);
			if (!response.success) throw new Error(`prompt rejected: ${response.error}`);
			await next((m) => m.type === "agent_settled", "agent_settled");
		},
		async compact() {
			const id = `compact-${++sequence}`;
			send({ id, type: "compact" });
			const response = await next((m) => m.type === "response" && m.id === id, id);
			if (!response.success) throw new Error(`compact failed: ${response.error}`);
		},
		async close() {
			if (!exited) child.stdin.end();
			const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
			await closed;
			clearTimeout(timer);
		},
		stderr: () => stderr,
		messages: () => received.slice(),
	};
}

// One session: the steps run in order through RPC, against a fake provider that answers from the turns.
async function runSession(model, steps, turns) {
	const provider = model.slice(0, model.indexOf("/"));
	const fake = await startFakeProvider({ provider, turns });
	const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "cc-compaction-cwd-")));
	const homeDir = await mkdtemp(path.join(os.tmpdir(), "cc-compaction-home-"));
	const agentDir = await mkdtemp(path.join(os.tmpdir(), "cc-compaction-agent-"));
	let error;
	let stderr = "";
	let rpc;
	try {
		// Same settings as tools/capture-session.mjs: Pi's own compaction is off, and Codex posts over HTTP.
		const settings = { compaction: { enabled: false, keepRecentTokens: 1 }, retry: { enabled: false }, transport: "sse" };
		const models = {
			providers: {
				"openai-codex": { baseUrl: fake.baseUrl, apiKey: fakeCodexKey() },
				anthropic: { baseUrl: fake.baseUrl },
			},
		};
		await writeFile(path.join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
		await writeFile(path.join(agentDir, "models.json"), `${JSON.stringify(models, null, 2)}\n`);
		rpc = startRpc({ model, cwd, agentDir, homeDir });
		try {
			for (const step of steps) {
				if (step.compact) await rpc.compact();
				else await rpc.prompt(step.prompt);
			}
		} catch (caught) {
			error = caught.message;
		} finally {
			await rpc.close();
			stderr = rpc.stderr();
		}
	} finally {
		fake.close();
		await rm(cwd, { recursive: true, force: true });
		await rm(homeDir, { recursive: true, force: true });
		await rm(agentDir, { recursive: true, force: true });
	}
	return { requests: fake.requests, errors: fake.errors.map((e) => e.message), error, stderr, events: rpc?.messages() ?? [] };
}

async function runCodex() {
	const model = "openai-codex/gpt-5.6-sol";
	const session = await runSession(
		model,
		[
			{ prompt: "Pick any one fruit at random and reply with only its name, one word. Do not use tools." },
			{ prompt: "What is 17 plus 25? Reply with only the number. Do not use tools." },
			{ compact: true },
			{ prompt: "Which fruit did you pick earlier? Reply with only its name, one word. Do not use tools." },
		],
		[{ text: "Mango" }, { text: "42" }, { compaction: { encrypted_content: CODEX_ENCRYPTED } }, { text: "Mango" }],
	);
	report(`${model}: session runs without error`, session.error === undefined && session.errors.length === 0, `  error: ${session.error}; provider errors: ${session.errors.join(" | ")}\n${session.stderr.slice(-800)}`);
	report(`${model}: four requests, so Pi's summarizer never runs`, session.requests.length === 4, `  requests: ${session.requests.length}`);

	const compacting = session.requests[2]?.body ?? {};
	const after = session.requests[3]?.body ?? {};
	const capturedCompacting = await readJson(path.join(CODEX_DIR, "07-compaction.json"));
	const capturedAfter = await readJson(path.join(CODEX_DIR, "08-post-compaction-turn-1.json"));
	const capturedRequest = capturedCompacting.request_body;
	const capturedPost = capturedAfter.request_body;

	report(`${model}: compaction request sends the Codex beta header`, session.requests[2]?.headers["x-codex-beta-features"] === "remote_compaction_v2");
	same(`${model}: compaction request ends with the compaction trigger`, compacting.input?.at(-1), { type: "compaction_trigger" });
	// Everything before the trigger is the session's messages: Cursor's context message, then the user and assistant turns.
	const beforeTrigger = (compacting.input ?? []).slice(0, -1);
	report(`${model}: the context message comes first in the compaction request`, textOf(beforeTrigger[0]).startsWith("<user_info>"));
	same(`${model}: compaction request keeps the session's turns in order`, beforeTrigger.slice(1).map((item) => item.role), ["user", "assistant", "user", "assistant"]);
	// The captured user items are the turns; the environment context is Codex's own message, which Cursor Pi's context stands for.
	const capturedTail = (capturedRequest.input ?? []).filter(
		(item) => item.type === "compaction_trigger" || item.role === "assistant" || (item.role === "user" && !textOf(item).startsWith("<environment_context>")),
	);
	same(`${model}: compaction request's shape matches the capture`, capturedTail.map((item) => item.role ?? item.type), ["user", "assistant", "user", "assistant", "compaction_trigger"]);
	note(`${model}: compaction request top-level keys: ours ${Object.keys(compacting).sort().join(",")}; captured ${Object.keys(capturedRequest).sort().join(",")}`);

	const afterInput = (after.input ?? []).filter((item) => item.role !== undefined || item.type === "compaction");
	const afterTail = afterInput.slice(1);
	same(`${model}: after compaction the retained user messages, the compaction item, then the new turn`, afterTail.map((item) => (item.type === "compaction" ? "compaction" : item.role)), ["user", "user", "compaction", "user"]);
	report(`${model}: the compaction item is fed back as the server returned it`, JSON.stringify(after.input?.find((item) => item.type === "compaction")) === JSON.stringify({ type: "compaction", id: "cmp_turn2", encrypted_content: CODEX_ENCRYPTED }));
	report(`${model}: assistant turns are dropped after compaction`, !(after.input ?? []).some((item) => item.role === "assistant"));
	report(`${model}: no Codex beta header on the next request`, session.requests[3]?.headers["x-codex-beta-features"] === undefined);
	const capturedTailAfter = (capturedPost.input ?? []).filter(
		(item) => item.type === "compaction" || (item.role === "user" && !textOf(item).startsWith("<environment_context>")),
	);
	same(`${model}: the captured post-compaction shape has the same user, compaction, user order`, capturedTailAfter.map((item) => (item.type === "compaction" ? "compaction" : item.role)), ["user", "user", "compaction", "user"]);
	note(`${model}: request keys: ours ${Object.keys(after).sort().join(",")}; captured ${Object.keys(capturedPost).sort().join(",")}`);
}

async function runClaude() {
	const model = "anthropic/claude-opus-5-5";
	const questions = [
		"say ok",
		"What is 17 plus 25? Answer with the number only.",
		"Name one primary color of light. One word.",
		"What was the very first thing I asked you in this session, and what were your answers? Be brief.",
	];
	const capturedSummary = await readFile(path.join(CLAUDE_DIR, "compact-request", "response.text.txt"), "utf8");
	const session = await runSession(
		model,
		[{ prompt: questions[0] }, { prompt: questions[1] }, { prompt: questions[2] }, { compact: true }, { prompt: questions[3] }],
		[
			{ text: "ok" },
			{ text: "42" },
			{ text: "Red" },
			{ text: capturedSummary },
			{ text: "You first asked me to say ok." },
		],
	);
	report(`${model}: session runs without error`, session.error === undefined && session.errors.length === 0, `  error: ${session.error}; provider errors: ${session.errors.join(" | ")}\n${session.stderr.slice(-800)}`);
	report(`${model}: five requests, so Pi's summarizer never runs`, session.requests.length === 5, `  requests: ${session.requests.length}`);

	const compacting = session.requests[3] ?? { headers: {}, body: {} };
	const after = session.requests[4] ?? { headers: {}, body: {} };
	const messages = compacting.body.messages ?? [];
	report(`${model}: compaction request carries Claude Code's compaction headers`,
		compacting.headers["x-claude-code-request-class"] === "compaction" &&
			compacting.headers["x-claude-code-compaction"] === "manual" &&
			compacting.headers["x-cc-compaction-request"] === "manual");
	const instruction = await readFile(ARM_SHORT, "utf8");
	// Pi's provider adds effort markers with role system; the turns are the other messages.
	const turns = messages.filter((message) => message.role !== "system");
	const lastParts = turns.at(-1)?.content ?? [];
	report(`${model}: the last user message ends with Claude Code's short instruction, byte for byte`, lastParts.at(-1)?.text === instruction, `  ends: ${JSON.stringify(String(lastParts.at(-1)?.text).slice(-120))}`);
	report(`${model}: the user's text before the instruction ends with a newline`, String(lastParts.at(-2)?.text).endsWith("</user_query>\n") && String(lastParts.at(-2)?.text).includes(questions[2]));
	report(`${model}: the last round is left out of the summarized messages`, !messages.some((m) => m.role === "assistant" && textOf(m) === "Red"));
	const marks = [];
	messages.forEach((message, index) => {
		if (message.cache_control !== undefined) marks.push(["message", index]);
		if (Array.isArray(message.content)) message.content.forEach((block, at) => block.cache_control !== undefined && marks.push([index, at]));
	});
	const lastAssistant = messages.findLastIndex((m) => m.role === "assistant");
	const expectedMarks = lastAssistant < 0 ? [] : [[lastAssistant, messages[lastAssistant].content.length - 1]];
	same(`${model}: one cache marker, on the last block of the last assistant message`, marks, expectedMarks);
	report(`${model}: compaction request has no context-compacted header`, compacting.headers["x-claude-code-context-compacted"] === undefined);

	const post = (after.body.messages ?? []).filter((message) => message.role !== "system");
	const index = post.findIndex((m) => textOf(m).includes("This session is being continued"));
	report(`${model}: the next request carries the continuation message`, index >= 0);
	const ours = index < 0 ? "" : textOf(post[index]).slice(textOf(post[index]).indexOf("This session is being continued"));
	const capturedText = await readFile(path.join(CLAUDE_DIR, "post-compact-request", "messages", "00-user.txt"), "utf8");
	const transcriptPath = (text) => text.match(/read the full transcript at: (.*)\n/)?.[1] ?? "";
	report(`${model}: the continuation text is Claude Code's, except the transcript path`,
		ours.replace(transcriptPath(ours), "<PATH>") === capturedText.replace(transcriptPath(capturedText), "<PATH>"),
		`  ours:     ${JSON.stringify(ours.slice(0, 300))}\n  captured: ${JSON.stringify(capturedText.slice(0, 300))}`);
	report(`${model}: the transcript path is the session's transcript file`, transcriptPath(ours).endsWith(".jsonl"), `  path: ${transcriptPath(ours)}`);
	report(`${model}: the summary is the trimmed text of the reply's summary block`, ours.includes(`Summary:\n${capturedSummary.match(/<summary>([\s\S]*?)<\/summary>/)[1].trim()}\n`));
	same(`${model}: the kept round follows the continuation`, textOf(post[index + 1]), "Red");
	report(`${model}: the new turn comes last`, textOf(post.at(-1)).includes(questions[3]));
	report(`${model}: the first request after compaction has Claude Code's context-compacted headers`,
		after.headers["x-claude-code-context-compacted"] === "manual" && after.headers["x-cc-context-compacted"] === "manual");
	report(`${model}: earlier requests have no context-compacted header`, session.requests.slice(0, 3).every((r) => r.headers["x-claude-code-context-compacted"] === undefined));
	note(`${model}: compaction request top-level keys: ours ${Object.keys(compacting.body).sort().join(",")}`);
}

// Automatic compaction: a turn reports input tokens over the threshold, so the next run compacts before it starts.
async function runAutomatic() {
	const codexModel = "openai-codex/gpt-5.6-sol";
	const codex = await runSession(
		codexModel,
		[
			{ prompt: "Pick any one fruit at random and reply with only its name, one word. Do not use tools." },
			{ prompt: "Which fruit did you pick earlier? Reply with only its name, one word. Do not use tools." },
		],
		[{ text: "Mango", usage: { input_tokens: 250000 } }, { compaction: { encrypted_content: CODEX_ENCRYPTED } }, { text: "Mango" }],
	);
	report(`${codexModel}: over the limit, the next run compacts first`, codex.error === undefined && codex.requests.length === 3, `  error: ${codex.error}; requests: ${codex.requests.length}`);
	report(`${codexModel}: the automatic compaction request is Codex's remote compaction`, codex.requests[1]?.headers["x-codex-beta-features"] === "remote_compaction_v2" && codex.requests[1]?.body.input?.at(-1)?.type === "compaction_trigger");
	report(`${codexModel}: the run after compaction carries the compaction item`, (codex.requests[2]?.body.input ?? []).some((item) => item.type === "compaction" && item.encrypted_content === CODEX_ENCRYPTED));

	const claudeModel = "anthropic/claude-opus-5-5";
	const capturedSummary = await readFile(path.join(CLAUDE_DIR, "compact-request", "response.text.txt"), "utf8");
	const claude = await runSession(
		claudeModel,
		[{ prompt: "say ok" }, { prompt: "Name one primary color of light. One word." }],
		[{ text: "ok", usage: { input_tokens: 980000 } }, { text: capturedSummary }, { text: "Red" }],
	);
	report(`${claudeModel}: over the limit, the next run compacts first`, claude.error === undefined && claude.requests.length === 3, `  error: ${claude.error}; requests: ${claude.requests.length}`);
	report(`${claudeModel}: the automatic compaction request carries Claude Code's headers`, claude.requests[1]?.headers["x-claude-code-request-class"] === "compaction");
	const post = (claude.requests[2]?.body.messages ?? []).filter((message) => message.role !== "system");
	report(`${claudeModel}: the run after compaction carries the continuation, then the kept round`, textOf(post[1]).includes("This session is being continued") && textOf(post[2]) === "ok");
}

await runCodex();
await runClaude();
await runAutomatic();

// The thresholds: Codex's default auto-compact limit is 90% of the window (not verified against the captured source), and
// Claude Code's is the window less min(max output, 20000) less 13000 (verified from the binary's formula).
same("openai-codex threshold on a 272000 window", compactionLimit({ provider: "openai-codex", id: "gpt-5.6-sol", contextWindow: 272000, maxTokens: 128000 }), 244800);
same("anthropic threshold on claude-opus-5-5 (1000000 window, 128000 max output)", compactionLimit({ provider: "anthropic", id: "claude-opus-5-5", contextWindow: 1000000, maxTokens: 128000 }), 967000);

console.log(`check-compaction: ${passed} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
