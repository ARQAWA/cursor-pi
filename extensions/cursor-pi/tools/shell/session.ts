import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { delimiter, dirname } from "node:path";
import type { Stream, Writable } from "node:stream";
import { projectDirFor, ripgrepPath, transcriptsDirFor } from "./paths.ts";
import { OutputSuppressionController, SHELL_OUTPUT_SUPPRESSED_NOTICE } from "./output-suppression.ts";

export interface ShellExit {
	code: number | null;
	signal: NodeJS.Signals | null;
	aborted: boolean;
	localExecutionTimeMs: number;
	cwd: string;
}

// What a command leaves behind: the working directory, the exported environment, the functions and the aliases.
interface ShellState {
	cwd: string;
	env: Record<string, string>;
	functions: Map<string, string>;
	aliases: string;
}

// A process whose stdio stays open this long after it exits, or after abort, has its process group signalled.
const CLOSE_TIMEOUT_MS = 5000;

const ENV_OVERRIDES: Record<string, string> = { TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: "0", _ZO_DOCTOR: "0" };
const DROPPED_ENV = /_proxy|CURSOR_SANDBOX|SUDO_ASKPASS|CURSOR_ASKPASS|CURSOR_CONVERSATION_ID|CURSOR_REQUEST_ID|CURSOR_AGENT_STORE|^ELECTRON_RUN_AS_NODE$/i;

// The state dump (fd 5) holds one section per function, each starting with its name, and then the aliases.
const FUNCTION_MARK = "__CURSOR_PI_FUNCTION__";
const ALIAS_MARK = "__CURSOR_PI_ALIASES__";
const DUMP_FUNCTIONS =
	"builtin zmodload zsh/parameter 2>/dev/null; for __cursor_pi_f in ${(k)functions}; do " +
	`builtin print -r -- "${FUNCTION_MARK} $__cursor_pi_f"; builtin typeset -f -- "$__cursor_pi_f"; done; builtin unset __cursor_pi_f`;

// Writes the working directory and the NUL-separated environment to fd 4, and the functions and aliases to fd 5.
const DUMP_STATE = [
	"{ builtin printf '%s\\0' \"$PWD\"; /usr/bin/env -0; } >&4 2>/dev/null",
	`{ ${DUMP_FUNCTIONS}; builtin print -r -- ${ALIAS_MARK}; builtin alias -L; builtin alias -gL; builtin alias -sL; } >&5 2>/dev/null`,
].join("\n");

// Each command runs in a fresh zsh that replays the saved functions and aliases from fd 3 first. The command itself
// gets fds 3 to 5 closed, then the state is dumped again so the next command starts from the same place.
const COMMAND_SCRIPT = [
	"unsetopt aliases",
	"unalias -m '*' 2>/dev/null",
	'eval "$(/bin/cat <&3)"',
	"setopt aliases",
	'builtin eval "$1" 3<&- 4>&- 5>&-',
	"__cursor_pi_status=$?",
	DUMP_STATE,
	"exit $__cursor_pi_status",
].join("\n");

function zshPath(): string {
	const shell = process.env.SHELL;
	return shell !== undefined && shell.endsWith("/zsh") ? shell : "zsh";
}

function commandEnv(workspacePath: string, snapshot: Record<string, string>): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(process.env)) {
		if (value !== undefined && !DROPPED_ENV.test(name)) env[name] = value;
	}
	Object.assign(env, ENV_OVERRIDES, snapshot, { CURSOR_AGENT: "1", AGENT_TRANSCRIPTS: transcriptsDirFor(projectDirFor(workspacePath)) });
	const rg = ripgrepPath();
	if (rg !== undefined) {
		const rgDir = dirname(rg);
		if (!env.PATH?.startsWith(`${rgDir}${delimiter}`)) env.PATH = `${rgDir}${delimiter}${env.PATH ?? ""}`;
		env.CURSOR_RIPGREP_PATH = rg;
	}
	return env;
}

function parseDump(dump: string): { functions: Map<string, string>; aliases: string } {
	const functions = new Map<string, string>();
	let aliases = "";
	let name: string | undefined;
	let section: "function" | "aliases" | undefined;
	let lines: string[] = [];
	const flush = () => {
		if (section === "function" && name !== undefined) functions.set(name, lines.join("\n"));
		if (section === "aliases") aliases = lines.map((line) => (line.startsWith("alias ") ? `builtin ${line}` : line)).join("\n");
		lines = [];
	};
	for (const line of dump.split("\n")) {
		if (line.startsWith(`${FUNCTION_MARK} `)) {
			flush();
			section = "function";
			name = line.slice(FUNCTION_MARK.length + 1);
		} else if (line === ALIAS_MARK) {
			flush();
			section = "aliases";
		} else {
			lines.push(line);
		}
	}
	flush();
	return { functions, aliases };
}

