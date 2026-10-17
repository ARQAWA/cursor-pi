// Runs ripgrep the way Cursor's LocalGrepExecutor.executeRg does: a line budget, an 8 MB capture cap and a 25 s timeout.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// Cursor Desktop's bundled ripgrep, which accepts --cursor-ignore.
export const BUNDLED_RIPGREP = "/Applications/Cursor.app/Contents/Resources/app/node_modules/@vscode/ripgrep/bin/rg";
export const CLIENT_LIMIT_LINES = 2000;
export const HARD_MAX_OUTPUT_LINES = 10_000;
const MAIN_TIMEOUT_MS = 25_000;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

export interface RipgrepBinary {
	command: string;
	// Only the bundled build understands --cursor-ignore; with a stock rg the ignore files are applied after the search.
	cursorIgnore: boolean;
}

let binary: RipgrepBinary | undefined;

export function ripgrepBinary(): RipgrepBinary {
	binary ??= existsSync(BUNDLED_RIPGREP) ? { command: BUNDLED_RIPGREP, cursorIgnore: true } : { command: "rg", cursorIgnore: false };
	return binary;
}

export interface RipgrepRun {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	stdoutByteCapped: boolean;
}

export function runRipgrep(args: string[], cwd: string, lineBudget: number, signal?: AbortSignal): Promise<RipgrepRun> {
	return new Promise((resolveRun, rejectRun) => {
		if (signal?.aborted) {
			rejectRun(new Error("Grep was cancelled"));
			return;
		}
		const proc = spawn(ripgrepBinary().command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		let totalOut = 0;
		let totalErr = 0;
		let seenLines = 0;
		let budgetExceeded = false;
		let byteCapped = false;
		let exited = false;
		const timer = setTimeout(() => {
			if (exited) return;
			const printed = Buffer.concat(out).toString("utf8");
			const complete = printed.slice(0, printed.lastIndexOf("\n") + 1);
			proc.kill();
			if (complete === "") rejectRun(new Error(`Timed out after ${MAIN_TIMEOUT_MS / 1000}s`));
			else resolveRun({ stdout: complete, stderr: "", exitCode: 0, timedOut: true, stdoutByteCapped: byteCapped });
		}, MAIN_TIMEOUT_MS);
		const onAbort = () => {
			clearTimeout(timer);
			proc.kill();
			rejectRun(new Error("Grep was cancelled"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		proc.stdout.on("data", (chunk: Buffer) => {
			if (byteCapped || budgetExceeded) return;
			totalOut += chunk.length;
			if (totalOut > MAX_CAPTURE_BYTES) {
				byteCapped = true;
				proc.kill();
				return;
			}
			let newlines = 0;
			let cut = -1;
			for (let i = 0; i < chunk.length; i++) {
				if (chunk[i] !== 10) continue;
				newlines++;
				if (seenLines + newlines >= lineBudget) {
					cut = i + 1;
					budgetExceeded = true;
					break;
				}
			}
			seenLines += newlines;
			out.push(cut >= 0 ? chunk.subarray(0, cut) : chunk);
			if (budgetExceeded) proc.kill();
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			totalErr += chunk.length;
			if (totalErr <= MAX_CAPTURE_BYTES) err.push(chunk);
		});
		proc.on("error", (error) => {
			exited = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			rejectRun(error);
		});
		proc.on("close", (code) => {
			exited = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			const kept = Buffer.concat(out).toString("utf8");
			const stdout = byteCapped ? kept.slice(0, kept.lastIndexOf("\n") + 1) : kept;
			resolveRun({ stdout, stderr: Buffer.concat(err).toString("utf8"), exitCode: code ?? 0, timedOut: false, stdoutByteCapped: byteCapped });
		});
	});
}
