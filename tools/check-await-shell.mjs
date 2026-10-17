#!/usr/bin/env bun
// Checks AwaitShell against Cursor Desktop 3.25.6's own await tool (agent/dist/tools/core/await.js), run through the oracle on the
// same terminal files. Then three scripted sessions run through Cursor Pi with capture-session's runner: a background Shell awaited
// with a pattern and then to completion (no notice follows an awaited shell), and a background Shell that finishes while a
// foreground command runs (its notice comes at the end of that turn). Needs the extracted bundle (bun tools/extract-cursor.mjs).
// Exits non-zero on any FAIL.
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScriptedSession } from "./capture-session.mjs";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { capturedConciseInstruction } from "../extensions/cursor-pi/dynamic/captured-instructions.ts";
import { getDynamicTool } from "../extensions/cursor-pi/dynamic/registry.ts";
import { capturedNamespaceDeclaration } from "../extensions/cursor-pi/tools/namespace/captured.ts";
import { executeAwaitShell, register as registerAwaitShell } from "../extensions/cursor-pi/tools/namespace/await-shell.ts";
import { projectDirFor, terminalsDirFor } from "../extensions/cursor-pi/tools/shell/paths.ts";

// Every file the check writes goes under a temp HOME, so the real ~/.cursor-pi stays untouched.
process.env.HOME = await mkdtemp(join(tmpdir(), "await-shell-check-home-"));
const MODEL = "openai-codex/gpt-5.6-sol";
const STARTED_MS = Date.UTC(2026, 9, 17, 9, 0, 0);
// The fake provider fills this in from the request that answers the call: the id the Shell result named.
const SHELL_ID_FROM_PREVIOUS = "{{match:Shell ID: (\\d+)}}";

let passed = 0;
const failed = [];

function check(name, ok, detail = "") {
	if (ok) {
		passed += 1;
		console.log(`ok - ${name}`);
		return;
	}
	failed.push(name);
	console.log(`FAIL - ${name}${detail === "" ? "" : `\n${detail.slice(-2000)}`}`);
}

function same(name, ours, expected) {
	check(name, ours === expected, ours === expected ? "" : `ours:   ${JSON.stringify(ours)}\ncursor: ${JSON.stringify(expected)}`);
}

// Elapsed times differ between runs, so the figures are read as N before the two texts are compared.
const normalize = (text) => text.replace(/still running after \d+ms/g, "still running after Nms").replace(/Slept (?:briefly|for \d+s)\./g, "Slept T.");

const cursor = await loadCursor();
initModule(cursor, "../agent/dist/tools/core/await.js");
if (typeof cursor.createAwaitTool !== "function") throw new Error("createAwaitTool is not in the Cursor bundle");

const declared = capturedNamespaceDeclaration("AwaitShell");
check("declaration: AwaitShell takes shell_id, block_until_ms and pattern", JSON.stringify(Object.keys(declared.parameters.properties ?? {})) === JSON.stringify(["shell_id", "block_until_ms", "pattern"]));
registerAwaitShell();
const registered = getDynamicTool("cursor", "AwaitShell");
check("registry: AwaitShell is registered in the cursor namespace", registered !== undefined);
check("registry: AwaitShell concise line is Cursor's", registered?.conciseInstructions === capturedConciseInstruction("AwaitShell"));

const workspace = await realpath(await mkdtemp(join(tmpdir(), "await-shell-check-ws-")));
const terminals = terminalsDirFor(projectDirFor(workspace));
await mkdir(terminals, { recursive: true });

// A terminal file as background.ts writes it: a frontmatter header, the merged output, and a footer once the shell has exited.
function terminalFile({ status, body, runningForMs = 1500, exitCode, elapsedMs }) {
	const header = `---\npid: 4242\ncwd: "${workspace}"\ncommand: "echo"\nstatus: ${status.padEnd(9)}\nstarted_at: ${new Date(STARTED_MS).toISOString()}\nrunning_for_ms: ${String(runningForMs).padEnd(9)}\n---\n`;
	const footer = elapsedMs === undefined ? "" : `\n---\nexit_code: ${exitCode ?? "unknown"}\nelapsed_ms: ${elapsedMs}\nended_at: ${new Date(STARTED_MS + elapsedMs).toISOString()}\n---\n`;
	return `${header}${body}${footer}`;
}

