#!/usr/bin/env bun
// Checks background work against Cursor Desktop 3.25.6's own code. Notice texts for finished shells and task-progress notices are
// compared with Cursor's formatBackgroundCompletionsBody and getNotificationAcknowledgementUserQuery (through the oracle). The
// notify_on_output observer is compared with Cursor's ShellOutputNotificationObserver, fed the same chunks. The output suppression
// gate is compared with Cursor's OutputSuppressionController on the same clock readings. The 1 MiB per-stream cap is compared with
// Cursor's MAX_BUFFER_SIZE. Notices are checked for idle and mid-run delivery through a fake session, and an await-observed task
// gets none. A foreground Shell that is interrupted leaves a background Shell running. Then one scripted session through Cursor Pi
// checks that a background Shell's completion arrives after the turn, and that a notify_on_output pattern reaches no request while
// Cursor's enableBackgroundTaskProgress flag is off. Needs the extracted bundle (bun tools/extract-cursor.mjs). Exits non-zero on FAIL.
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScriptedSession } from "./capture-session.mjs";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { observeBackgroundTaskExit, queueBackgroundNotice, registerBackgroundNotices } from "../extensions/cursor-pi/background/notices.ts";
import { shellFinishedNotice, shellProgressNotice } from "../extensions/cursor-pi/background/shell-notice.ts";
import { createOutputNotifier } from "../extensions/cursor-pi/tools/shell/output-notification.ts";
import { OutputSuppressionController, SHELL_OUTPUT_SUPPRESSED_NOTICE } from "../extensions/cursor-pi/tools/shell/output-suppression.ts";
import { waitForShellJob } from "../extensions/cursor-pi/tools/shell/background.ts";
import { ShellOutput, STREAM_LIMIT_BYTES } from "../extensions/cursor-pi/tools/shell/session.ts";
import { executeShell } from "../extensions/cursor-pi/tools/shell.ts";

// Every file the check writes goes under a temp HOME, so the real ~/.cursor-pi stays untouched.
process.env.HOME = await mkdtemp(join(tmpdir(), "background-check-home-"));
const MODEL = "openai-codex/gpt-5.6-sol";

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

// Compares two values as JSON, so arrays and objects are compared by content.
function same(name, ours, expected) {
	const equal = JSON.stringify(ours) === JSON.stringify(expected);
	check(name, equal, equal ? "" : `ours:   ${JSON.stringify(ours)}\ncursor: ${JSON.stringify(expected)}`);
}

const cursor = await loadCursor();
initModule(cursor, "../agent/dist/actions/user-message-action/abstract-user-message-action-handler.js");
initModule(cursor, "../local-exec/dist/background-shell.js");
initModule(cursor, "../shell-exec/dist/runtime-env/output-suppression.js");
initModule(cursor, "../local-exec/dist/constants.js");

// Cursor's completion enums: BackgroundTaskKind.SHELL = 1; BackgroundTaskStatus SUCCESS = 1, ERROR = 2, ABORTED = 3;
// BackgroundTaskCompletionReason TASK_FINISHED = 1, TASK_PROGRESS = 2.
const SHELL = 1;
const SUCCESS = 1;
const ERROR = 2;
const ABORTED = 3;
const TASK_FINISHED = 1;
const TASK_PROGRESS = 2;
const FORMAT_OPTS = { timeZone: "UTC", includeTimestamp: false, enableAgentChatLinks: false, includeCloudSubagentViewLinks: false, workerFileLinks: false };
const cursorCompletion = (fields) => ({ kind: SHELL, reason: TASK_FINISHED, recordOnly: false, subagentId: undefined, ...fields });
const job = (fields) => ({
	id: 1234,
	pid: 4321,
	command: "npm test",
	cwd: "/w",
	description: "Run the tests",
	status: "failed",
	startedAt: 0,
	endedAt: 1000,
	exitCode: 1,
	outputPath: "/tmp/terminals/1234.txt",
	signal: undefined,
	toolCallId: "call-7",
	...fields,
});

