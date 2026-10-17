// Compares the Shell tool with Cursor Desktop 3.25.6's own formatter, then runs the tool end to end in temp workspaces.
// Needs the extracted bundle (bun tools/extract-cursor.mjs). Exits non-zero on any FAIL.
import { mkdir, mkdtemp, readFile, realpath, rm, rmdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { waitForShellJob } from "../extensions/cursor-pi/tools/shell/background.ts";
import { renderShellResult } from "../extensions/cursor-pi/tools/shell/format.ts";
import { projectDirFor, terminalsDirFor } from "../extensions/cursor-pi/tools/shell/paths.ts";
import { executeShell } from "../extensions/cursor-pi/tools/shell.ts";

const OPTIONS = { discourageAwait: false, promptVersion: "latest", sandboxPromptEnabled: false, useMinimalHarness: false };
const STATE = "Shell state (cwd, env vars) persists for subsequent calls.";

const cursor = await loadCursor();
initModule(cursor, "../agent/dist/tools/core/shell/retry-helpers.js");
if (typeof cursor.renderShellResultToString !== "function") throw new Error("renderShellResultToString is not in the Cursor bundle");

// Enum numbers from the proto (ShellAbortReason, ShellBackgroundReason), used if the bundle does not expose the enums.
const AB = { USER_ABORT: cursor.ShellAbortReason?.USER_ABORT ?? 1, TIMEOUT: cursor.ShellAbortReason?.TIMEOUT ?? 2 };
const BG = { TIMEOUT: cursor.ShellBackgroundReason?.TIMEOUT ?? 1, USER_REQUEST: cursor.ShellBackgroundReason?.USER_REQUEST ?? 2 };

let failures = 0;
let checks = 0;

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

function diffText(expected, actual) {
	let i = 0;
	while (i < expected.length && expected[i] === actual[i]) i += 1;
	const around = (text) => JSON.stringify(text.slice(Math.max(0, i - 40), i + 80));
	return `  expected: ${around(expected)}\n  actual:   ${around(actual)}\n  first difference at character ${i}`;
}

function same(name, actual, expected) {
	report(name, actual === expected, diffText(expected, actual));
}

// Our details in Cursor's shape: enums become their numbers.
function toCursor(input) {
	const { result, isBackground, terminalsFolder } = input;
	if (result.case === "spawnError") return { result: { case: "spawnError", value: { ...result.value } }, isBackground, terminalsFolder };
	const v = result.value;
	return {
		result: {
			case: result.case,
			value: {
				command: v.command,
				workingDirectory: v.workingDirectory,
				exitCode: v.exitCode,
				signal: v.signal,
				interleavedOutput: v.interleavedOutput,
				executionTime: v.executionTime,
				localExecutionTimeMs: v.localExecutionTimeMs,
				outputLocation: v.outputLocation,
				shellId: v.shellId,
				pid: v.pid,
				msToWait: v.msToWait,
				backgroundReason: v.backgroundReason === undefined ? undefined : BG[v.backgroundReason],
				aborted: v.aborted,
				abortReason: v.abortReason === undefined ? undefined : AB[v.abortReason],
			},
		},
		isBackground,
		terminalsFolder,
	};
}

function cursorRender(input) {
	return cursor.renderShellResultToString(toCursor(input), OPTIONS);
}

const TERMINALS = "/home/user/.cursor-pi/projects/x/terminals";
const LONG = `${"x".repeat(15000)}\n${"y".repeat(15000)}\n`;
const ok = (value, extra = {}) => ({ result: { case: "success", value: { ...value } }, isBackground: false, terminalsFolder: TERMINALS, ...extra });
const fail = (value) => ({ result: { case: "failure", value }, isBackground: false, terminalsFolder: TERMINALS });
const spawnFail = (command, error) => ({ result: { case: "spawnError", value: { command, error } }, isBackground: false, terminalsFolder: TERMINALS });

const synthetic = [
	["foreground success", ok({ command: "python3 --version", exitCode: 0, signal: "", interleavedOutput: "Python 3.13.5\n", executionTime: 1142, localExecutionTimeMs: 1142 })],
	["foreground failure with working directory", fail({ command: "python --version", exitCode: 127, signal: "", interleavedOutput: "zsh: command not found: python\n", executionTime: 1349, localExecutionTimeMs: 1349, workingDirectory: "/work/dir" })],
	["foreground long output", ok({ command: "cat big", exitCode: 0, signal: "", interleavedOutput: LONG, executionTime: 5, localExecutionTimeMs: 5 })],
	["output file", ok({ command: "cat huge", exitCode: 0, signal: "", interleavedOutput: "", executionTime: 9, outputLocation: { filePath: "/t/agent-tools/a.txt", sizeBytes: 51200, lineCount: 1500 } })],
	["output file under 1 KB", ok({ command: "cat small", exitCode: 0, signal: "", interleavedOutput: "", executionTime: 9, outputLocation: { filePath: "/t/agent-tools/b.txt", sizeBytes: 900, lineCount: 3 } })],
	["user abort with reason", fail({ command: "sleep 10", exitCode: -1, signal: "SIGTERM", aborted: true, abortReason: "USER_ABORT", interleavedOutput: "partial\n", executionTime: 310, workingDirectory: "/w" })],
	["aborted without reason", fail({ command: "sleep 10", exitCode: -1, signal: "SIGTERM", aborted: true, interleavedOutput: "", executionTime: 12 })],
	["SIGTERM without abort, blank working directory", fail({ command: "kill $$", exitCode: -1, signal: "SIGTERM", interleavedOutput: "x\n", executionTime: 7, workingDirectory: "   " })],
	["backgrounded with output", ok({ command: "sleep 2; echo done", shellId: 4321, pid: 4242, msToWait: 500, backgroundReason: "TIMEOUT", interleavedOutput: "first line\n", executionTime: 501 })],
	["backgrounded without output or pid", ok({ command: "sleep 9", shellId: 4322, pid: 0, msToWait: 500, backgroundReason: "TIMEOUT", interleavedOutput: "", executionTime: 501 })],
	["backgrounded with long output", ok({ command: "cat big", shellId: 4323, pid: 4243, msToWait: 1000, backgroundReason: "TIMEOUT", interleavedOutput: LONG, executionTime: 1001 })],
	["background started", { result: { case: "success", value: { command: "npm run dev", shellId: 777, pid: 888, backgroundReason: "USER_REQUEST", executionTime: 3 } }, isBackground: true, terminalsFolder: TERMINALS }],
	["background started without pid", { result: { case: "success", value: { command: "tail -f log", shellId: 778, executionTime: 2 } }, isBackground: true, terminalsFolder: TERMINALS }],
	["spawn error with command", spawnFail("ls", "Aborted")],
	["spawn error without command", spawnFail("", "working directory does not exist: /x; the command did not run")],
	["background spawn error", { ...spawnFail("ls", "boom"), isBackground: true }],
];

for (const [name, input] of synthetic) same(`render: ${name}`, renderShellResult(input), cursorRender(input));

async function withWorkspace(name, body) {
	const workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), "shell-check-")));
	try {
		await body(workspace, { cwd: workspace });
	} catch (error) {
		report(name, false, `  threw: ${error?.stack ?? error}`);
	} finally {
		await rm(projectDirFor(workspace), { recursive: true, force: true });
		await rm(workspace, { recursive: true, force: true });
	}
}