function parseState(stateText: string, dumpText: string): ShellState {
	const [cwd = "", ...records] = stateText.split("\0");
	const env: Record<string, string> = {};
	for (const record of records) {
		const eq = record.indexOf("=");
		if (eq <= 0) continue;
		const name = record.slice(0, eq);
		if (!DROPPED_ENV.test(name)) env[name] = record.slice(eq + 1);
	}
	return { cwd, env, ...parseDump(dumpText) };
}

const WORD = /[A-Za-z_][\w.:+-]*/g;

function wordsOf(text: string): string[] {
	return text.match(WORD) ?? [];
}

// Replaying every function for every command costs seconds in a login shell with a large function set, so a command
// gets only the functions it can reach: those named in the command or the aliases, and those called by them in turn.
function replayFor(command: string, functions: Map<string, string>, aliases: string): string {
	const selected: string[] = [];
	const seen = new Set<string>();
	const pending = [...wordsOf(command), ...wordsOf(aliases)];
	for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
		const body = functions.get(name);
		if (body === undefined || seen.has(name)) continue;
		seen.add(name);
		selected.push(body);
		pending.push(...wordsOf(body));
	}
	return `${selected.join("\n")}\n${aliases}\n`;
}

function collectChunks(stream: Stream | null | undefined, chunks: Buffer[]): void {
	stream?.on("data", (chunk: Buffer) => chunks.push(chunk));
}

// Cursor's MAX_BUFFER_SIZE: each stream keeps this many bytes. A chunk that would pass it is dropped, with the rest of that stream.
export const STREAM_LIMIT_BYTES = 1048576;

// Observes a run's output as it is kept, for notify_on_output.
export interface OutputObserver {
	observe(data: string): void;
	finish(): void;
}

// The merged stdout and stderr as the model sees it. A newline separates the two streams when one stops mid-line. Each chunk
// goes through the suppression gate first, then the observer, then the per-stream cap, as in Cursor's pipeline.
export class ShellOutput {
	text = "";
	private last: "stdout" | "stderr" | undefined;
	private readonly suppression = new OutputSuppressionController();
	private readonly streamBytes = { stdout: 0, stderr: 0 };
	private readonly streamTrimmed = { stdout: false, stderr: false };
	private observer: OutputObserver | undefined;

	add(stream: "stdout" | "stderr", data: string): void {
		const bytes = Buffer.byteLength(data);
		const gate = this.suppression.record(bytes);
		if (gate.noticeJustTriggered) this.append("stdout", SHELL_OUTPUT_SUPPRESSED_NOTICE);
		if (!gate.shouldForward) return;
		this.observer?.observe(data);
		if (this.streamTrimmed[stream]) return;
		if (this.streamBytes[stream] + bytes > STREAM_LIMIT_BYTES) {
			this.streamTrimmed[stream] = true;
			return;
		}
		this.streamBytes[stream] += bytes;
		this.append(stream, data);
	}

	// Starts observing. The output collected so far is observed first, as Cursor's adopt does.
	observeWith(observer: OutputObserver): void {
		this.observer = observer;
		observer.observe(this.text);
	}

	finishObserving(): void {
		this.observer?.finish();
	}

	private append(stream: "stdout" | "stderr", data: string): void {
		const separator = this.last !== undefined && this.last !== stream && this.text.length > 0 && !this.text.endsWith("\n") ? "\n" : "";
		this.text += separator + data;
		this.last = stream;
	}
}

// One command process. Emits `stdout` and `stderr` chunks while it runs, and `exit` once its stdio has closed.
export class ShellRun extends EventEmitter {
	readonly pid: number | undefined;
	private aborted = false;
	private closed = false;
	private exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
	private killTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly startedAt = Date.now();
	private readonly stateChunks: Buffer[] = [];
	private readonly dumpChunks: Buffer[] = [];

	constructor(
		private readonly child: ChildProcess,
		private readonly fallbackCwd: string,
		private onState: ((state: ShellState) => void) | undefined,
	) {
		super();
		this.pid = child.pid;
		child.on("error", () => {});
		child.stdout?.setEncoding("utf8").on("data", (data: string) => this.emit("stdout", data));
		child.stderr?.setEncoding("utf8").on("data", (data: string) => this.emit("stderr", data));
		collectChunks(child.stdio[4], this.stateChunks);
		collectChunks(child.stdio[5], this.dumpChunks);
		child.once("exit", (code, signal) => this.onProcessExit(code, signal));
		child.once("close", () => this.onClose());
	}

