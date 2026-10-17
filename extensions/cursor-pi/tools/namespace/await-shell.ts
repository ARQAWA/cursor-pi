import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { type ArgIssue, checkType, invalidArguments, optionalLenientNumber, optionalString } from "../cursor-args.ts";
import { observeShellExit } from "../shell/notices.ts";
import { projectDirFor, terminalsDirFor } from "../shell/paths.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";

// Cursor's AwaitShell (agent/dist/tools/core/await.js with lenient-number.js) for the shell-only prompt, in the cursor namespace.
// As in Cursor, a shell is read from its terminal file: the header's started_at and running_for_ms give the age of a running
// shell, and the footer's exit_code and elapsed_ms give the result of a finished one. The pattern is compiled as a JavaScript
// regex with the m flag, as the captured declaration describes it; Cursor's executor compiles RE2 instead.
const NAMESPACE = "cursor";
const AWAIT_SHELL = capturedNamespaceDeclaration("AwaitShell");
// Cursor's DEFAULT_BLOCK_UNTIL_MS, and the largest block_until_ms its schema takes (119 minutes).
const DEFAULT_BLOCK_UNTIL_MS = 30000;
const MAX_BLOCK_UNTIL_MS = 7140000;
// Cursor's SHELL_CHECK_SLICE_MS: the terminal file is read again after each slice.
const SHELL_CHECK_SLICE_MS = 250;
// How often a sleep or a slice looks for queued input. Cursor's steer signal resolves at once; this bounds the delay.
const STEER_POLL_MS = 50;
const SHELL_CLOCK_SKEW_TOLERANCE_MS = 1000;
const SHELL_RUNNING_FOR_MS_REFRESH_MS = 5000;
// Cursor's WAITING_FOR_SUBAGENT_ERROR, raised for any id that is not a shell id.
const WAITING_FOR_SUBAGENT_ERROR = "You should NOT wait for subagents to complete. End your turn instead; completions are queued, or do parallel work.";
const IDLESS_ZERO_WAIT = "Required when block_until_ms is 0. Without shell_id there is nothing to check: pass the shell_id to check, or a nonzero block_until_ms to sleep.";
const SLEEP_RELEASED = " Sleep released early: a new user message is arriving.";
const WAIT_RELEASED = " Wait released early: a new user message is arriving.";

interface AwaitArgs {
	taskId: string;
	blockUntilMs: number;
	pattern: string | undefined;
}

type Parsed = { ok: true; args: AwaitArgs } | { ok: false; error: string };

interface PatternResult {
	requested: boolean;
	matched: string | undefined;
}

// What one call found: a sleep for a call without an id, a finished shell, or a shell still running.
type Outcome =
	| { kind: "slept"; runtimeMs: number; released: boolean }
	| { kind: "complete"; runtimeMs: number; outputPath: string; outputLength: number; exitCode: number | undefined; pattern: PatternResult }
	| { kind: "running"; runtimeMs: number; outputPath: string; outputLength: number; released: boolean; pattern: PatternResult };

export function register(): void {
	registerDynamicTool({ namespace: NAMESPACE, declaration: AWAIT_SHELL, conciseInstructions: capturedConciseInstruction(AWAIT_SHELL.name), execute: executeAwaitShell });
}

// Cursor's executor. Every outcome, including a thrown error, reaches the model as Cursor's render gives it: the text, and no error flag.
export async function executeAwaitShell(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	try {
		const parsed = parseArgs(params);
		if (!parsed.ok) return { text: `Error awaiting task: ${parsed.error}`, isError: false };
		return { text: renderOutcome(await awaitShell(parsed.args, signal, ctx)), isError: false };
	} catch (error) {
		return { text: `Error awaiting task: ${error instanceof Error ? error.message : String(error)}`, isError: false };
	}
}

// Cursor's schema checks, in its key order. shell_id takes a number, and the aliases task_id, shellId and taskId stand in for it.
function parseArgs(params: unknown): Parsed {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { ok: false, error: invalidArguments(issues) };
	const input = params as Record<string, unknown>;
	const idValue = input.shell_id !== undefined ? input.shell_id : [input.task_id, input.shellId, input.taskId].find((value) => value !== undefined);
	const shellId = optionalString(typeof idValue === "number" ? String(idValue) : idValue, ["shell_id"], issues);
	const blockUntilMs = optionalLenientNumber(input.block_until_ms, ["block_until_ms"], issues);
	if (blockUntilMs !== undefined && blockUntilMs > MAX_BLOCK_UNTIL_MS) {
		issues.push({ path: ["block_until_ms"], message: `block_until_ms must be at most ${MAX_BLOCK_UNTIL_MS} (${Math.round(MAX_BLOCK_UNTIL_MS / 60000)} minutes)` });
	}
	const pattern = optionalString(input.pattern, ["pattern"], issues);
	if (issues.length > 0) return { ok: false, error: invalidArguments(issues) };
	const taskId = normalizeTaskId(shellId ?? "");
	const waitMs = positiveInt(blockUntilMs);
	if (taskId === "" && waitMs === 0) return { ok: false, error: invalidArguments([{ path: ["shell_id"], message: IDLESS_ZERO_WAIT }]) };
	return { ok: true, args: { taskId, blockUntilMs: waitMs, pattern } };
}

