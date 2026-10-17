// Port of Cursor's LocalGrepExecutor for one workspace: argument building, the ripgrep run, output parsing,
// .cursorignore filtering, mtime ordering for outside paths, and the path and worktree errors.
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { CLIENT_LIMIT_LINES, HARD_MAX_OUTPUT_LINES, ripgrepBinary, runRipgrep, type RipgrepRun } from "./binary.ts";
import { CursorIgnoreIndex, cursorIgnoreFilesUnder } from "./cursor-ignore.ts";
import { isInsideWorkspaceRoot, isPathWithin, resolvePath, resolveRealPathStrict } from "./paths.ts";
import type { ContentMatch, FileMatch, OutputMode, SearchSuccess, SearchUnion } from "./format.ts";

export interface SearchRequest {
	pattern: string;
	path?: string;
	glob?: string;
	type?: string;
	outputMode: OutputMode;
	caseInsensitive: boolean;
	multiline: boolean;
	contextBefore?: number;
	contextAfter?: number;
	context?: number;
}

const WORKTREE_GUARD_ERROR = "You cannot search other worktrees for this repository, stay within your workspace paths.";
const MAX_INT32 = 2_147_483_647;
const MIN_INT32 = -2_147_483_648;
const SORT_STAT_TIMEOUT_MS = 2000;

function clampInt32(value: number): number {
	if (Number.isNaN(value)) return 0;
	return Math.min(Math.max(value, MIN_INT32), MAX_INT32);
}

// Cursor's describeRegexParseError: names the pattern and the escape hint for unbalanced brackets.
export function classifyRipgrepMessage(message: string, pattern?: string): string {
	if (!message.toLowerCase().includes("regex parse error") || pattern === undefined) return message;
	const reason = /^error: (.+)$/m.exec(message)?.[1];
	if (reason === undefined) return message;
	const described = `rg: regex parse error: invalid regex "${pattern}": ${reason}.`;
	if (!/unclosed|unopened|repetition operator missing expression/.test(reason)) return described;
	return `${described} Escape special characters such as ( [ { with a backslash to match them literally.`;
}

// Cursor's shouldBlockWorktreePath with no main-worktree guard from the IDE: a worktree agent may not search its repo root.
function isBlockedWorktreeTarget(cwd: string, rawPath: string | undefined): boolean {
	if (rawPath === undefined) return false;
	const normalizedCwd = cwd.replace(/\\/g, "/");
	if (!normalizedCwd.includes(".cursor/worktrees")) return false;
	if (isPathWithin(cwd, rawPath)) return false;
	const marker = "/.cursor/worktrees/";
	const markerIndex = normalizedCwd.indexOf(marker);
	if (markerIndex === -1) return false;
	const repoName = normalizedCwd.slice(markerIndex + marker.length).split("/")[0] ?? "";
	if (repoName === "") return false;
	const repoRoot = normalizedCwd.slice(0, markerIndex + marker.length + repoName.length);
	const target = resolvePath(rawPath, cwd);
	return isPathWithin(repoRoot, target);
}

// Cursor's search target: "." for the workspace root, a relative path inside it, or the absolute path outside.
function searchTargetFor(rawPath: string | undefined, cwd: string): string {
	if (!rawPath) return ".";
	const target = resolvePath(rawPath, cwd);
	if (!isInsideWorkspaceRoot(target, resolve(cwd))) return target;
	return relative(cwd, target) || ".";
}

function isRootIndependentSearchPath(path: string): boolean {
	return isAbsolute(path) || /^~(?=$|[/\\])/.test(path) || path.startsWith("file://");
}

function hasOnlyUnreadableEntriesBelowTarget(stderr: string, target: string): boolean {
	return stderr
		.trim()
		.split(/\r?\n/)
		.every((line) => {
			const match = /^rg: (.+): .*\(os error (?:13|5|1)\)$/.exec(line);
			return match !== null && match[1] !== target;
		});
}

// Keeps the items whose path is not filtered by .cursorignore (or cannot be resolved), in order.
async function keepUnblocked<T>(items: T[], pathOf: (item: T) => string, isBlocked: (file: string) => Promise<boolean>): Promise<T[]> {
	const blocked = await Promise.all(items.map((item) => isBlocked(pathOf(item))));
	return items.filter((_, index) => !blocked[index]);
}

