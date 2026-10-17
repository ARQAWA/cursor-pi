// .cursorignore handling as Cursor's LocalIgnoreService applies it: gitignore-style patterns from every .cursorignore
// in the folder chain, where a folder pattern also covers the files below it.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { runRipgrep, HARD_MAX_OUTPUT_LINES } from "./binary.ts";

// Cursor's ripwalk excludes for the ignore-file scan (node_modules, build output and similar folders).
const DEFAULT_GLOB_IGNORE_DIRS = [
	"**/node_modules/**", "**/.git/**", "**/.turbo/**", "**/.next/**", "**/.cache/**", "**/.pnpm/**", "**/.yarn/**",
	"**/dist/**", "**/build/**", "**/out/**", "**/target/**", "**/.vscode/**", "**/.idea/**", "**/venv/**",
	"**/__pycache__/**", "**/logs/**", "**/tmp/**", "**/temp/**",
];
const PROTECTED_HOME_FOLDERS = ["Desktop", "Documents", "Downloads", "Music", "Movies", "Pictures", "Library", ".Trash"];

interface IgnoreRule {
	regex: RegExp;
	negated: boolean;
	dirOnly: boolean;
}

interface IgnoreFile {
	patternCount: number;
	rules: IgnoreRule[];
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Converts a glob to a regex source over slash-separated paths.
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
			i += 1;
			source += escapeRegExp(glob[i]);
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

function compileRule(line: string): IgnoreRule | undefined {
	let text = line;
	let negated = false;
	if (text.startsWith("!")) {
		negated = true;
		text = text.slice(1);
	} else if (text.startsWith("\\!") || text.startsWith("\\#")) {
		text = text.slice(1);
	}
	text = text.replace(/(?<!\\) +$/, "");
	let dirOnly = false;
	if (text.endsWith("/")) {
		dirOnly = true;
		text = text.slice(0, -1);
	}
	const anchored = text.includes("/");
	if (text.startsWith("/")) text = text.slice(1);
	if (text === "") return undefined;
	const body = globSource(text);
	return { regex: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`), negated, dirOnly };
}

function parseIgnoreFile(raw: string): IgnoreFile {
	const patterns = raw
		.split("\n")
		.map((line) => line.replace(/\r$/, "").trimStart())
		.filter((line) => line !== "" && !line.startsWith("#"));
	const rules = patterns.flatMap((pattern) => {
		const rule = compileRule(pattern);
		return rule === undefined ? [] : [rule];
	});
	return { patternCount: patterns.length, rules };
}

async function readIgnoreFile(dir: string): Promise<IgnoreFile> {
	try {
		return parseIgnoreFile(await readFile(join(dir, ".cursorignore"), "utf8"));
	} catch {
		return { patternCount: 0, rules: [] };
	}
}

// The last matching rule decides; a file-level match also tests the path as a folder, as Cursor's testIgnored does.
function lastMatch(rules: IgnoreRule[], path: string, isDir: boolean): "ignored" | "unignored" | undefined {
	let result: "ignored" | "unignored" | undefined;
	for (const rule of rules) {
		if (rule.dirOnly && !isDir) continue;
		if (rule.regex.test(path)) result = rule.negated ? "unignored" : "ignored";
	}
	return result;
}

function ignoredByRules(rules: IgnoreRule[], relativePath: string): boolean {
	const segments = relativePath.split("/");
	for (let i = 1; i < segments.length; i++) {
		if (lastMatch(rules, segments.slice(0, i).join("/"), true) === "ignored") return true;
	}
	return lastMatch(rules, relativePath, false) === "ignored" || lastMatch(rules, relativePath, true) === "ignored";
}

// Per-search view of the .cursorignore files that apply to a path.
export class CursorIgnoreIndex {
	private readonly files = new Map<string, Promise<IgnoreFile>>();

	private fileIn(dir: string): Promise<IgnoreFile> {
		let file = this.files.get(dir);
		if (file === undefined) {
			file = readIgnoreFile(dir);
			this.files.set(dir, file);
		}
		return file;
	}

	// True when a real absolute path is filtered by a .cursorignore in its own folder or in any folder above it.
	async isIgnored(realPath: string): Promise<boolean> {
		let dir = dirname(realPath);
		while (dir !== dirname(dir)) {
			const file = await this.fileIn(dir);
			const relativePath = relative(dir, realPath);
			if (file.patternCount > 0 && relativePath !== "" && ignoredByRules(file.rules, relativePath.split(sep).join("/"))) return true;
			dir = dirname(dir);
		}
		return false;
	}
}

function protectedExcludeGlobs(root: string): string[] {
	if (process.platform !== "darwin") return [];
	const lowerRoot = root.toLowerCase();
	const prefix = lowerRoot.endsWith("/") ? lowerRoot : `${lowerRoot}/`;
	const folders = [...PROTECTED_HOME_FOLDERS.map((folder) => `${homedir()}/${folder}`), "/Volumes"];
	return folders
		.filter((folder) => folder.toLowerCase().startsWith(prefix))
		.map((folder) => `/${posix.relative(root, folder)}`);
}

// The .cursorignore files below root that hold at least one pattern; Cursor passes these to the bundled rg.
export async function cursorIgnoreFilesUnder(realRoot: string, signal?: AbortSignal): Promise<string[]> {
	const args = ["--files", "--hidden", "--no-require-git", "--no-config", "--color=never", "--iglob", "**/.gitignore", "--iglob", "**/.cursorignore"];
	for (const glob of [...DEFAULT_GLOB_IGNORE_DIRS, ...protectedExcludeGlobs(realRoot)]) args.push("--iglob", `!${glob}`);
	const run = await runRipgrep(args, realRoot, HARD_MAX_OUTPUT_LINES, signal);
	const found = run.stdout.split("\n").filter((line) => line !== "" && basename(line) === ".cursorignore");
	const files: string[] = [];
	for (const line of found) {
		const file = join(realRoot, line);
		const parsed = parseIgnoreFile(await readFile(file, "utf8").catch(() => ""));
		if (parsed.patternCount > 0) files.push(file);
	}
	return files;
}