// Cursor's normalizeAwaitTaskId: surrounding space is dropped, and "none" or nothing means no id.
function normalizeTaskId(value: string): string {
	const trimmed = value.trim();
	return trimmed.length === 0 || trimmed.toLowerCase() === "none" ? "" : trimmed;
}

// Cursor's toPositiveInt: a missing, non-finite or negative wait takes the default, and fractions are floored.
function positiveInt(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value) || value < 0) return DEFAULT_BLOCK_UNTIL_MS;
	return Math.floor(value);
}

async function awaitShell(args: AwaitArgs, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<Outcome> {
	const startMs = Date.now();
	if (args.taskId === "") {
		const released = (await sleepOrRelease(args.blockUntilMs, signal, ctx)) === "steer";
		return { kind: "slept", runtimeMs: released ? Date.now() - startMs : args.blockUntilMs, released };
	}
	const requested = args.pattern !== undefined && args.pattern.trim().length > 0;
	const regex = compilePattern(args.pattern);
	if (!/^[0-9]+$/.test(args.taskId)) throw new Error(WAITING_FOR_SUBAGENT_ERROR);
	const outputPath = join(terminalsDirFor(projectDirFor(ctx.cwd)), `${args.taskId}.txt`);
	const deadlineMs = startMs + args.blockUntilMs;
	let steerReleasedMidSleep = false;
	let header: { runningForMs: number; readAtMs: number } | undefined;
	for (;;) {
		throwIfAborted(signal);
		const snapshot = await readSnapshot(outputPath);
		if (!snapshot.exists) throw new Error(`No shell found for id ${args.taskId}`);
		const footer = parseFooter(snapshot.content);
		const runningForMs = parseRunningForMs(snapshot.content);
		const nowMs = Date.now();
		if (runningForMs !== undefined && runningForMs !== header?.runningForMs) header = { runningForMs, readAtMs: nowMs };
		const ageMs = !footer.isComplete && header !== undefined ? runningAgeMs(nowMs, parseStartedAtMs(snapshot.content), header) : runningForMs;
		const runtimeMs = Math.max(0, footer.runtimeMs ?? ageMs ?? nowMs - startMs);
		const match = regex === undefined ? "" : (regex.exec(bodyOf(snapshot.content))?.[0] ?? "");
		const pattern: PatternResult = { requested, matched: requested && match.length > 0 ? truncateMiddle(match) : undefined };
		if (footer.isComplete) {
			const status = frontmatterValue(snapshot.content, "status");
			if (status === "succeeded" || status === "failed" || status === "aborted") observeShellExit(args.taskId);
			return { kind: "complete", runtimeMs, outputPath, outputLength: snapshot.outputLength, exitCode: footer.exitCode, pattern };
		}
		if (match.length > 0) return { kind: "running", runtimeMs, outputPath, outputLength: snapshot.outputLength, released: false, pattern };
		const timedOut = args.blockUntilMs === 0 || Date.now() >= deadlineMs;
		const released = steerReleasedMidSleep || ctx.hasPendingMessages();
		if (timedOut || released) return { kind: "running", runtimeMs, outputPath, outputLength: snapshot.outputLength, released, pattern };
		if ((await sleepOrRelease(SHELL_CHECK_SLICE_MS, signal, ctx)) === "steer") steerReleasedMidSleep = true;
	}
}

// Cursor's regex: the m flag, and a blank pattern means none.
function compilePattern(pattern: string | undefined): RegExp | undefined {
	if (pattern === undefined || pattern.trim().length === 0) return undefined;
	try {
		return new RegExp(pattern, "m");
	} catch (error) {
		throw new Error(`pattern is not valid regex syntax: ${error instanceof Error ? error.message : String(error)}`);
	}
}

// Cursor's sleepOrAbortOrSteerRelease: returns "steer" as soon as queued input exists, "timeout" when the time is up.
async function sleepOrRelease(ms: number, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<"timeout" | "steer"> {
	throwIfAborted(signal);
	if (ctx.hasPendingMessages()) return "steer";
	const deadlineMs = Date.now() + ms;
	for (;;) {
		const remainingMs = deadlineMs - Date.now();
		if (remainingMs <= 0) return "timeout";
		await delayOrAbort(Math.min(STEER_POLL_MS, remainingMs), signal);
		if (ctx.hasPendingMessages()) return "steer";
	}
}

function delayOrAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error("Aborted"));
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new Error("Aborted");
}

// Cursor's readSnapshot: a missing file is not an error, and the output length is the file's size in bytes.
async function readSnapshot(path: string): Promise<{ exists: boolean; content: string; outputLength: number }> {
	let bytes: Buffer;
	try {
		bytes = await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, content: "", outputLength: 0 };
		throw new Error(error instanceof Error ? error.message : "Failed to read shell output");
	}
	return { exists: true, content: bytes.toString("utf8"), outputLength: bytes.length };
}