const FILES = {
	1001: { status: "succeeded", body: "Python 3.13.5\nready\n", exitCode: 0, elapsedMs: 1234 },
	1002: { status: "failed", body: "fail: boom\nfinished\n", exitCode: 1, elapsedMs: 2000 },
	1003: { status: "aborted", body: "partial\n", elapsedMs: 500 },
	1004: { status: "running", body: "step 1\nstep 2 ready\n" },
	1005: { status: "running", body: "quiet so far\n" },
};
for (const [id, spec] of Object.entries(FILES)) await writeFile(join(terminals, `${id}.txt`), terminalFile(spec));

// The oracle side: Cursor's await tool reads the terminal files through a read executor, and waits on a steer signal.
const interactionHandler = { emitPartialToolCall: async () => undefined, executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx), getAbortSignal: () => undefined };
const reader = {
	get: () => ({
		execute: async (_ctx, args) => {
			try {
				const bytes = await readFile(args.path);
				return { result: { case: "success", value: { output: { case: "content", value: bytes.toString("utf8") }, fileSize: BigInt(bytes.length) } } };
			} catch (error) {
				if (error.code === "ENOENT") return { result: { case: "fileNotFound", value: {} } };
				throw error;
			}
		},
	}),
};
const steer = {
	pending: false,
	hasPendingUserInjections() {
		return this.pending;
	},
	onUserInjectionAdmitted() {
		return () => undefined;
	},
};
const streamOf = (text) => (async function* () {
	yield text;
})();

async function cursorText(args, queued) {
	const tool = cursor.createAwaitTool(reader, { terminalsFolder: terminals }, "latest");
	const callCtx = cursor.createContext();
	steer.pending = queued;
	try {
		const out = await tool.execute(callCtx, interactionHandler, streamOf(JSON.stringify(args)), { toolCallId: "await-probe", contextInjectionSignal: steer });
		return (await tool.render(callCtx, out, {})).content[0].text;
	} catch (error) {
		return (await tool.render(callCtx, tool.serializeError(error).tool.value.result, {})).content[0].text;
	} finally {
		steer.pending = false;
	}
}

const oursResult = (args, queued) => executeAwaitShell(args, undefined, { cwd: workspace, hasPendingMessages: () => queued });

const CASES = [
	["complete with exit 0", { shell_id: "1001", block_until_ms: 0 }],
	["complete with a pattern that matches", { shell_id: "1002", block_until_ms: 0, pattern: "finished" }],
	["complete with a pattern that does not match", { shell_id: "1002", block_until_ms: 0, pattern: "nothing" }],
	["complete with an unknown exit code", { shell_id: "1003", block_until_ms: 0 }],
	["a blank pattern counts as none", { shell_id: "1001", block_until_ms: 0, pattern: "   " }],
	["a numeric id under the task_id alias", { task_id: 1001, block_until_ms: 0 }],
	["running with no pattern", { shell_id: "1005", block_until_ms: 0 }],
	["running with a pattern that matches the body", { shell_id: "1004", block_until_ms: 0, pattern: "step 2 \\w+" }],
	["running with a pattern that does not match", { shell_id: "1004", block_until_ms: 0, pattern: "^nope$" }],
	["running and waiting out a short block", { shell_id: "1005", block_until_ms: 300 }],
	["an unknown shell id", { shell_id: "424242", block_until_ms: 0 }],
	["a non-shell id", { shell_id: "abc", block_until_ms: 0 }],
	["a sleep without an id", { block_until_ms: 100 }],
	["an invalid zero wait without an id", { block_until_ms: 0 }],
	["an invalid block_until_ms", { shell_id: "1001", block_until_ms: "soon" }],
	["a block_until_ms above the maximum", { shell_id: "1001", block_until_ms: 7140001 }],
	["an invalid pattern type", { shell_id: "1001", pattern: 5 }],
];
for (const [name, args] of CASES) {
	const ours = await oursResult(args, false);
	same(`await: ${name}`, normalize(ours.text), normalize(await cursorText(args, false)));
	check(`await: ${name} is not an error result`, ours.isError === false);
}

// Queued input ends a wait at once, as Cursor's steer signal does.
for (const [name, args] of [
	["a running shell", { shell_id: "1005", block_until_ms: 30000 }],
	["a sleep without an id", { block_until_ms: 30000 }],
]) {
	same(`await: ${name} is released by queued input`, normalize((await oursResult(args, true)).text), normalize(await cursorText(args, true)));
}

// Cases Cursor's RE2 executor words differently, or that have no Cursor counterpart here.
const badPattern = await oursResult({ shell_id: "1004", block_until_ms: 0, pattern: "(" }, false);
check("await: an invalid pattern is refused with an error text", badPattern.text.startsWith("Error awaiting task: pattern is not valid regex syntax"), badPattern.text);
const aborted = await executeAwaitShell({ shell_id: "1004", block_until_ms: 0 }, AbortSignal.abort(), { cwd: workspace, hasPendingMessages: () => false });
same("await: an aborted call", aborted.text, "Error awaiting task: Aborted");

