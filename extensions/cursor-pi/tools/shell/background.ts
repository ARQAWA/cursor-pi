import { randomInt } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ShellOutput, type ShellExit, type ShellRun } from "./session.ts";

export type ShellJobStatus = "running" | "succeeded" | "failed" | "aborted";

export interface ShellJobInfo {
	id: number;
	pid: number | undefined;
	command: string;
	cwd: string;
	description: string | undefined;
	status: ShellJobStatus;
	startedAt: number;
	endedAt: number | undefined;
	exitCode: number | null | undefined;
	outputPath: string;
	signal: string | undefined;
	toolCallId: string | undefined;
}

export interface RegisterShellJobOptions {
	run: ShellRun;
	command: string;
	cwd: string;
	description?: string;
	toolCallId?: string;
	terminalsFolder: string;
	// Output a foreground run has already collected; the job keeps appending to the same object.
	output?: ShellOutput;
	// Adopted foreground runs stop after this long; direct background runs have no limit.
	hardTimeoutMs?: number;
}

const HEADER_REFRESH_MS = 5000;
const SHELL_ID_MIN = 1000;
const SHELL_ID_MAX_EXCLUSIVE = 1000000;

const jobs = new Map<number, ShellJob>();
const completionListeners = new Set<(job: ShellJobInfo) => void>();

function yamlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

function nextShellId(): number {
	let id = randomInt(SHELL_ID_MIN, SHELL_ID_MAX_EXCLUSIVE);
	while (jobs.has(id)) id = randomInt(SHELL_ID_MIN, SHELL_ID_MAX_EXCLUSIVE);
	return id;
}

// A background shell and its terminal file: a frontmatter header, the merged output, and a footer once it exits.
class ShellJob {
	readonly done: Promise<ShellJobInfo>;
	status: ShellJobStatus = "running";
	exitCode: number | null | undefined;
	signal: string | undefined;
	endedAt: number | undefined;
	private readonly startedAt = Date.now();
	private readonly output: ShellOutput;
	private chain: Promise<void>;
	private writeQueued = false;
	private refreshTimer: ReturnType<typeof setInterval> | undefined;
	private hardTimer: ReturnType<typeof setTimeout> | undefined;
	private resolveDone!: (info: ShellJobInfo) => void;

	constructor(
		readonly id: number,
		readonly pid: number | undefined,
		readonly command: string,
		readonly cwd: string,
		readonly description: string | undefined,
		readonly toolCallId: string | undefined,
		readonly outputPath: string,
		private readonly run: ShellRun,
		output: ShellOutput,
		hardTimeoutMs: number | undefined,
	) {
		this.output = output;
		this.done = new Promise((resolve) => {
			this.resolveDone = resolve;
		});
		this.chain = mkdir(dirname(outputPath), { recursive: true }).then(() => undefined);
		run.on("stdout", (data: string) => this.append("stdout", data));
		run.on("stderr", (data: string) => this.append("stderr", data));
		run.once("exit", (exit: ShellExit) => this.finish(exit));
		this.refreshTimer = setInterval(() => this.persist(), HEADER_REFRESH_MS);
		if (hardTimeoutMs !== undefined) this.hardTimer = setTimeout(() => run.abort(), hardTimeoutMs);
		this.persist();
	}

	info(): ShellJobInfo {
		return {
			id: this.id,
			pid: this.pid,
			command: this.command,
			cwd: this.cwd,
			description: this.description,
			status: this.status,
			startedAt: this.startedAt,
			endedAt: this.endedAt,
			exitCode: this.exitCode,
			outputPath: this.outputPath,
			signal: this.signal,
			toolCallId: this.toolCallId,
		};
	}

	outputText(): string {
		return this.output.text;
	}

	abort(): void {
		this.run.abort();
	}

	private append(stream: "stdout" | "stderr", data: string): void {
		this.output.add(stream, data);
		this.persist();
	}

	// Writes are queued and coalesced, so a burst of output costs one rewrite of the terminal file.
	private persist(): void {
		if (this.writeQueued) return;
		this.writeQueued = true;
		this.chain = this.chain
			.then(() => {
				this.writeQueued = false;
				return writeFile(this.outputPath, this.render());
			})
			.catch(() => {});
	}

	private finish(exit: ShellExit): void {
		clearInterval(this.refreshTimer);
		clearTimeout(this.hardTimer);
		this.status = exit.aborted ? "aborted" : exit.code === 0 ? "succeeded" : "failed";
		this.exitCode = exit.code;
		this.signal = exit.signal ?? undefined;
		this.endedAt = Date.now();
		this.chain = this.chain.then(() => writeFile(this.outputPath, this.render())).catch(() => {});
		void this.chain.then(() => {
			const info = this.info();
			this.resolveDone(info);
			for (const listener of completionListeners) listener(info);
		});
	}

	private render(): string {
		const now = this.endedAt ?? Date.now();
		return `${this.header(now - this.startedAt)}${this.output.text}${this.footer()}`;
	}

	private header(runningMs: number): string {
		const lines = ["---"];
		if (this.pid) lines.push(`pid: ${this.pid}`);
		lines.push(`cwd: ${yamlString(this.cwd)}`, `command: ${yamlString(this.command)}`);
		const title = this.description?.trim();
		if (title) lines.push(`title: ${yamlString(title)}`);
		lines.push(
			`status: ${this.status.padEnd(9)}`,
			`started_at: ${new Date(this.startedAt).toISOString()}`,
			`running_for_ms: ${String(runningMs).padEnd(9)}`,
			"---",
		);
		return `${lines.join("\n")}\n`;
	}

	private footer(): string {
		if (this.endedAt === undefined) return "";
		const exitCode = this.exitCode === null || this.exitCode === undefined ? "unknown" : String(this.exitCode);
		return `\n---\nexit_code: ${exitCode}\nelapsed_ms: ${this.endedAt - this.startedAt}\nended_at: ${new Date(this.endedAt).toISOString()}\n---\n`;
	}
}

// Starts tracking a process that is running in the background. Returns the Shell ID and the terminal file path.
export function registerShellJob(options: RegisterShellJobOptions): { id: number; pid: number | undefined; outputPath: string } {
	options.run.releaseState();
	const id = nextShellId();
	const outputPath = join(options.terminalsFolder, `${id}.txt`);
	const job = new ShellJob(
		id,
		options.run.pid,
		options.command,
		options.cwd,
		options.description,
		options.toolCallId,
		outputPath,
		options.run,
		options.output ?? new ShellOutput(),
		options.hardTimeoutMs,
	);
	jobs.set(id, job);
	return { id, pid: job.pid, outputPath };
}

export function listShellJobs(): ShellJobInfo[] {
	return [...jobs.values()].map((job) => job.info());
}

// The output collected so far, in the same merged form the terminal file uses.
export function readShellOutput(id: number): string | undefined {
	return jobs.get(id)?.outputText();
}

export async function waitForShellJob(id: number): Promise<ShellJobInfo | undefined> {
	return jobs.get(id)?.done;
}

export function onShellJobCompletion(listener: (job: ShellJobInfo) => void): () => void {
	completionListeners.add(listener);
	return () => {
		completionListeners.delete(listener);
	};
}

export function abortShellJob(id: number): boolean {
	const job = jobs.get(id);
	if (job === undefined || job.status !== "running") return false;
	job.abort();
	return true;
}