	abort(): void {
		if (this.closed || this.aborted) return;
		this.aborted = true;
		this.signalGroup("SIGTERM");
		this.armKill();
	}

	// Background runs do not change the foreground session's directory, environment, functions or aliases.
	releaseState(): void {
		this.onState = undefined;
	}

	private onProcessExit(code: number | null, signal: NodeJS.Signals | null): void {
		this.exited = { code, signal };
		this.armKill();
	}

	private armKill(): void {
		clearTimeout(this.killTimer);
		this.killTimer = setTimeout(() => this.signalGroup("SIGKILL"), CLOSE_TIMEOUT_MS);
	}

	private signalGroup(signal: NodeJS.Signals): void {
		if (this.pid === undefined) return;
		try {
			process.kill(-this.pid, signal);
		} catch {
			// The group has already exited.
		}
	}

	private onClose(): void {
		this.closed = true;
		clearTimeout(this.killTimer);
		let cwd = this.fallbackCwd;
		const stateText = Buffer.concat(this.stateChunks).toString("utf8");
		if (!this.aborted && stateText.length > 0) {
			const state = parseState(stateText, Buffer.concat(this.dumpChunks).toString("utf8"));
			cwd = state.cwd;
			this.onState?.(state);
		}
		const exit: ShellExit = {
			code: this.exited?.code ?? null,
			signal: this.exited?.signal ?? null,
			aborted: this.aborted,
			localExecutionTimeMs: Date.now() - this.startedAt,
			cwd,
		};
		this.emit("exit", exit);
	}
}

export class ShellSession {
	readonly projectDir: string;
	cwd: string;
	private snapshot: Record<string, string> = {};
	private functions = new Map<string, string>();
	private aliases = "";
	private initialized: Promise<void> | undefined;

	constructor(readonly workspacePath: string) {
		this.cwd = workspacePath;
		this.projectDir = projectDirFor(workspacePath);
	}

	ready(): Promise<void> {
		this.initialized ??= this.start().catch((error: unknown) => {
			this.initialized = undefined;
			throw error;
		});
		return this.initialized;
	}

	async spawnCommand(options: { command: string; cwd: string; pipeStdin: boolean }): Promise<ShellRun> {
		await this.ready();
		const child = spawn(zshPath(), ["-c", COMMAND_SCRIPT, "zsh", options.command], {
			cwd: options.cwd,
			env: commandEnv(this.workspacePath, this.snapshot),
			detached: true,
			stdio: [options.pipeStdin ? "pipe" : "ignore", "pipe", "pipe", "pipe", "pipe", "pipe"],
		});
		await new Promise<void>((resolve, reject) => {
			child.once("spawn", () => resolve());
			child.once("error", reject);
		});
		child.stdio[3]?.resume();
		const replayPipe = child.stdio[3] as Writable | null;
		replayPipe?.on("error", () => {});
		replayPipe?.end(replayFor(options.command, this.functions, this.aliases));
		return new ShellRun(child, this.cwd, (state) => this.adopt(state));
	}

	// Only a command that ran to its state dump changes the session; an aborted command leaves it as it was.
	private adopt(state: ShellState): void {
		this.cwd = state.cwd;
		this.snapshot = state.env;
		for (const [name, body] of state.functions) this.functions.set(name, body);
		this.aliases = state.aliases;
	}

	private async start(): Promise<void> {
		const child = spawn(zshPath(), ["-o", "extendedglob", "-ilc", DUMP_STATE], {
			cwd: this.cwd,
			env: commandEnv(this.workspacePath, {}),
			stdio: ["ignore", "pipe", "pipe", "ignore", "pipe", "pipe"],
		});
		// Nothing else reads the login shell's output, so it is drained here or its stdio never closes.
		child.stdout?.resume();
		child.stderr?.resume();
		const state: Buffer[] = [];
		const dump: Buffer[] = [];
		collectChunks(child.stdio[4], state);
		collectChunks(child.stdio[5], dump);
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", () => resolve());
		});
		const parsed = parseState(Buffer.concat(state).toString("utf8"), Buffer.concat(dump).toString("utf8"));
		if (parsed.cwd === "") throw new Error("the login shell did not report its working directory");
		this.cwd = parsed.cwd;
		this.snapshot = parsed.env;
		this.functions = parsed.functions;
		this.aliases = parsed.aliases;
	}
}

const sessions = new Map<string, ShellSession>();

export function shellSessionFor(workspacePath: string): ShellSession {
	let session = sessions.get(workspacePath);
	if (session === undefined) {
		session = new ShellSession(workspacePath);
		sessions.set(workspacePath, session);
	}
	return session;
}
