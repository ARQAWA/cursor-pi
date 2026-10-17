import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { registerShellJob } from "./background.ts";
import type { OutputLocation, ShellRenderInput, ShellRunValue } from "./format.ts";
import { agentToolsDirFor, resolveWorkspacePath, terminalsDirFor } from "./paths.ts";
import { ShellOutput, type ShellExit, type ShellRun, type ShellSession } from "./session.ts";

// Cursor's default: a command still running after block_until_ms (30 s when absent) moves to the background.
const DEFAULT_BLOCK_UNTIL_MS = 30000;
const MAX_BLOCK_UNTIL_MS = 2147483647;
// Merged output above this many bytes goes to a file under agent-tools instead of being returned inline.
const FILE_OUTPUT_THRESHOLD_BYTES = 40000;
// A foreground command moved to the background is stopped after 24 hours.
const ADOPTED_HARD_TIMEOUT_MS = 24 * 60 * 60 * 1000;

interface ShellRequest {
	command: string;
	workingDirectory: string | undefined;
	backgroundAfterMs: number;
	description: string | undefined;
	toolCallId?: string;
}

export async function runShell(params: unknown, signal: AbortSignal | undefined, session: ShellSession, toolCallId?: string): Promise<ShellRenderInput> {
	const request = { ...parseRequest(params), toolCallId };
	const terminalsFolder = terminalsDirFor(session.projectDir);
	try {
		return await execute(request, session, signal, terminalsFolder);
	} catch (error) {
		return spawnError(request.command, error instanceof Error ? error.message : String(error), terminalsFolder);
	}
}

function parseRequest(params: unknown): ShellRequest {
	const input = (params ?? {}) as Record<string, unknown>;
	return {
		command: typeof input.command === "string" ? input.command : "",
		workingDirectory: typeof input.working_directory === "string" && input.working_directory !== "" ? input.working_directory : undefined,
		backgroundAfterMs: normalizeWait(input.block_until_ms),
		description: typeof input.description === "string" ? input.description : undefined,
	};
}

// A non-negative number, rounded up and capped. Anything else counts as absent.
function normalizeWait(value: unknown): number {
	if (typeof value !== "number" || Number.isNaN(value) || value < 0) return DEFAULT_BLOCK_UNTIL_MS;
	return Math.min(Math.ceil(value), MAX_BLOCK_UNTIL_MS);
}

async function execute(request: ShellRequest, session: ShellSession, signal: AbortSignal | undefined, terminalsFolder: string): Promise<ShellRenderInput> {
	const startedAt = Date.now();
	if (signal?.aborted) return spawnError(request.command, "Aborted", terminalsFolder);
	await session.ready();
	const cwd = resolveWorkspacePath(request.workingDirectory ?? session.cwd, session.workspacePath);
	const background = request.backgroundAfterMs === 0;
	if (!(await isDirectory(cwd))) {
		if (!background && cwd === resolve(session.cwd)) return missingSessionDirectory(request, session, cwd, terminalsFolder, startedAt);
		return spawnError("", `working directory does not exist: ${cwd}; the command did not run`, terminalsFolder);
	}
	if (background) return startInBackground(request, session, cwd, terminalsFolder, startedAt);
	return runInForeground(request, session, cwd, terminalsFolder, signal, startedAt);
}

// The session's own directory is gone: Cursor runs nothing and reports the reason on stderr with exit code 1.
function missingSessionDirectory(request: ShellRequest, session: ShellSession, cwd: string, terminalsFolder: string, startedAt: number): ShellRenderInput {
	const message = `The shell's working directory no longer exists: ${cwd}. The command did not run. Re-run it with working_directory set to an existing directory.\n`;
	const elapsed = Date.now() - startedAt;
	const value: ShellRunValue = {
		command: request.command,
		workingDirectory: request.workingDirectory === undefined ? undefined : session.cwd,
		exitCode: 1,
		signal: "",
		interleavedOutput: message,
		executionTime: elapsed,
		localExecutionTimeMs: elapsed,
	};
	return { result: { case: "failure", value }, isBackground: false, terminalsFolder };
}

async function startInBackground(request: ShellRequest, session: ShellSession, cwd: string, terminalsFolder: string, startedAt: number): Promise<ShellRenderInput> {
	const run = await session.spawnCommand({ command: request.command, cwd, pipeStdin: false });
	const job = registerShellJob({ run, command: request.command, cwd, description: request.description, terminalsFolder, toolCallId: request.toolCallId });
	const value: ShellRunValue = {
		command: request.command,
		shellId: job.id,
		pid: job.pid,
		executionTime: Date.now() - startedAt,
		backgroundReason: "USER_REQUEST",
	};
	return { result: { case: "success", value }, isBackground: true, terminalsFolder };
}