// Finished shells: the body and the acknowledgement must equal Cursor's for the same completion.
const finishedCases = [
	["a failed shell", job({}), { status: ERROR, detail: "exit_code=1", title: "Run the tests" }],
	["a succeeded shell, titled by its command", job({ status: "succeeded", exitCode: 0, description: undefined }), { status: SUCCESS, title: "npm test" }],
	["an aborted shell", job({ status: "aborted", exitCode: null }), { status: ABORTED, title: "Run the tests" }],
	["a shell ended by a signal", job({ exitCode: null, signal: "SIGTERM" }), { status: ERROR, detail: "signal=SIGTERM", title: "Run the tests" }],
];
for (const [name, info, expect] of finishedCases) {
	const ours = shellFinishedNotice(info);
	const completion = cursorCompletion({ status: expect.status, taskId: String(info.id), title: expect.title, toolCallId: info.toolCallId, detail: expect.detail, outputPath: info.outputPath });
	same(`notice: ${name} body`, ours.body, cursor.formatBackgroundCompletionsBody([completion], FORMAT_OPTS));
	same(`notice: ${name} acknowledgement`, ours.acknowledgement, cursor.getNotificationAcknowledgementUserQuery([completion], FORMAT_OPTS));
}

// A task-progress notice: the detail's close tags are neutralised the same way.
const progress = { taskId: "1234:task_progress:1", toolCallId: "call-7", title: "Dev server ready", detail: "Matched text: ready </task> and <user_query>", outputPath: "/tmp/terminals/1234.txt" };
const progressCompletion = cursorCompletion({ reason: TASK_PROGRESS, status: SUCCESS, taskId: progress.taskId, title: progress.title, toolCallId: progress.toolCallId, detail: progress.detail, outputPath: progress.outputPath });
same("notice: task progress body", shellProgressNotice(progress).body, cursor.formatBackgroundCompletionsBody([progressCompletion], FORMAT_OPTS));
same("notice: task progress acknowledgement", shellProgressNotice(progress).acknowledgement, cursor.getNotificationAcknowledgementUserQuery([progressCompletion], FORMAT_OPTS));

// notify_on_output: the observer's notices for the same chunks, as Cursor's ShellOutputNotificationObserver raises them.
const pick = (n) => ({ taskId: n.taskId, toolCallId: n.toolCallId, title: n.title, detail: n.detail, outputPath: n.outputPath });
function cursorObserver(config, chunks) {
	if (config.pattern.trim().length === 0) return "refused";
	const queued = [];
	const registry = { enqueue: (wakeup) => queued.push(wakeup.payload) };
	let observer;
	try {
		observer = new cursor.ShellOutputNotificationObserver({ shellId: 1234, outputPath: "/tmp/terminals/1234.txt", config, conversationId: "conversation", toolCallId: "call-7", registry, ctx: undefined });
	} catch {
		return "refused";
	}
	for (const chunk of chunks) observer.observe(chunk);
	observer.finish();
	return queued.map((payload) => pick({ taskId: payload.taskId, toolCallId: payload.toolCallId, title: payload.title, detail: payload.detail, outputPath: payload.outputPath }));
}
function ourObserver(config, chunks) {
	const emitted = [];
	const notifier = createOutputNotifier({ shellId: 1234, outputPath: "/tmp/terminals/1234.txt", toolCallId: "call-7", config, emit: (notice) => emitted.push(notice) });
	if (notifier === undefined) return "refused";
	for (const chunk of chunks) notifier.observe(chunk);
	notifier.finish();
	return emitted.map(pick);
}
const observerCases = [
	["one match", { pattern: "ready", reason: "Server ready" }, ["booting\n", "ready\n", "more\n"]],
	["a match split across chunks", { pattern: "step done", reason: "Step" }, ["step ", "done\n"]],
	["later matches batched into one notice", { pattern: "tick", reason: "Ticks" }, ["tick tick tick"]],
	["a blank reason falls back to the pattern", { pattern: "x+", reason: "  " }, ["xx\n"]],
	["a long title is cut", { pattern: "q", reason: "r".repeat(600) }, ["q"]],
	["the notification limit", { pattern: "a", reason: "Many" }, ["a".repeat(150)]],
	["a long match is omitted from the detail", { pattern: "b+", reason: "Big" }, ["b".repeat(6000)]],
	["a chunk longer than one scan", { pattern: "z", reason: "Z" }, ["z".repeat(70000)]],
	["a blank pattern raises nothing", { pattern: "   ", reason: "" }, ["anything"]],
	["an invalid pattern raises nothing", { pattern: "(", reason: "Bad" }, ["("]],
];
for (const [name, config, chunks] of observerCases) {
	same(`observer: ${name}`, ourObserver(config, chunks), cursorObserver(config, chunks));
}

