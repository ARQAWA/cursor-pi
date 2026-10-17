import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Cursor's resolvePath: strips a file:// prefix, expands a leading ~, and resolves a relative path against the workspace.
export function resolveReadPath(path: string, workspace: string): string {
	const untildified = untildify(stripFileUrl(path));
	return isAbsolute(untildified) ? resolve(untildified) : resolve(workspace, untildified);
}

function stripFileUrl(path: string): string {
	if (!path.startsWith("file://")) return path;
	try {
		return fileURLToPath(path);
	} catch {
		return path;
	}
}

function untildify(path: string): string {
	return path.replace(/^~(?=$|\/|\\)/, homedir());
}

// Cursor's resolveRealPathStrict: the real path of the longest existing ancestor, with the missing tail appended.
// null means an ancestor could not be resolved for a reason other than ENOENT.
export async function resolveRealPath(path: string): Promise<string | null> {
	const normalized = resolve(path);
	let current = normalized;
	for (;;) {
		try {
			return resolve(await realpath(current), relative(current, normalized));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
			const parent = dirname(current);
			if (parent === current) return normalized;
			current = parent;
		}
	}
}

interface IgnoreRule {
	regex: RegExp;
	negated: boolean;
	dirOnly: boolean;
}

// Cursor's ignore service applies .cursorignore to a file read: the real path is tested against every .cursorignore
// in its ancestor folders, except the filesystem root's.
export async function isCursorIgnored(realPath: string): Promise<boolean> {
	let dir = dirname(realPath);
	while (dir !== dirname(dir)) {
		const rules = await readCursorIgnoreRules(dir);
		if (rules.length > 0 && isCursorIgnoredPath(rules, relative(dir, realPath))) return true;
		dir = dirname(dir);
	}
	return false;
}

async function readCursorIgnoreRules(dir: string): Promise<IgnoreRule[]> {
	try {
		return parseIgnoreRules(await readFile(join(dir, ".cursorignore"), "utf8"));
	} catch {
		return [];
	}
}

// gitignore-style rules, as the ignore package reads them: comments and blank lines are skipped, a leading "!"
// negates, a trailing "/" matches folders only, and a pattern with a slash before its end is anchored to its folder.
function parseIgnoreRules(raw: string): IgnoreRule[] {
	const rules: IgnoreRule[] = [];
	for (const rawLine of raw.split("\n")) {
		let line = rawLine.replace(/\r$/, "").trimStart();
		if (line === "" || line.startsWith("#")) continue;
		let negated = false;
		if (line.startsWith("!")) {
			negated = true;
			line = line.slice(1);
		} else if (line.startsWith("\\!") || line.startsWith("\\#")) {
			line = line.slice(1);
		}
		line = line.replace(/(?<!\\) +$/, "");
		let dirOnly = false;
		if (line.endsWith("/")) {
			dirOnly = true;
			line = line.slice(0, -1);
		}
		const anchored = line.includes("/");
		if (line.startsWith("/")) line = line.slice(1);
		if (line === "") continue;
		const body = globSource(line);
		rules.push({ regex: new RegExp(anchored ? `^${body}$` : `^(?:.*/)?${body}$`), negated, dirOnly });
	}
	return rules;
}

// The last matching rule decides. A folder test lets a rule for a folder cover the files inside it.
function isCursorIgnoredPath(rules: IgnoreRule[], relativePath: string): boolean {
	const segments = relativePath.split("/");
	for (let i = 1; i < segments.length; i++) {
		if (isIgnoredBy(rules, segments.slice(0, i).join("/"), true)) return true;
	}
	return isIgnoredBy(rules, relativePath, false) || isIgnoredBy(rules, relativePath, true);
}

function isIgnoredBy(rules: IgnoreRule[], path: string, isFolder: boolean): boolean {
	let ignored = false;
	for (const rule of rules) {
		if (rule.dirOnly && !isFolder) continue;
		if (rule.regex.test(path)) ignored = !rule.negated;
	}
	return ignored;
}

// Converts a glob to a regular expression source for a slash-separated path: "**/" matches any folders, a trailing
// "/**" matches everything below, "*" and "?" stay inside one segment.
function globSource(glob: string): string {
	let source = "";
	for (let i = 0; i < glob.length; i++) {
		const ch = glob[i];
		if (ch === "*" && glob[i + 1] === "*") {
			const atSegmentStart = i === 0 || glob[i - 1] === "/";
			if (atSegmentStart && glob[i + 2] === "/") {
				source += "(?:.*/)?";
				i += 2;
			} else if (atSegmentStart && i + 2 === glob.length) {
				source += ".*";
				i += 1;
			} else {
				source += "[^/]*";
				i += 1;
			}
		} else if (ch === "*") {
			source += "[^/]*";
		} else if (ch === "?") {
			source += "[^/]";
		} else if (ch === "\\" && i + 1 < glob.length) {
			source += escapeRegExp(glob[i + 1]);
			i += 1;
		} else if (ch === "[" && glob.indexOf("]", i + 1) > i + 1) {
			const close = glob.indexOf("]", i + 1);
			source += `[${glob.slice(i + 1, close).replace(/^!/, "^")}]`;
			i = close;
		} else {
			source += escapeRegExp(ch);
		}
	}
	return source;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
