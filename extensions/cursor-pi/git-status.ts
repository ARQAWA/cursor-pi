import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Cursor's GIT_STATUS_CHARACTER_LIMIT.
export const GIT_STATUS_CHARACTER_LIMIT = 10_000;

// The top-level folder of the repository that holds cwd, or undefined outside a git repository.
export async function gitRepoPath(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
		return stdout.trim();
	} catch {
		return undefined;
	}
}

// The working tree status, one line per changed path, the same listing diagnostics use for uncommitted changes.
export async function gitStatus(repoPath: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync("git", ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"], { cwd: repoPath });
		return stdout;
	} catch {
		return undefined;
	}
}

// Cursor's truncateGitStatus: cuts at the last whole line before the limit and says so.
export function truncateGitStatus(status: string): string {
	if (!status) return "";
	if (status.length <= GIT_STATUS_CHARACTER_LIMIT) return status;
	let truncated = status.slice(0, GIT_STATUS_CHARACTER_LIMIT);
	const lastNewline = truncated.lastIndexOf("\n");
	if (lastNewline > 0) truncated = truncated.slice(0, lastNewline);
	return `${truncated}\n\n... (git status truncated)`;
}