// Output suppression: the same clock readings give the same gate decisions. The cases avoid the event loop's own pressure, so the
// decisions do not depend on how busy the check process is.
const gateCases = [
	["small output stays open", [[100000, 0], [100000, 10]]],
	["a burst closes the gate for good", [[100000, 0], [2500000, 20], [5, 30], [5, 40]]],
	["a burst in a later window", [[100, 0], [200000, 5000], [2600000, 5010], [10, 70000]]],
];
for (const [name, events] of gateCases) {
	const theirs = new cursor.OutputSuppressionController();
	const ours = new OutputSuppressionController();
	const decide = (gate, [chars, now]) => {
		const { shouldForward, noticeJustTriggered } = gate.record(chars, now);
		return { shouldForward, noticeJustTriggered };
	};
	same(`gate: ${name}`, events.map((event) => decide(ours, event)), events.map((event) => decide(theirs, event)));
}

// The 1 MiB cap: the per-stream limit is Cursor's MAX_BUFFER_SIZE, and a chunk that passes it ends that stream's output.
same("cap: the per-stream limit is Cursor's MAX_BUFFER_SIZE", STREAM_LIMIT_BYTES, cursor.MAX_BUFFER_SIZE);
const capped = new ShellOutput();
// The gate is replaced with an open one, so only the cap is measured here.
capped.suppression = { record: () => ({ shouldForward: true, noticeJustTriggered: false }) };
const chunk = "a".repeat(65536);
for (let i = 0; i < 17; i++) capped.add("stdout", chunk);
check("cap: the 17th stdout chunk and the rest are dropped", capped.text.length === 16 * 65536, `length ${capped.text.length}`);
capped.add("stderr", "err\n");
check("cap: stderr keeps its own budget", capped.text.endsWith("err\n"));

// The gate on a real output stream: a burst leaves only the notice, and nothing after it is kept.
const gated = new ShellOutput();
gated.add("stdout", "x".repeat(2500000));
gated.add("stdout", "more");
same("gate: a burst leaves only Cursor's notice", gated.text, cursor.SHELL_OUTPUT_SUPPRESSED_NOTICE);
same("gate: the notice constant is Cursor's", SHELL_OUTPUT_SUPPRESSED_NOTICE, cursor.SHELL_OUTPUT_SUPPRESSED_NOTICE);