// Cursor's sortNewestFirst: newest mtime first, ties by path; keeps the input order when the stats take too long.
async function sortNewestFirst<T>(items: T[], pathOf: (item: T) => string): Promise<T[]> {
	const keyed = Promise.all(
		items.map(async (item) => {
			const path = pathOf(item);
			const mtimeMs = await stat(path).then((s) => s.mtimeMs, () => 0);
			return { item, path, mtimeMs };
		}),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error("stat timed out")), SORT_STAT_TIMEOUT_MS);
	});
	try {
		const entries = await Promise.race([keyed, timedOut]);
		entries.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		return entries.map((entry) => entry.item);
	} catch {
		return items;
	} finally {
		clearTimeout(timer);
	}
}

// Cursor's parseRipgrepContentOutput: NUL after the path, then line number and ":" for matches or "-" for context.
interface ContentParse {
	byFile: Map<string, FileMatch>;
	totalLines: number;
	totalMatchedLines: number;
	clientTruncated: boolean;
	ripgrepTruncated: boolean;
}

function* recordBounds(text: string): Generator<[number, number]> {
	let start = 0;
	while (start < text.length) {
		const newline = text.indexOf("\n", start);
		const next = newline === -1 ? text.length : newline + 1;
		let end = newline === -1 ? text.length : newline;
		if (newline !== -1 && newline > start && text.charCodeAt(newline - 1) === 13) end = newline - 1;
		yield [start, end];
		start = next;
	}
}

function parseContent(stdout: string, clientLimit: number, hardCutoff: number): ContentParse {
	const byFile = new Map<string, FileMatch>();
	if (stdout.trim() === "") return { byFile, totalLines: 0, totalMatchedLines: 0, clientTruncated: false, ripgrepTruncated: false };
	let totalLines = 0;
	let totalMatchedLines = 0;
	let linesProcessed = 0;
	for (const [lineStart, lineEnd] of recordBounds(stdout)) {
		totalLines++;
		if (lineEnd - lineStart === 2 && stdout.startsWith("--", lineStart)) continue;
		const nul = stdout.indexOf("\0", lineStart);
		if (nul === -1 || nul >= lineEnd) continue;
		let p = nul + 1;
		if (p >= lineEnd) continue;
		let lineNumber = 0;
		let digits = 0;
		while (p < lineEnd) {
			const c = stdout.charCodeAt(p);
			if (c < 48 || c > 57) break;
			lineNumber = lineNumber * 10 + (c - 48);
			digits++;
			p++;
		}
		if (digits === 0 || p >= lineEnd || !Number.isFinite(lineNumber)) continue;
		const separator = stdout.charCodeAt(p);
		if (separator !== 58 && separator !== 45) continue;
		const isContextLine = separator === 45;
		if (!isContextLine) totalMatchedLines++;
		const file = stdout.slice(lineStart, nul);
		if (linesProcessed >= clientLimit) continue;
		let fileMatch = byFile.get(file);
		if (fileMatch === undefined) {
			fileMatch = { file, matches: [] };
			byFile.set(file, fileMatch);
		}
		const match: ContentMatch = { lineNumber, content: stdout.slice(p + 1, lineEnd), isContextLine };
		fileMatch.matches.push(match);
		linesProcessed++;
	}
	return {
		byFile,
		totalLines: clampInt32(totalLines),
		totalMatchedLines: clampInt32(totalMatchedLines),
		clientTruncated: linesProcessed >= clientLimit,
		ripgrepTruncated: totalLines >= hardCutoff,
	};
}

// Cursor's parseRipgrepCountOutput: "path:count" lines, the path being everything before the last colon.
function parseCount(stdout: string, clientLimit: number, hardCutoff: number) {
	const trimmed = stdout.trim();
	if (trimmed === "") return { counts: [] as { file: string; count: number }[], totalFiles: 0, totalMatches: 0, clientTruncated: false, ripgrepTruncated: false };
	const all: { file: string; count: number }[] = [];
	for (const [lineStart, lineEnd] of recordBounds(trimmed)) {
		if (lineEnd === lineStart) continue;
		const colon = trimmed.lastIndexOf(":", lineEnd - 1);
		if (colon < lineStart || colon === lineStart) continue;
		const count = parseInt(trimmed.slice(colon + 1, lineEnd).trim(), 10);
		if (!Number.isFinite(count)) continue;
		all.push({ file: trimmed.slice(lineStart, colon), count });
	}
	const totalFiles = all.length;
	const totalMatches = all.reduce((sum, entry) => sum + entry.count, 0);
	return {
		counts: all.slice(0, Math.min(totalFiles, clientLimit)),
		totalFiles: clampInt32(totalFiles),
		totalMatches: clampInt32(totalMatches),
		clientTruncated: totalFiles > clientLimit,
		ripgrepTruncated: totalFiles >= hardCutoff,
	};
}

