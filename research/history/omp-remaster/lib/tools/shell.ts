import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Cursor Shell tool. A command runs through `eval` in a shell, and the working directory and
 * environment it leaves carry over to the next call. A command still running after its foreground wait
 * moves to the background and writes a terminal file into the terminals folder.
 */

interface ShellOptions {
	terminalsDir: string;
	startCwd: string;
}

interface RunParams {
	command: string;
	working_directory?: string;
	block_until_ms?: number;
	description?: string;
}

interface Shell {
	run(params: RunParams, signal?: AbortSignal): Promise<string>;
}

type Env = Record<string, string | undefined>;

interface Job {
	id?: number;
	pid?: number;
	startDir: string;
	command: string;
	description?: string;
	startedMs: number;
	startedIso: string;
	output: string;
}

/** Evaluates the command, then saves the working directory and environment and exits with the command's status. */
const SCRIPT = [
	'eval "$REMASTER_COMMAND"',
	"__remaster_ec=$?",
	'pwd > "$REMASTER_STATE_DIR/cwd"',
	'env -0 > "$REMASTER_STATE_DIR/env"',
	"exit $__remaster_ec",
].join("\n");

const DEFAULT_BLOCK_MS = 30000;
const TERMINAL_INTERVAL_MS = 5000;
const DROPPED_ENV = new Set(["REMASTER_COMMAND", "REMASTER_STATE_DIR", "_", "SHLVL"]);

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Creates the terminals folder and returns one more than the highest number of its `<id>.txt` files. */
function nextTerminalId(terminalsDir: string): number {
	mkdirSync(terminalsDir, { recursive: true });
	let highest = 0;
	for (const name of readdirSync(terminalsDir)) {
		const match = /^(\d+)\.txt$/.exec(name);
		if (match) highest = Math.max(highest, Number(match[1]));
	}
	return highest + 1;
}

/** Returns the terminal file header: a `---` block followed by a blank line. */
function terminalHeader(job: Job, status: string, runningMs: number): string {
	const pid = job.pid === undefined ? "" : `pid: ${job.pid}\n`;
	return `---\n${pid}cwd: ${JSON.stringify(job.startDir)}\ncommand: ${JSON.stringify(job.command)}\ntitle: ${JSON.stringify(job.description ?? "")}\nstatus: ${status.padEnd(9)}\nstarted_at: ${job.startedIso}\nrunning_for_ms: ${String(runningMs).padEnd(9)}\n---\n\n`;
}

/** Rewrites a terminal file: header, output so far, and the footer once the command has ended. */
function writeTerminal(path: string, job: Job, status: string, runningMs: number, footer = ""): void {
	const body = job.output === "" || job.output.endsWith("\n") ? job.output : `${job.output}\n`;
	writeFileSync(path, `${terminalHeader(job, status, runningMs)}${body}${footer}`);
}

function backgroundText(id: number, pid: number | undefined, command: string, terminalsDir: string): string {
	const pidLine = pid === undefined ? "" : `PID: ${pid}\n`;
	return `Background command started successfully.\nShell ID: ${id}\n${pidLine}Command: ${command}\nOutput will be written to ${terminalsDir}/${id}.txt. Don't mention Shell ID to the user.`;
}