// Runs the tool, then checks its text against Cursor's rendering of the same details.
async function run(name, params, ctx, signal) {
	const result = await executeShell(params, signal, ctx);
	const text = result.content[0].text;
	same(`${name}: Cursor renders the same details`, text, cursorRender(result.details));
	return { text, details: result.details, value: result.details.result.value };
}

// The command's own duration varies between runs, so it is normalized before comparing with a captured text.
const normalizeMs = (text) => text.replace(/(Command (?:completed in|aborted after)) \d+ ms\./g, "$1 N ms.");

await withWorkspace("foreground echo", async (ws, ctx) => {
	const r = await run("foreground echo", { command: "echo hello" }, ctx);
	same("foreground echo: text", normalizeMs(r.text), `Exit code: 0\n\nCommand output:\n\n\`\`\`\nhello\n\n\`\`\`\n\nCommand completed in N ms.\n\n${STATE}`);
});

// Captured call 049 (Python, uv and cargo paths). Its own command depended on the machine, so the same output is printed here.
await withWorkspace("captured 049 shape", async (ws, ctx) => {
	const r = await run("captured 049 shape", { command: "printf 'Python 3.13.5\\n/opt/homebrew/bin/uv\\n/opt/homebrew/bin/cargo\\n'" }, ctx);
	same("captured 049 shape: text", normalizeMs(r.text), "Exit code: 0\n\nCommand output:\n\n```\nPython 3.13.5\n/opt/homebrew/bin/uv\n/opt/homebrew/bin/cargo\n\n```\n\nCommand completed in N ms.\n\n" + STATE);
});

await withWorkspace("nonzero exit", async (ws, ctx) => {
	const r = await run("nonzero exit", { command: "echo out; echo err 1>&2; exit 3" }, ctx);
	report("nonzero exit: code and both streams", r.value.exitCode === 3 && r.text.startsWith("Exit code: 3\n") && r.text.includes("out") && r.text.includes("err"), `  text: ${JSON.stringify(r.text)}`);
});

