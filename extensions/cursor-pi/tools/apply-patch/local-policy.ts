// Cursor's permission decisions for ApplyPatch's reads and writes, reduced to the rules that apply with no team
// settings, no permissions file and no sandbox: the .cursorignore files, the write boundary around the workspace, and
// the hardcoded protected paths. Approvals are returned to the caller, which asks the user.
import { execFile } from "node:child_process";
import { lstat, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import ignore from "ignore";
import type { Ignore } from "ignore";
import { readText } from "./local-encoding.ts";

const execFileAsync = promisify(execFile);
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";
const CURSOR_PROJECTS_ROOT = join(homedir(), ".cursor", "projects");
const CURSOR_WORKTREES_ROOT = join(homedir(), ".cursor", "worktrees");

// Cursor's HARDCODED_WRITE_PROTECTION_PATTERNS, grouped by the type each pattern has in Cursor.
const WORKSPACE_PROTECTION = [
	"**/.cursor/*.json", "**/.cursor/**/*.json", "**/.cursor/.workspace-trusted", "!**/.cursor/rules", "!**/.cursor/rules/**", "!**/.cursor/commands", "!**/.cursor/commands/**", "!**/.cursor/worktrees", "!**/.cursor/worktrees/**", "!**/.cursor/skills", "!**/.cursor/skills/**", "!**/.cursor/agents", "!**/.cursor/agents/**", "**/.claude/*.json", "**/.claude/**/*.json", "**/.vscode/**", "**/.idea/**", "**/.venv/", "**/venv/", "**/*.code-workspace", "**/.cursorignore", "**/.workspace-trusted", "**/.cursor/**/cli.json", "**/.cursor/**/cli-config.json", "**/.cursor/**/mcp.json", "**/.cursor/**/mcp-approvals.json", "**/.cursor/**/permissions.json",
];
const GIT_PROTECTION = ["**/.git/hooks/**", "**/.git/config", "**/.git/config.worktree", "**/.git/info/attributes", "**/.git/commondir", "**/.git/worktrees/*/commondir"];
const ABSOLUTE_PROTECTION = ["/etc/ssl/cert.pem", "/etc/ssl/ca-bundle.pem", "/private/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem"];
const HOME_PROTECTION = [".cursor/sandbox-policies"];

let workspaceIgnore: Ignore | undefined;
let gitIgnore: Ignore | undefined;
const gitContextCache = new Map<string, { isWorktree: boolean; gitDirParent: string }>();

export type Resolution =
	| { status: "resolved" }
	| { status: "newFile" }
	| { status: "danglingSymlink"; symlinkTarget: string | null }
	| { status: "permissionDenied"; errno: string }
	| { status: "symlinkLoop"; errno: string }
	| { status: "unknownError"; errno: string; message: string };

export interface PermissionsPath {
	resolvedPath: string;
	originalPath: string;
	resolution: Resolution;
}

export type ReadBlock = { type: "cursorIgnore" } | { type: "unsafeResolution" };

export type WriteBlock =
	| { type: "needsApproval"; reason: string }
	| { type: "permissionsConfig" }
	| { type: "cursorIgnore" }
	| { type: "unsafeResolution"; message: string };

// Cursor's resolvePath: a leading file:// URL and ~ are expanded, and a relative path is taken from basePath.
export function resolvePath(filePath: string, basePath?: string): string {
	const untildified = untildify(stripFileUrl(filePath));
	if (basePath && !isAbsolute(untildified)) return resolve(basePath, untildified);
	return resolve(untildified);
}

function stripFileUrl(filePath: string): string {
	if (!filePath.startsWith("file://")) return filePath;
	try {
		return new URL(filePath).pathname;
	} catch {
		return filePath;
	}
}

function untildify(filePath: string): string {
	if (filePath === "~") return homedir();
	return filePath.startsWith("~/") ? join(homedir(), filePath.slice(2)) : filePath;
}

function isPathWithin(basePath: string, targetPath: string): boolean {
	const resolvedBase = resolve(basePath);
	const resolvedTarget = resolve(basePath, targetPath);
	if (resolvedBase === parse(resolvedBase).root) {
		return parse(resolvedTarget).root === resolvedBase && (resolvedTarget === resolvedBase || resolvedTarget.length > resolvedBase.length);
	}
	return resolvedTarget === resolvedBase || resolvedTarget.startsWith(resolvedBase + sep);
}

function isMissingPath(error: unknown): boolean {
	const code = (error as { code?: unknown } | undefined)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

function codeOf(error: unknown): unknown {
	return (error as { code?: unknown } | undefined)?.code;
}

function classifyErrno(error: unknown): Resolution {
	const code = codeOf(error);
	switch (code) {
		case "ENOENT":
			return { status: "newFile" };
		case "EACCES":
		case "EPERM":
			return { status: "permissionDenied", errno: String(code) };
		case "ELOOP":
			return { status: "symlinkLoop", errno: String(code) };
		default:
			return { status: "unknownError", errno: code === undefined ? "UNKNOWN" : String(code), message: (error as Error).message };
	}
}

// Cursor's resolvePermissionsPath: the real path of a file, or the place it would have if it does not exist yet.
export async function resolvePermissionsPath(filePath: string): Promise<PermissionsPath> {
	const normalized = resolvePath(filePath);
	try {
		return { resolvedPath: await realpath(normalized), originalPath: normalized, resolution: { status: "resolved" } };
	} catch (realpathError) {
		if (codeOf(realpathError) !== "ENOENT") return unresolved(normalized, classifyErrno(realpathError));
	}
	try {
		const stats = await lstat(normalized);
		if (stats.isSymbolicLink()) {
			const symlinkTarget = await readlink(normalized).catch(() => null);
			return unresolved(normalized, { status: "danglingSymlink", symlinkTarget });
		}
		try {
			return { resolvedPath: await realpath(normalized), originalPath: normalized, resolution: { status: "resolved" } };
		} catch (retryError) {
			if (codeOf(retryError) !== "ENOENT") return unresolved(normalized, classifyErrno(retryError));
		}
		return unresolved(normalized, { status: "unknownError", errno: "ENOENT", message: "realpath returned ENOENT but lstat found a non-symlink entry" });
	} catch (lstatError) {
		if (codeOf(lstatError) === "ENOENT") return resolveNewFilePath(normalized);
		return unresolved(normalized, classifyErrno(lstatError));
	}
}

function unresolved(normalized: string, resolution: Resolution): PermissionsPath {
	return { resolvedPath: normalized, originalPath: normalized, resolution };
}

async function resolveNewFilePath(normalized: string): Promise<PermissionsPath> {
	let current = dirname(normalized);
	const trailingComponents = [basename(normalized)];
	while (dirname(current) !== current) {
		try {
			const resolvedAncestor = await realpath(current);
			return { resolvedPath: join(resolvedAncestor, ...trailingComponents), originalPath: normalized, resolution: { status: "newFile" } };
		} catch (error) {
			if (codeOf(error) !== "ENOENT") return unresolved(normalized, classifyErrno(error));
		}
		trailingComponents.unshift(basename(current));
		current = dirname(current);
	}
	return unresolved(normalized, { status: "newFile" });
}

function isResolutionSafe(resolution: Resolution): boolean {
	return resolution.status === "resolved" || resolution.status === "newFile";
}

function resolutionBlockMessage(path: string, resolution: Resolution): string {
	switch (resolution.status) {
		case "resolved":
		case "newFile":
			return "";
		case "danglingSymlink": {
			const target = resolution.symlinkTarget ? ` (target: ${resolution.symlinkTarget})` : "";
			return `Write blocked: \`${path}\` is a dangling symlink${target}. Cannot verify it does not point to a protected file.`;
		}
		case "permissionDenied":
			return `Write blocked: cannot verify \`${path}\` -- permission denied resolving symlinks (${resolution.errno}).`;
		case "symlinkLoop":
			return `Write blocked: \`${path}\` has a symlink loop (${resolution.errno}). Cannot verify target.`;
		case "unknownError":
			return `Write blocked: cannot verify \`${path}\` -- ${resolution.errno}: ${resolution.message}.`;
	}
}

// Cursor's resolveRealPathStrict: the real path of the nearest existing ancestor, with the rest appended.
async function resolveRealPathStrict(path: string): Promise<string | null> {
	const normalized = resolvePath(path);
	let current = normalized;
	while (true) {
		try {
			const resolvedCurrent = await realpath(current);
			return resolve(resolvedCurrent, relative(current, normalized));
		} catch (error) {
			if (codeOf(error) !== "ENOENT") return null;
			const parent = dirname(current);
			if (parent === current) return normalized;
			current = parent;
		}
	}
}

function isCursorProjectsPath(absolutePath: string): boolean {
	return isDescendant(CURSOR_PROJECTS_ROOT, absolutePath) && absolutePath !== CURSOR_PROJECTS_ROOT;
}

function isCursorWorktreesPath(absolutePath: string): boolean {
	return isDescendant(CURSOR_WORKTREES_ROOT, absolutePath) && absolutePath !== CURSOR_WORKTREES_ROOT;
}

function isDescendant(parent: string, descendant: string): boolean {
	if (parent === descendant) return true;
	return descendant.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

function cursorProjectsInternalDir(absolutePath: string): string | undefined {
	if (!isCursorProjectsPath(absolutePath)) return undefined;
	const parts = relative(CURSOR_PROJECTS_ROOT, absolutePath).split(sep).filter(Boolean);
	return parts.length >= 2 ? parts[1] : undefined;
}

function getCursorWorktreeRoot(absolutePath: string): string | undefined {
	if (!isCursorWorktreesPath(absolutePath)) return undefined;
	const parts = relative(CURSOR_WORKTREES_ROOT, absolutePath).split(sep).filter(Boolean);
	return parts.length === 0 ? undefined : join(CURSOR_WORKTREES_ROOT, parts[0]);
}

function isAllowedTmpPath(realAbsolutePath: string): boolean {
	const platform = process.platform;
	if (platform === "win32") return false;
	const normalizeUnixPath = (value: string): string => {
		const normalized = normalize(value);
		if (platform !== "darwin") return normalized;
		if (normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var" || normalized.startsWith("/var/")) return `/private${normalized}`;
		return normalized;
	};
	const normalizedPath = normalizeUnixPath(realAbsolutePath);
	if (isPathWithin(normalizeUnixPath(homedir()), normalizedPath)) return false;
	const tmpPrefixes = platform === "darwin" ? ["/private/tmp/", "/private/var/folders/"] : ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/", "/var/tmp/"];
	return tmpPrefixes.some((prefix) => normalizedPath.startsWith(prefix));
}

function isDebugLogPath(realAbsolutePath: string): boolean {
	return /(^|\/)\.cursor\/debug(?:-[a-zA-Z0-9-]+)?\.log$/i.test(realAbsolutePath.replace(/\\/g, "/"));
}

function isPathInsideWorkspaceRoot(realAbsolutePath: string, realRootDirectory: string): boolean {
	const target = CASE_INSENSITIVE_FS ? realAbsolutePath.toLowerCase() : realAbsolutePath;
	const root = CASE_INSENSITIVE_FS ? realRootDirectory.toLowerCase() : realRootDirectory;
	if (target === root) return true;
	return target.startsWith(root.endsWith(sep) ? root : root + sep);
}

function normalizeRootDir(rootDir: string): string {
	if (!rootDir.endsWith(sep)) return rootDir;
	const withoutTrailingSep = rootDir.slice(0, -1);
	return withoutTrailingSep === "" ? rootDir : withoutTrailingSep;
}

function isPathUnder(absolutePath: string, rootDir: string): boolean {
	const root = normalizeRootDir(rootDir);
	if (CASE_INSENSITIVE_FS) {
		const lower = absolutePath.toLowerCase();
		const rootLower = root.toLowerCase();
		return lower === rootLower || lower.startsWith(rootLower.endsWith(sep) ? rootLower : rootLower + sep);
	}
	return absolutePath === root || absolutePath.startsWith(root.endsWith(sep) ? root : root + sep);
}

function relativeForwardSlash(rootDir: string, absolutePath: string): string {
	const root = normalizeRootDir(rootDir);
	const rel = CASE_INSENSITIVE_FS ? relative(root.toLowerCase(), absolutePath.toLowerCase()) : relative(root, absolutePath);
	return rel.replace(/\\/g, "/");
}

function getWorkspaceIgnore(): Ignore {
	workspaceIgnore ??= ignore({ ignoreCase: true }).add(WORKSPACE_PROTECTION);
	return workspaceIgnore;
}

function getGitIgnore(): Ignore {
	gitIgnore ??= ignore({ ignoreCase: true }).add(GIT_PROTECTION);
	return gitIgnore;
}

async function resolveGitContext(workspaceDir: string): Promise<{ isWorktree: boolean; gitDirParent: string }> {
	const cached = gitContextCache.get(workspaceDir);
	if (cached) return cached;
	const dotGitStat = await stat(join(workspaceDir, ".git")).catch(() => null);
	const isWorktree = dotGitStat?.isFile() ?? false;
	let result: { isWorktree: boolean; gitDirParent: string };
	if (!isWorktree) {
		result = { isWorktree: false, gitDirParent: workspaceDir };
	} else {
		const commonDir = await execFileAsync("git", ["rev-parse", "--git-common-dir"], { cwd: workspaceDir }).then((output) => output.stdout.trim(), () => null);
		result = { isWorktree: true, gitDirParent: commonDir === null ? workspaceDir : dirname(resolve(workspaceDir, commonDir)) };
	}
	gitContextCache.set(workspaceDir, result);
	return result;
}

async function isHardcodedWriteProtected(absolutePath: string, workspaceDir: string): Promise<boolean> {
	if (isPathUnder(absolutePath, workspaceDir) && getWorkspaceIgnore().ignores(relativeForwardSlash(workspaceDir, absolutePath))) return true;
	const { isWorktree, gitDirParent } = await resolveGitContext(workspaceDir);
	if (isPathUnder(absolutePath, gitDirParent) && getGitIgnore().ignores(relativeForwardSlash(gitDirParent, absolutePath))) return true;
	if (isWorktree && isPathUnder(absolutePath, workspaceDir) && relativeForwardSlash(workspaceDir, absolutePath) === ".git") return true;
	for (const protectedPath of [...ABSOLUTE_PROTECTION, ...HOME_PROTECTION.map((pattern) => join(homedir(), pattern))]) {
		if (isPathUnder(absolutePath, protectedPath)) return true;
	}
	return false;
}

function parseIgnoreRules(raw: string): string[] {
	return raw
		.split("\n")
		.map((line) => line.replace(/\r$/, "").trimStart())
		.filter((line) => line !== "" && !line.startsWith("#"));
}

async function readCursorIgnoreRules(dir: string): Promise<string[]> {
	try {
		return parseIgnoreRules(await readText(join(dir, ".cursorignore")));
	} catch {
		return [];
	}
}

// A path is cursor-ignored when a .cursorignore in one of its ancestor directories matches it. Cursor loads the same
// files for the workspace and for the directories above it.
async function isCursorIgnored(absolutePath: string): Promise<boolean> {
	let dir = dirname(absolutePath);
	while (true) {
		const rules = await readCursorIgnoreRules(dir);
		if (rules.length > 0 && isPathWithin(dir, absolutePath)) {
			const rel = relative(dir, absolutePath);
			if (rel !== "" && ignoresPath(rules, rel)) return true;
		}
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}

function ignoresPath(rules: string[], rel: string): boolean {
	const normalized = rel.replace(/\\/g, "/");
	const instance = ignore().add(rules);
	const direct = instance.test(normalized);
	if (direct.ignored && !direct.unignored) return true;
	const asDirectory = instance.test(`${normalized}/`);
	return asDirectory.ignored && !asDirectory.unignored;
}

// Cursor's shouldBlockFileRead: the read is denied when the path cannot be resolved or when a .cursorignore matches it.
export async function blockForRead(filePath: string): Promise<ReadBlock | undefined> {
	const absolute = resolvePath(filePath);
	if (!isAbsolute(absolute)) return { type: "unsafeResolution" };
	const resolved = await resolveRealPathStrict(absolute);
	if (resolved === null) return { type: "unsafeResolution" };
	const isCursorInternal = isCursorProjectsPath(resolved) || isCursorWorktreesPath(resolved);
	if (!isCursorInternal && (await isCursorIgnored(resolved))) return { type: "cursorIgnore" };
	return undefined;
}

// Cursor's shouldBlockWrite for the resolved target of a write. A write outside the workspace, or to a protected
// config path, needs approval. Everything else in the workspace is allowed.
export async function blockForWrite(filePath: string, workspace: string): Promise<WriteBlock | undefined> {
	const permPath = await resolvePermissionsPath(filePath);
	if (!isResolutionSafe(permPath.resolution)) return { type: "unsafeResolution", message: resolutionBlockMessage(permPath.originalPath, permPath.resolution) };
	const real = permPath.resolvedPath;
	if (basename(permPath.originalPath).toLowerCase() === ".cursorignore" || basename(real).toLowerCase() === ".cursorignore") return { type: "permissionsConfig" };
	const isCursorProjects = isCursorProjectsPath(real);
	const isCursorWorktrees = isCursorWorktreesPath(real);
	if (!isCursorProjects && !isCursorWorktrees && (await isCursorIgnored(real))) return { type: "cursorIgnore" };
	if (isDebugLogPath(real)) return undefined;
	const workspacePerm = await resolvePermissionsPath(workspace);
	const matchedRoot = isResolutionSafe(workspacePerm.resolution) && isPathInsideWorkspaceRoot(real, workspacePerm.resolvedPath) ? workspacePerm.resolvedPath : undefined;
	const worktreeRoot = matchedRoot === undefined ? getCursorWorktreeRoot(real) : undefined;
	if (matchedRoot === undefined && worktreeRoot === undefined) {
		if (isAllowedTmpPath(real)) return undefined;
		if (cursorProjectsInternalDir(real) !== undefined && ["assets", "agent-notes", "agent-tools", "swarm-agents"].includes(cursorProjectsInternalDir(real) as string)) return undefined;
		const userCursorDir = `${homedir()}${sep}.cursor${sep}`;
		if (real.startsWith(userCursorDir)) {
			const name = basename(real).toLowerCase();
			if (name.endsWith(".md") || name.endsWith(".mdc") || name === ".cursorrules") return undefined;
		}
		return { type: "needsApproval", reason: "Out of workspace" };
	}
	const protectionRoot = (matchedRoot ?? worktreeRoot) as string;
	if (await isHardcodedWriteProtected(real, protectionRoot)) return { type: "needsApproval", reason: `Protected config file: ${basename(real).toLowerCase()}` };
	return undefined;
}