// The scripted sessions: each call is answered by the next scripted turn, and a Shell id comes from the request before it.
async function session(turns) {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "await-shell-check-cwd-")));
	return runScriptedSession({ model: MODEL, cwd, prompt: "run it", turns });
}
const bodiesOf = (run) => run.requests.map((request) => JSON.stringify(request.body));
const shellCall = (arguments_) => ({ calls: [{ name: "Shell", arguments: arguments_ }] });
const awaitCall = (arguments_) => ({ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "AwaitShell", arguments: arguments_ } }] });
const cleanRun = (run) => run.code === 0 && run.errors.length === 0;

const awaited = await session([
	shellCall({ command: "sleep 1; echo await-marker; sleep 1", block_until_ms: 0 }),
	awaitCall({ shell_id: SHELL_ID_FROM_PREVIOUS, block_until_ms: 20000, pattern: "await-marker" }),
	awaitCall({ shell_id: SHELL_ID_FROM_PREVIOUS, block_until_ms: 20000 }),
	{ text: "waited" },
]);
const awaitedBodies = bodiesOf(awaited);
check("e2e awaited: the session runs cleanly", cleanRun(awaited), `exit ${awaited.code}\n${awaited.errors.join("\n")}\n${awaited.stderr}`);
check("e2e awaited: a background Shell names its shell id", awaitedBodies[1]?.includes("Background command started successfully") === true);
check("e2e awaited: the pattern match reaches the next request", awaitedBodies[2]?.includes("Pattern matched: await-marker") === true);
check("e2e awaited: the completed wait reports exit code 0", awaitedBodies[3]?.includes("Task completed in ") === true && awaitedBodies[3].includes("with exit code: 0."));
check("e2e awaited: no completion notice follows an awaited shell", awaitedBodies.every((body) => !body.includes("kind: shell\\nstatus: ")));

const completed = await session([
	shellCall({ command: "echo done-two; sleep 1", block_until_ms: 0 }),
	awaitCall({ shell_id: SHELL_ID_FROM_PREVIOUS, block_until_ms: 20000 }),
	{ text: "finished" },
]);
const completedBodies = bodiesOf(completed);
check("e2e completed: the session runs cleanly", cleanRun(completed), `exit ${completed.code}\n${completed.errors.join("\n")}\n${completed.stderr}`);
check("e2e completed: the wait reports completion with exit code 0", completedBodies[2]?.includes("Task completed in ") === true && completedBodies[2].includes("with exit code: 0."));
check("e2e completed: the session ends after the answer, with no notice", completedBodies.length === 3 && completedBodies.every((body) => !body.includes("kind: shell\\nstatus: ")), `requests: ${completedBodies.length}`);

const notified = await session([
	shellCall({ command: "sleep 1; echo notice-marker", block_until_ms: 0 }),
	shellCall({ command: "sleep 2; echo foreground-done", block_until_ms: 10000 }),
	{ text: "turn ended" },
	{ text: "noticed" },
]);
const notifiedBodies = bodiesOf(notified);
check("e2e notice: the session runs cleanly", cleanRun(notified), `exit ${notified.code}\n${notified.errors.join("\n")}\n${notified.stderr}`);
check("e2e notice: nothing is sent while the turn runs", notifiedBodies.length === 4 && !notifiedBodies[2].includes("kind: shell\\nstatus: "), `requests: ${notifiedBodies.length}`);
const notice = notifiedBodies[3] ?? "";
for (const [name, needle] of [
	["the finished intro", "The following task has finished. If you were already aware, ignore this notification and do not restate prior responses."],
	["the system_notification opening", "<system_notification>\\nThe following task has finished"],
	["the kind and status lines", "kind: shell\\nstatus: success\\ntask_id: "],
	["the title, the command", "title: sleep 1; echo notice-marker\\n"],
	["the output path", "output_path: "],
	["the acknowledgement query", "</system_notification>\\n<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed).</user_query>"],
	["the timestamp line", "<timestamp>"],
]) {
	check(`e2e notice: ${name}`, notice.includes(needle));
}
check("e2e notice: the tool call id of the Shell call", /tool_call_id: call_turn0_0/.test(notice));

console.log(`check-await-shell: ${passed} passed, ${failed.length} failed`);
process.exitCode = failed.length === 0 ? 0 : 1;