function renderOutcome(outcome: Outcome): string {
	switch (outcome.kind) {
		case "slept":
			return `${sleepLine(outcome.runtimeMs)}${outcome.released ? SLEEP_RELEASED : ""}`;
		case "complete": {
			const exit = outcome.exitCode === undefined ? "unknown" : String(outcome.exitCode);
			const first = withPattern(`Task completed in ${outcome.runtimeMs}ms with exit code: ${exit}.`, outcome.pattern);
			return `${first}\noutput_file_path: ${outcome.outputPath}\noutput_length: ${outcome.outputLength}`;
		}
		case "running": {
			const first = withPattern(`Task still running after ${outcome.runtimeMs}ms...${outcome.released ? WAIT_RELEASED : ""}`, outcome.pattern);
			return `${first}\noutput_file_path: ${outcome.outputPath}\noutput_length: ${outcome.outputLength}`;
		}
	}
}

function withPattern(first: string, pattern: PatternResult): string {
	if (!pattern.requested) return first;
	const line = pattern.matched !== undefined && pattern.matched.length > 0 ? `Pattern matched: ${pattern.matched}`.trimEnd() : "Pattern did NOT match.";
	return `${first} ${line}`;
}

// Cursor's sleep line: a sleep under a second is "briefly", and anything else is rounded up to whole seconds.
function sleepLine(runtimeMs: number): string {
	return runtimeMs <= 0 ? "Slept briefly." : `Slept for ${Math.max(1, Math.ceil(runtimeMs / 1000))}s.`;
}

// The frontmatter's first block, between its own --- lines.
function frontmatterOf(content: string): string {
	return /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] ?? "";
}

function frontmatterValue(content: string, key: string): string | undefined {
	return new RegExp(`(?:^|\\r?\\n)${key}:\\s*([a-z]+)`).exec(frontmatterOf(content))?.[1];
}

// Cursor's parseRunningForMs: the header's running_for_ms, refreshed every few seconds while the shell runs.
function parseRunningForMs(content: string): number | undefined {
	const match = /(?:^|\r?\n)running_for_ms:\s*(\d+)/.exec(frontmatterOf(content));
	if (!match) return undefined;
	const value = Number(match[1]);
	return Number.isSafeInteger(value) ? value : undefined;
}

function parseStartedAtMs(content: string): number | undefined {
	const match = /(?:^|\r?\n)started_at:\s*(\S+)/.exec(frontmatterOf(content));
	if (!match) return undefined;
	const value = Date.parse(match[1] ?? "");
	return Number.isFinite(value) ? value : undefined;
}

// Cursor's parseShellFooter: a footer ends the file once the shell has exited.
function parseFooter(content: string): { isComplete: boolean; runtimeMs?: number; exitCode?: number } {
	const footer = /\n---\n([\s\S]*?)\n---\s*$/.exec(content)?.[1];
	if (footer === undefined) return { isComplete: false };
	const exitLine = /(?:^|\n)exit_code:\s*([^\n]*)/.exec(footer);
	if (!exitLine) return { isComplete: false };
	const raw = (exitLine[1] ?? "").trim();
	const parsed = Number(raw);
	const exitCode = raw.length > 0 && Number.isInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647 ? parsed : undefined;
	const elapsed = /(?:^|\n)elapsed_ms:\s*(\d+)/.exec(footer);
	return { isComplete: true, runtimeMs: elapsed ? Number(elapsed[1]) : undefined, exitCode };
}

// Cursor's runningShellAgeMs: the clock's age, unless it and the header disagree by more than the refresh interval allows.
function runningAgeMs(nowMs: number, startedAtMs: number | undefined, header: { runningForMs: number; readAtMs: number }): number {
	const headerAgeMs = header.runningForMs + (nowMs - header.readAtMs);
	if (startedAtMs === undefined) return headerAgeMs;
	const clockAgeMs = nowMs - startedAtMs;
	const lagMs = clockAgeMs - headerAgeMs;
	return lagMs >= -SHELL_CLOCK_SKEW_TOLERANCE_MS && lagMs <= SHELL_RUNNING_FOR_MS_REFRESH_MS + SHELL_CLOCK_SKEW_TOLERANCE_MS ? Math.max(clockAgeMs, headerAgeMs) : headerAgeMs;
}

// Cursor's extractShellBodyBetweenMetadataDelimiters: the output, without the header and the footer.
function bodyOf(content: string): string {
	let body = content;
	if (body.startsWith("---\n")) {
		const second = body.indexOf("\n---\n", 4);
		if (second >= 0) body = body.slice(second + 5);
	}
	const footer = /\n---\n[\s\S]*?\n---\s*$/.exec(body);
	if (footer?.index !== undefined) body = body.slice(0, footer.index);
	return body;
}

// Cursor's truncateMiddle: at most 500 characters from each end of a long match.
function truncateMiddle(value: string, sideChars = 500): string {
	return value.length <= sideChars * 2 ? value : `${value.slice(0, sideChars)}...${value.slice(-sideChars)}`;
}