export function createShell(options: ShellOptions): Shell {
	const { terminalsDir, startCwd } = options;
	let cwd = startCwd;
	let env: Env = { ...process.env };

	const terminalPath = (id: number): string => `${terminalsDir}/${id}.txt`;

	/** Takes the working directory and environment a finished command left. A command that ran `exit` leaves none. */
	const readState = (stateDir: string): void => {
		const cwdFile = join(stateDir, "cwd");
		const envFile = join(stateDir, "env");
		if (!existsSync(cwdFile) || !existsSync(envFile)) return;
		cwd = readFileSync(cwdFile, "utf8").trim();
		const next: Env = {};
		for (const entry of readFileSync(envFile, "utf8").split("\0")) {
			const at = entry.indexOf("=");
			if (at <= 0) continue;
			const key = entry.slice(0, at);
			if (!DROPPED_ENV.has(key)) next[key] = entry.slice(at + 1);
		}
		env = next;
	};

	const foregroundText = (code: number, elapsedMs: number, output: string, givenDir: boolean): string =>
		`Exit code: ${code}\n\nCommand output:\n\n\`\`\`\n${output}\n\`\`\`\n\nCommand completed in ${elapsedMs} ms.\n\nShell state (cwd, env vars) persists for subsequent calls.${givenDir ? ` Current directory: ${cwd}` : ""}`;

	const run = (params: RunParams, signal?: AbortSignal): Promise<string> =>
		new Promise<string>(resolve => {
			const { command } = params;
			const startDir = params.working_directory ?? cwd;
			const blockMs = params.block_until_ms ?? DEFAULT_BLOCK_MS;
			const background = blockMs === 0;
			const givenDir = params.working_directory !== undefined;
			const startedMs = Date.now();
			const job: Job = {
				startDir,
				command,
				description: params.description,
				startedMs,
				startedIso: new Date(startedMs).toISOString(),
				output: "",
			};

			if (!isDirectory(startDir)) {
				const message = `working directory does not exist: ${startDir}; the command did not run`;
				if (!background) {
					resolve(`Error: ${message}`);
					return;
				}
				const id = nextTerminalId(terminalsDir);
				const endedIso = new Date().toISOString();
				writeTerminal(terminalPath(id), job, "failed", 1, `---\nerror: ${JSON.stringify(message)}\nelapsed_ms: 1\nended_at: ${endedIso}\n---\n`);
				resolve(backgroundText(id, undefined, command, terminalsDir));
				return;
			}

			const stateDir = mkdtempSync(join(tmpdir(), "remaster-shell-"));
			const child = spawn(process.env.SHELL || "/bin/sh", ["-c", SCRIPT], {
				cwd: startDir,
				env: { ...env, REMASTER_COMMAND: command, REMASTER_STATE_DIR: stateDir },
				stdio: ["ignore", "pipe", "pipe"],
			});
			job.pid = child.pid;

			let waiting = !background; // the call still waits for the command
			let detached = background; // the command no longer changes the session state
			let done = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let ticker: ReturnType<typeof setInterval> | undefined;

			const collect = (chunk: string): void => {
				job.output += chunk;
			};
			child.stdout.setEncoding("utf8").on("data", collect);
			child.stderr.setEncoding("utf8").on("data", collect);

			const stopWaiting = (): void => {
				waiting = false;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			};

			const startTerminal = (): number => {
				const id = nextTerminalId(terminalsDir);
				job.id = id;
				const path = terminalPath(id);
				const write = (): void => writeTerminal(path, job, "running", Date.now() - startedMs);
				write();
				ticker = setInterval(write, TERMINAL_INTERVAL_MS);
				return id;
			};

			const finish = (code: number): void => {
				if (done) return;
				done = true;
				clearInterval(ticker);
				const endedMs = Date.now();
				const elapsedMs = endedMs - startedMs;
				if (!detached) readState(stateDir);
				if (job.id !== undefined) {
					const footer = `---\nexit_code: ${code}\nelapsed_ms: ${elapsedMs}\nended_at: ${new Date(endedMs).toISOString()}\n---\n`;
					writeTerminal(terminalPath(job.id), job, code === 0 ? "success" : "failed", elapsedMs, footer);
				}
				rmSync(stateDir, { recursive: true, force: true });
				if (waiting) {
					stopWaiting();
					resolve(foregroundText(code, elapsedMs, job.output, givenDir));
				}
			};

			child.on("error", error => {
				job.output += `${error.message}\n`;
				finish(1);
			});
			child.on("close", code => finish(code ?? 1));

			if (background) {
				const id = startTerminal();
				resolve(backgroundText(id, job.pid, command, terminalsDir));
				return;
			}

			timer = setTimeout(() => {
				detached = true;
				stopWaiting();
				const id = startTerminal();
				resolve(`Command is still running after ${blockMs} ms and was moved to the background.\n${backgroundText(id, job.pid, command, terminalsDir)}`);
			}, blockMs);

			const onAbort = (): void => {
				if (!waiting) return;
				detached = true;
				stopWaiting();
				child.kill("SIGTERM");
				resolve(foregroundText(130, Date.now() - startedMs, job.output, givenDir));
			};
			signal?.addEventListener("abort", onAbort, { once: true });
			if (signal?.aborted) onAbort();
		});

	return { run };
}