// Cursor's parseRipgrepFilesOutput: one path per line, counting every line and keeping the first clientLimit.
function parseFiles(stdout: string, clientLimit: number, hardCutoff: number) {
	const trimmed = stdout.trim();
	if (trimmed === "") return { files: [] as string[], totalFiles: 0, clientTruncated: false, ripgrepTruncated: false };
	const files: string[] = [];
	let totalFiles = 0;
	for (const [lineStart, lineEnd] of recordBounds(trimmed)) {
		if (totalFiles < clientLimit) files.push(trimmed.slice(lineStart, lineEnd));
		totalFiles++;
	}
	return { files, totalFiles: clampInt32(totalFiles), clientTruncated: totalFiles > clientLimit, ripgrepTruncated: totalFiles >= hardCutoff };
}

function sumBy<T>(items: T[], value: (item: T) => number): number {
	return items.reduce((sum, item) => sum + value(item), 0);
}

export async function searchWorkspace(request: SearchRequest, cwd: string, signal?: AbortSignal): Promise<SearchSuccess> {
	if (isBlockedWorktreeTarget(cwd, request.path)) throw new Error(WORKTREE_GUARD_ERROR);
	const index = new CursorIgnoreIndex();
	const rawPath = request.path === "" ? undefined : request.path;
	const rgTarget = searchTargetFor(rawPath, cwd);
	let outsideTarget: string | undefined;
	try {
		if (rawPath !== undefined) {
			const target = resolvePath(rawPath, cwd);
			const inside = isInsideWorkspaceRoot(target, resolve(cwd));
			const real = await resolveRealPathStrict(target);
			if (real === null) throw new Error(`Path '${rawPath}' could not be verified while resolving symlinks. This can happen when access is denied or the path contains a symlink loop.`);
			if (await index.isIgnored(real)) throw new Error(`Path '${rawPath}' is filtered out by .cursorignore`);
			if (!inside) outsideTarget = target;
		}
		if (!existsSync(cwd)) throw new Error(`Path does not exist: ${cwd}`);
		const listFiles = request.outputMode === "files_with_matches" && request.pattern === "" && Boolean(request.glob);
		const sortAfter = isAbsolute(rgTarget);
		const binary = ripgrepBinary();
		const args: string[] = [];
		if (binary.cursorIgnore) {
			const realRoot = (await resolveRealPathStrict(cwd)) ?? resolve(cwd);
			for (const file of await cursorIgnoreFilesUnder(realRoot, signal)) args.push("--cursor-ignore", file);
		}
		const hasContext = request.context !== undefined || request.contextBefore !== undefined || request.contextAfter !== undefined;
		const lineBudget = request.outputMode === "content" ? CLIENT_LIMIT_LINES * (hasContext ? 2 : 1) : HARD_MAX_OUTPUT_LINES;
		if (request.outputMode === "content") {
			args.push("--line-number", "--with-filename", "--no-heading", "-0");
			if (request.contextBefore !== undefined) args.push("--before-context", String(request.contextBefore));
			if (request.contextAfter !== undefined) args.push("--after-context", String(request.contextAfter));
			args.push("--max-columns", "1000", "--max-columns-preview");
			if (request.context !== undefined && request.contextBefore === undefined && request.contextAfter === undefined) {
				args.push("--before-context", String(request.context), "--after-context", String(request.context));
			}
		} else if (request.outputMode === "files_with_matches") {
			args.push(listFiles ? "--files" : "-l");
		} else {
			args.push("-c", "--with-filename");
		}
		args.push(request.caseInsensitive ? "--ignore-case" : "--case-sensitive");
		if (request.type) args.push("--type", request.type);
		if (request.glob) {
			args.push("--iglob", request.glob);
			if (listFiles) args.push("--iglob", "!**/.git");
		}
		if (request.multiline) args.push("--multiline", "--multiline-dotall");
		if (sortAfter) args.push("--line-buffered");
		else args.push("--sortr", "modified");
		args.push("--no-config", "--color=never", "--hidden", "--follow");
		if (!listFiles) args.push("--regexp", request.pattern);
		args.push("--", rgTarget);

		const run: RipgrepRun = await runRipgrep(args, cwd, lineBudget, signal);
		if ((run.stderr !== "" || run.exitCode === 2) && run.stdout.trim() === "" && !hasOnlyUnreadableEntriesBelowTarget(run.stderr, rgTarget)) {
			throw new Error(run.stderr || `ripgrep exited with code ${run.exitCode}`);
		}
		// ripgrep prints "./" for the "." target; the captured Cursor results show the paths without it.
		const unprefix = (file: string): string => (rgTarget === "." && file.startsWith("./") ? file.slice(2) : file);
		const isBlocked = async (file: string): Promise<boolean> => {
			const real = await resolveRealPathStrict(resolvePath(file, cwd));
			return real === null || (await index.isIgnored(real));
		};
		const ordered = async <T>(items: T[], pathOf: (item: T) => string): Promise<T[]> =>
			sortAfter ? sortNewestFirst(items, pathOf) : items;
		const rgTruncated = run.timedOut || run.stdoutByteCapped;

		let union: SearchUnion;
		if (request.outputMode === "content") {
			const parsed = parseContent(run.stdout, CLIENT_LIMIT_LINES, lineBudget);
			const entries = [...parsed.byFile.values()].map((entry) => ({ file: unprefix(entry.file), matches: entry.matches }));
			const kept = await keepUnblocked(entries, (entry) => entry.file, isBlocked);
			const keptSet = new Set(kept);
			const blocked = entries.filter((entry) => !keptSet.has(entry));
			const blockedLines = sumBy(blocked, (entry) => entry.matches.length);
			const blockedMatched = sumBy(blocked, (entry) => entry.matches.filter((m) => !m.isContextLine).length);
			union = {
				mode: "content",
				value: {
					matches: await ordered(kept, (entry) => resolvePath(entry.file, cwd)),
					totalLines: clampInt32(parsed.totalLines - blockedLines),
					totalMatchedLines: clampInt32(parsed.totalMatchedLines - blockedMatched),
					clientTruncated: parsed.clientTruncated,
					ripgrepTruncated: parsed.ripgrepTruncated || rgTruncated,
				},
			};
		} else if (request.outputMode === "files_with_matches") {
			const parsed = parseFiles(run.stdout, CLIENT_LIMIT_LINES, HARD_MAX_OUTPUT_LINES);
			const kept = await keepUnblocked(parsed.files.map(unprefix), (file) => file, isBlocked);
			const files = await ordered(kept, (file) => resolvePath(file, cwd));
			union = {
				mode: "files_with_matches",
				value: {
					files,
					totalFiles: clampInt32(parsed.totalFiles - (parsed.files.length - kept.length)),
					clientTruncated: parsed.clientTruncated,
					ripgrepTruncated: parsed.ripgrepTruncated || rgTruncated,
				},
			};
		} else {
			const parsed = parseCount(run.stdout, CLIENT_LIMIT_LINES, HARD_MAX_OUTPUT_LINES);
			parsed.counts = parsed.counts.map((entry) => ({ file: unprefix(entry.file), count: entry.count }));
			const kept = await keepUnblocked(parsed.counts, (entry) => entry.file, isBlocked);
			const counts = await ordered(kept, (entry) => resolvePath(entry.file, cwd));
			const keptMatches = sumBy(counts, (entry) => entry.count);
			const blockedMatches = sumBy(parsed.counts, (entry) => entry.count) - keptMatches;
			union = {
				mode: "count",
				value: {
					counts,
					totalFiles: clampInt32(parsed.totalFiles - (parsed.counts.length - counts.length)),
					totalMatches: clampInt32(parsed.totalMatches - blockedMatches),
					clientTruncated: parsed.clientTruncated,
					ripgrepTruncated: parsed.ripgrepTruncated || rgTruncated,
				},
			};
		}
		const displayPath = outsideTarget ?? (rawPath !== undefined && isRootIndependentSearchPath(rawPath) ? resolvePath(rawPath) : rawPath);
		return { pattern: request.pattern, path: displayPath, root: cwd, union };
	} catch (error) {
		if (rawPath !== undefined) {
			const resolved = resolvePath(rawPath, cwd);
			try {
				await stat(resolved);
			} catch {
				throw new Error(`Path does not exist: ${resolved}`);
			}
		}
		throw error;
	}
}