// Runs until the command exits, the caller aborts, or block_until_ms passes. In the last case the process keeps running
// and its output is handed to the background job registry together with what was collected so far.
async function runInForeground(
	request: ShellRequest,
	session: ShellSession,
	cwd: string,
	terminalsFolder: string,
	signal: AbortSignal | undefined,
	startedAt: number,
): Promise<ShellRenderInput> {
	const run = await session.spawnCommand({ command: request.command, cwd, pipeStdin: true });
	const output = new ShellOutput();
	return new Promise<ShellRenderInput>((resolveResult) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onStdout = (data: string) => output.add("stdout", data);
		const onStderr = (data: string) => output.add("stderr", data);
		const detach = () => {
			settled = true;
			clearTimeout(timer);
			run.off("stdout", onStdout);
			run.off("stderr", onStderr);
			run.off("exit", onExit);
			signal?.removeEventListener("abort", onAbort);
		};
		const onExit = (exit: ShellExit) => {
			if (settled) return;
			detach();
			void finishedRun(request, session, output, exit, terminalsFolder, startedAt).then(resolveResult);
		};
		const onAbort = () => {
			if (settled) return;
			detach();
			run.abort();
			const value: ShellRunValue = {
				command: request.command,
				workingDirectory: request.workingDirectory === undefined ? undefined : session.cwd,
				exitCode: -1,
				signal: "SIGTERM",
				interleavedOutput: output.text,
				executionTime: Date.now() - startedAt,
				aborted: true,
				abortReason: "USER_ABORT",
			};
			resolveResult({ result: { case: "failure", value }, isBackground: false, terminalsFolder });
		};
		timer = setTimeout(() => {
			if (settled) return;
			detach();
			const job = registerShellJob({
				run,
				command: request.command,
				cwd,
				description: request.description,
				terminalsFolder,
				output,
				toolCallId: request.toolCallId,
				hardTimeoutMs: ADOPTED_HARD_TIMEOUT_MS,
			});
			const value: ShellRunValue = {
				command: request.command,
				shellId: job.id,
				pid: job.pid,
				interleavedOutput: output.text,
				executionTime: Date.now() - startedAt,
				msToWait: request.backgroundAfterMs,
				backgroundReason: "TIMEOUT",
			};
			resolveResult({ result: { case: "success", value }, isBackground: false, terminalsFolder });
		}, request.backgroundAfterMs);
		run.on("stdout", onStdout);
		run.on("stderr", onStderr);
		run.on("exit", onExit);
		signal?.addEventListener("abort", onAbort, { once: true });
		if (signal?.aborted) onAbort();
	});
}

async function finishedRun(
	request: ShellRequest,
	session: ShellSession,
	output: ShellOutput,
	exit: ShellExit,
	terminalsFolder: string,
	startedAt: number,
): Promise<ShellRenderInput> {
	const outputLocation = Buffer.byteLength(output.text) > FILE_OUTPUT_THRESHOLD_BYTES ? await writeOutputFile(session.projectDir, output.text) : undefined;
	const value: ShellRunValue = {
		command: request.command,
		workingDirectory: request.workingDirectory === undefined ? undefined : exit.cwd,
		exitCode: exit.code ?? -1,
		signal: exit.signal ?? "",
		interleavedOutput: output.text,
		executionTime: Date.now() - startedAt,
		localExecutionTimeMs: exit.localExecutionTimeMs,
		outputLocation,
	};
	return { result: { case: exit.code === 0 && !exit.aborted ? "success" : "failure", value }, isBackground: false, terminalsFolder };
}

async function writeOutputFile(projectDir: string, text: string): Promise<OutputLocation> {
	const dir = agentToolsDirFor(projectDir);
	await mkdir(dir, { recursive: true });
	const filePath = join(dir, `${randomUUID()}.txt`);
	await writeFile(filePath, text);
	const lineCount = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
	return { filePath, sizeBytes: Buffer.byteLength(text), lineCount };
}

function spawnError(command: string, error: string, terminalsFolder: string): ShellRenderInput {
	return { result: { case: "spawnError", value: { command, error } }, isBackground: false, terminalsFolder };
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