await withWorkspace("inline truncation", async (ws, ctx) => {
	const r = await run("inline truncation", { command: "head -c 25000 /dev/zero | tr '\\0' b; echo" }, ctx);
	report("inline truncation: heading and marker", r.text.includes("Command output (truncated to 20000 characters):") && r.text.includes("\n\n... (output truncated) ...\n\n"), `  text head: ${JSON.stringify(r.text.slice(0, 120))}`);
});

await withWorkspace("output file", async (ws, ctx) => {
	const r = await run("output file", { command: "head -c 50000 /dev/zero | tr '\\0' a" }, ctx);
	const location = r.value.outputLocation;
	const size = location ? (await stat(location.filePath)).size : -1;
	report("output file: location and content size", location !== undefined && location.filePath.startsWith(path.join(projectDirFor(ws), "agent-tools")) && size === 50000 && r.text.includes("Command output has been written to: "), `  text: ${JSON.stringify(r.text.slice(0, 200))}`);
});

await withWorkspace("state persists", async (ws, ctx) => {
	await mkdir(path.join(ws, "sub"));
	await run("state set", { command: "export CURSOR_PI_CHECK=kept; cd sub" }, ctx);
	const r = await run("state read", { command: 'echo "$CURSOR_PI_CHECK"; pwd' }, ctx);
	report("state persists: env and cwd", r.value.interleavedOutput === `kept\n${ws}/sub\n`, `  output: ${JSON.stringify(r.value.interleavedOutput)}`);
});

await withWorkspace("working_directory", async (ws, ctx) => {
	await mkdir(path.join(ws, "sub"));
	const r = await run("working_directory", { command: "pwd", working_directory: "sub" }, ctx);
	report("working_directory: current directory line", r.text.includes(`${STATE} Current directory: ${ws}/sub`) && r.value.interleavedOutput === `${ws}/sub\n`, `  text: ${JSON.stringify(r.text)}`);
});

await withWorkspace("missing working_directory", async (ws, ctx) => {
	const r = await run("missing working_directory", { command: "echo x", working_directory: "nope" }, ctx);
	same("missing working_directory: text", r.text, `Error: Command failed to spawn: working directory does not exist: ${ws}/nope; the command did not run`);
});

await withWorkspace("user abort", async (ws, ctx) => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 300);
	const r = await run("user abort", { command: "sleep 10", block_until_ms: 30000 }, ctx, controller.signal);
	clearTimeout(timer);
	report("user abort: text", r.text.startsWith("Command was aborted by the user.\nExit code: -1\n") && /Command aborted after \d+ ms\./.test(r.text), `  text: ${JSON.stringify(r.text)}`);
});

await withWorkspace("background after timeout", async (ws, ctx) => {
	const r = await run("background after timeout", { command: "sleep 2; echo done", block_until_ms: 500 }, ctx);
	report("background after timeout: start text", r.text.startsWith("The command did not complete in 500ms and was sent to the background.\nShell ID: "), `  text: ${JSON.stringify(r.text)}`);
	const job = await waitForShellJob(r.value.shellId);
	report("background after timeout: job succeeded", job?.status === "succeeded" && job.exitCode === 0, `  job: ${JSON.stringify(job)}`);
	const file = await readFile(job.outputPath, "utf8");
	report("background after timeout: terminal file", file.includes("done") && file.includes("exit_code: 0") && file.includes("status: succeeded"), `  file: ${JSON.stringify(file)}`);
});

await withWorkspace("background immediately", async (ws, ctx) => {
	const r = await run("background immediately", { command: "echo bg-direct", block_until_ms: 0 }, ctx);
	const outputPath = path.join(terminalsDirFor(projectDirFor(ws)), `${r.value.shellId}.txt`);
	report("background immediately: start text", r.text.startsWith("Background command started successfully.\nShell ID: ") && r.text.includes(`Output will be written to ${outputPath}. Don't mention Shell ID to the user.`), `  text: ${JSON.stringify(r.text)}`);
	const job = await waitForShellJob(r.value.shellId);
	const file = await readFile(job.outputPath, "utf8");
	report("background immediately: terminal file", job.status === "succeeded" && file.includes("bg-direct"), `  file: ${JSON.stringify(file)}`);
});

// Captured call 048 has working_directory and "Current directory:" in its state line; that is covered by the working_directory case.

await rmdir(path.join(os.homedir(), ".cursor-pi", "projects")).catch(() => {});
await rmdir(path.join(os.homedir(), ".cursor-pi")).catch(() => {});

console.log(`${checks - failures} of ${checks} checks passed`);
process.exitCode = failures === 0 ? 0 : 1;