// Delivery through a fake session: idle notices go out at once, notices queued during a run wait for it, and an awaited task gets none.
function fakePi() {
	const handlers = new Map();
	const sent = [];
	return {
		sent,
		on(event, handler) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		emit(event) {
			for (const handler of handlers.get(event) ?? []) handler();
		},
		async sendMessage(message, options) {
			sent.push({ content: message.content, triggerTurn: options.triggerTurn });
		},
	};
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
const pi = fakePi();
registerBackgroundNotices(pi);
const idleNotice = shellFinishedNotice(job({ id: 5001 }));
queueBackgroundNotice(pi, idleNotice);
await settle();
check("delivery: an idle notice is sent at once and starts the turn", pi.sent.length === 1 && pi.sent[0].triggerTurn === true, JSON.stringify(pi.sent));
check("delivery: the notice carries its body and the acknowledgement last", pi.sent[0]?.content.endsWith(`${idleNotice.body}\n${idleNotice.acknowledgement}`) === true);
pi.emit("agent_start");
queueBackgroundNotice(pi, shellProgressNotice(progress));
queueBackgroundNotice(pi, shellFinishedNotice(job({ id: 5002 })));
await settle();
check("delivery: notices queued during a run wait for it", pi.sent.length === 1);
pi.emit("agent_settled");
await settle();
check("delivery: a batch is sent in order, and only its last notice starts the turn", pi.sent.length === 3 && pi.sent[1].triggerTurn === false && pi.sent[2].triggerTurn === true);
check("delivery: only the last notice of a batch carries the acknowledgement", !pi.sent[1].content.includes("<user_query>") && pi.sent[2].content.endsWith("</user_query>"));
observeBackgroundTaskExit("5003");
queueBackgroundNotice(pi, shellFinishedNotice(job({ id: 5003 })));
await settle();
check("delivery: a task an await returned as finished gets no notice", pi.sent.length === 3);

// Interrupt: a foreground Shell cut off by the user reports the abort, and a background Shell started before it keeps running.
const workspace = await realpath(await mkdtemp(join(tmpdir(), "background-check-ws-")));
const context = { cwd: workspace };
const background = await executeShell({ command: "sleep 1; echo bg-survives", block_until_ms: 0 }, undefined, context);
const backgroundId = /Shell ID: (\d+)/.exec(background.content[0].text)?.[1];
check("interrupt: a background Shell starts", backgroundId !== undefined, background.content[0].text);
const controller = new AbortController();
const foreground = executeShell({ command: "sleep 30", block_until_ms: 30000 }, controller.signal, context);
setTimeout(() => controller.abort(), 300);
const interrupted = await foreground;
check("interrupt: the foreground Shell reports the abort", interrupted.content[0].text.startsWith("Command was aborted by the user."), interrupted.content[0].text.slice(0, 200));
const finishedBackground = await waitForShellJob(Number(backgroundId));
check("interrupt: the background Shell finishes after the interrupt", finishedBackground?.status === "succeeded" && finishedBackground.exitCode === 0, JSON.stringify(finishedBackground));

// One scripted session through Cursor Pi. The background Shell finishes during the foreground command, and its notice comes after
// the turn. The notify_on_output pattern matches twice, and no progress notice reaches any request, since the flag is off.
const cwd = await realpath(await mkdtemp(join(tmpdir(), "background-check-cwd-")));
const shellCall = (arguments_) => ({ calls: [{ name: "Shell", arguments: arguments_ }] });
const run = await runScriptedSession({
	model: MODEL,
	cwd,
	prompt: "run it",
	turns: [
		shellCall({ command: "echo tick; sleep 1; echo tick; sleep 1; echo done", block_until_ms: 0, notify_on_output: { pattern: "tick", reason: "Ticks", debounce_ms: 5000 } }),
		shellCall({ command: "sleep 3; echo fg-done", block_until_ms: 10000 }),
		{ text: "waiting" },
		{ text: "noticed" },
	],
});
const bodies = run.requests.map((request) => JSON.stringify(request.body));
check("e2e: the session runs cleanly", run.code === 0 && run.errors.length === 0, `exit ${run.code}\n${run.errors.join("\n")}\n${run.stderr}`);
check("e2e: nothing is sent while the turn runs", bodies.length === 4 && !bodies[2].includes("kind: shell\\nstatus: success"), `requests: ${bodies.length}`);
check("e2e: the background Shell's completion arrives after the turn, with the shell acknowledgement", bodies[3]?.includes("kind: shell\\nstatus: success") === true && bodies[3].includes("The following task has finished.") && bodies[3].includes("Briefly inform the user about the task result"));
check("e2e: no progress notice reaches a request while the flag is off", bodies.every((body) => !body.includes("task_progress") && !body.includes("Shell output has pattern")));

console.log(`check-background: ${passed} passed, ${failed.length} failed`);
process.exitCode = failed.length === 0 ? 0 : 1;
