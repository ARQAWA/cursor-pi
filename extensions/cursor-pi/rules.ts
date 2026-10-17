// Cursor Pi rules: finds the rule files that Cursor Desktop 3.25.6 loads for a workspace and renders the
// `<rules>` section of the prompt. Both steps are reimplemented from Cursor's code; nothing is copied from it.
import { execFile, spawn } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { availableParallelism, homedir } from "node:os";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAX_RULE_DESCRIPTION_LENGTH = 1536;
const MAX_RULE_MARKDOWN_FILE_BYTES = 100 * 1024;
const FORMAT_HEADER_BYTES = 8192;
const MARKDOWN_RULE_FILE_NAMES = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];
const RULES_DIR_PATTERN = /[/\\]\.cursor[/\\]rules[/\\]/i;
const NESTED_INCLUDE_GLOBS = [
	"*/**/.cursor/**",
	"*/**/.agents/**",
	"*/**/AGENTS.md",
	"*/**/.claude/**",
	"*/**/.codex/**",
	"*/**/.grok/**",
	"*/**/CLAUDE.md",
	"*/**/CLAUDE.local.md",
];
const DEFAULT_GLOB_IGNORE_DIRS = [
	"**/node_modules/**",
	"**/.git/**",
	"**/.turbo/**",
	"**/.next/**",
	"**/.cache/**",
	"**/.pnpm/**",
	"**/.yarn/**",
	"**/dist/**",
	"**/build/**",
	"**/out/**",
	"**/target/**",
	"**/.vscode/**",
	"**/.idea/**",
	"**/venv/**",
	"**/__pycache__/**",
	"**/logs/**",
	"**/tmp/**",
	"**/temp/**",
];
const SKILL_GLOB_PATTERNS = [
	"**/.cursor/skills/**",
	"**/.cursor/skills-cursor/**",
	"**/.claude/skills/**",
	"**/.codex/skills/**",
	"**/.grok/skills/**",
	"**/.claude/plugins/**",
	"**/.agents/skills/**",
	"**/SKILL.md",
	"**/.cursor/plugins/cache/**/skills/**",
];
const PROTECTED_HOME_FOLDERS = ["Desktop", "Documents", "Downloads", "Music", "Movies", "Pictures", "Library", ".Trash"];
const PROTECTED_VOLUMES_FOLDER = "/Volumes";

const RULES_INTRO =
	"The rules section has a number of possible rules/memories/context that you should consider. In each subsection, we provide instructions about what information the subsection contains and how you should consider/follow the contents of the subsection.";
const ALWAYS_APPLIED_DESCRIPTION = "These are workspace-level rules that the agent must always follow.";
const AGENT_REQUESTABLE_DESCRIPTION =
	"These are workspace-level rules that the agent should follow. Use the ReadFile tool to fetch full contents from the provided absolute path. Read each rule file using the ReadFile tool when it is relevant to your work.";

const SKILL_PATH_REGEXPS = SKILL_GLOB_PATTERNS.map((pattern) => new RegExp(`^${globSource(pattern)}$`));
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const LATIN1_DECODER = new TextDecoder("latin1");

type Frontmatter = Record<string, string | boolean | string[]>;

export type CursorRule =
	| { fullPath: string; content: string; kind: "global" }
	| { fullPath: string; content: string; kind: "fileGlobbed"; globs: string[] }
	| { fullPath: string; content: string; kind: "agentFetched"; description: string }
	| { fullPath: string; content: string; kind: "manuallyAttached" };

// A rule file as read from disk, before its frontmatter is typed.
interface RuleFile {
	path: string;
	body: string;
	frontmatter: Frontmatter;
}

interface IgnoreRule {
	regex: RegExp;
	negated: boolean;
	dirOnly: boolean;
}

// Rules for a workspace in Cursor's order: the legacy .cursorrules, the cwd and its ancestors, then nested folders.
export async function discoverCursorRules(cwd: string): Promise<CursorRule[]> {
	const root = resolve(cwd);
	const gitRoot = await findGitRoot(root);
	const [cursorRulesFile, ancestorRules, nested] = await Promise.all([
		loadCursorRulesFile(gitRoot || root),
		loadRulesFromAncestors(root),
		discoverNested(root, gitRoot),
	]);
	const nestedRules = await Promise.all(nested.rules.map((path) => readMdcRuleFile(path)));
	const nestedMarkdown = await Promise.all(
		nested.markdown.map((path) => loadMarkdownRuleFile(dirname(path), basename(path))),
	);
	const files = [
		...(cursorRulesFile ? [cursorRulesFile] : []),
		...ancestorRules,
		...nestedRules.filter(isDefined),
		...nestedMarkdown.flat(),
	];
	// One entry per path: the first position with the last value, as a Map keeps it.
	const byPath = new Map<string, RuleFile>();
	for (const file of files) byPath.set(file.path, file);
	return [...byPath.values()].map(ruleFromFile);
}

async function findGitRoot(startPath: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: startPath });
		return stdout.trim();
	} catch {
		return null;
	}
}

// Legacy .cursorrules at the git root (or the cwd outside git). Cursor does not truncate this file.
async function loadCursorRulesFile(workspaceRoot: string): Promise<RuleFile | undefined> {
	const path = join(workspaceRoot, ".cursorrules");
	try {
		if (!(await stat(path)).isFile()) return undefined;
		return { path, body: await readRuleText(path), frontmatter: { alwaysApply: true } };
	} catch {
		return undefined;
	}
}

// Walks from the cwd up to the filesystem root; each folder contributes its .cursor/rules, then its markdown rules.
async function loadRulesFromAncestors(startPath: string): Promise<RuleFile[]> {
	const loads: Promise<RuleFile[]>[] = [];
	let current = startPath;
	for (;;) {
		loads.push(loadRulesDirectory(current));
		for (const name of MARKDOWN_RULE_FILE_NAMES) loads.push(loadMarkdownRuleFile(current, name));
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return (await Promise.all(loads)).flat();
}

async function loadRulesDirectory(baseDir: string): Promise<RuleFile[]> {
	const rulesDir = join(baseDir, ".cursor", "rules");
	if (!(await isDirectory(rulesDir))) return [];
	const relativePaths = await ripwalk(rulesDir, { includeGlobs: ["**/*.mdc"], followSymlinks: true });
	const files = await Promise.all(relativePaths.map((path) => readMdcRuleFile(join(rulesDir, path))));
	return files.filter(isDefined);
}

// Cursor reads a markdown rule file as always-applied; a file over the size limit is cut and marked.
async function loadMarkdownRuleFile(dir: string, name: string): Promise<RuleFile[]> {
	const path = join(dir, name);
	try {
		if (await isCursorIgnored(path)) return [];
		if (!(await stat(path)).isFile()) return [];
		const content = await readRuleText(path);
		const body =
			Buffer.byteLength(content, "utf8") > MAX_RULE_MARKDOWN_FILE_BYTES ? truncateMarkdownRule(content, name) : content;
		return [{ path, body, frontmatter: { alwaysApply: true } }];
	} catch {
		return [];
	}
}

async function readMdcRuleFile(path: string): Promise<RuleFile | undefined> {
	if (!path.endsWith(".mdc")) return undefined;
	try {
		const parsed = parseMdc(await readRuleText(path));
		return parsed ? { path, body: parsed.body, frontmatter: parsed.frontmatter } : undefined;
	} catch {
		return undefined;
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

// Nested rules are the rule files below the cwd, inside the same git repository.
async function discoverNested(
	root: string,
	gitRoot: string | null,
): Promise<{ rules: string[]; markdown: string[] }> {
	const found = { rules: [] as string[], markdown: [] as string[] };
	const home = resolve(homedir());
	if (root === home || hasProtectedFolderUnder(root, home) || !gitRoot) return found;
	const relativePaths = await ripwalk(root, {
		includeGlobs: NESTED_INCLUDE_GLOBS,
		excludeGlobs: DEFAULT_GLOB_IGNORE_DIRS,
		followSymlinks: true,
	});
	for (const relativePath of relativePaths) {
		const category = classifyNestedPath(relativePath);
		if (category === "rules") found.rules.push(resolve(root, relativePath));
		else if (category === "markdown") found.markdown.push(resolve(root, relativePath));
	}
	return found;
}

// Skill and agent files are classified by Cursor too, but they never reach the rules section, so they are skipped here.
function classifyNestedPath(relativePath: string): "rules" | "markdown" | undefined {
	const normalized = relativePath.replace(/\\/g, "/");
	const name = basename(normalized);
	if (MARKDOWN_RULE_FILE_NAMES.includes(name)) return "markdown";
	if (RULES_DIR_PATTERN.test(normalized) && name.endsWith(".mdc")) return "rules";
	return undefined;
}

// Lists files under root with ripgrep, the walker Cursor uses. Hidden files are included and .gitignore is honored.
async function ripwalk(
	root: string,
	options: { includeGlobs?: string[]; excludeGlobs?: string[]; followSymlinks: boolean },
): Promise<string[]> {
	const args = [
		"--files",
		"--hidden",
		"--no-require-git",
		"--no-config",
		"--color=never",
		"--threads",
		String(Math.min(2, availableParallelism())),
	];
	if (options.followSymlinks) args.push("--follow");
	for (const glob of options.includeGlobs ?? []) args.push("--iglob", glob);
	for (const glob of options.excludeGlobs ?? []) args.push("--iglob", `!${glob}`);
	return new Promise((resolvePaths, reject) => {
		const child = spawn("rg", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error: NodeJS.ErrnoException) => {
			reject(error.code === "ENOENT" ? new Error("ripgrep (rg) is not on PATH") : error);
		});
		child.on("close", (code: number | null) => {
			const paths = stdout.split("\n").filter((line) => line !== "");
			// ripgrep exits 2 when some folders cannot be read; like Cursor, fail only when nothing was listed.
			if (paths.length === 0 && code !== 0 && code !== 1) {
				reject(new Error(`ripgrep failed (exit ${code}): ${stderr}`));
			} else {
				resolvePaths(paths);
			}
		});
	});
}

// Reads a rule file as Cursor's readText does for UTF-8 and UTF-16 files: binary files are refused, a BOM is dropped,
// and CRLF becomes LF when CRLF is the usual line ending. Other encodings are not detected.
async function readRuleText(path: string): Promise<string> {
	const buffer = await readFile(path);
	let text: string;
	if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xfe && !(buffer[2] === 0 && buffer[3] === 0)) {
		text = new TextDecoder("utf-16le").decode(buffer);
	} else if (buffer.length >= 4 && buffer[0] === 0xfe && buffer[1] === 0xff) {
		text = new TextDecoder("utf-16be").decode(buffer);
	} else {
		if (!isTextBuffer(buffer)) throw new Error("Binary file cannot be decoded as text");
		text = decodeUtf8OrLatin1(buffer);
	}
	const crlf = text.split("\r\n").length - 1;
	const lf = text.split("\n").length - 1 - crlf;
	const crlfShare = crlf + lf > 0 ? (crlf / (crlf + lf)) * 100 : 0;
	return crlfShare >= 5 ? text.replaceAll("\r\n", "\n") : text;
}

// Cursor's text check: a NUL byte, or 5% or more control bytes, in the first 8 KB means binary.
function isTextBuffer(buffer: Buffer): boolean {
	const length = Math.min(FORMAT_HEADER_BYTES, buffer.length);
	for (let i = 0; i < length; i++) {
		if (buffer[i] === 0) return false;
	}
	let controlBytes = 0;
	for (let i = 0; i < length; i++) {
		const byte = buffer[i];
		if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) controlBytes++;
	}
	return length === 0 || (controlBytes / length) * 100 < 5;
}

function decodeUtf8OrLatin1(buffer: Buffer): string {
	try {
		return UTF8_DECODER.decode(buffer);
	} catch {
		return LATIN1_DECODER.decode(buffer);
	}
}

function truncateMarkdownRule(content: string, name: string): string {
	const bytes = Buffer.from(content, "utf8");
	let end = MAX_RULE_MARKDOWN_FILE_BYTES;
	while ((bytes[end] & 0xc0) === 0x80) end--;
	const sizeKb = Math.round(bytes.length / 1024);
	const keptKb = MAX_RULE_MARKDOWN_FILE_BYTES / 1024;
	return `${bytes.subarray(0, end).toString("utf8")}\n\n[truncated: ${name} is ${sizeKb} KB; only the first ${keptKb} KB is included]`;
}

// Frontmatter reader that follows Cursor's parseCursorRulesMdcContent: a leading "---" block, list items under a key,
// and one level of nesting under "metadata". Files without frontmatter are not rules.
function parseMdc(content: string): { frontmatter: Frontmatter; body: string } | undefined {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith("---")) return undefined;
	const parts = trimmed.split("---").filter(Boolean);
	if (parts.length < 2) return undefined;
	const frontmatterText = parts[0].trim();
	const body = parts.slice(1).join("---").trim();
	const frontmatter: Frontmatter = {};
	let parent: string | undefined;
	let listKey: string | undefined;
	for (const rawLine of frontmatterText.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		const item = line.match(/^\s+-\s+(.*)$/);
		if (item && listKey !== undefined) {
			let value = item[1].trim();
			if (isQuoted(value)) value = value.slice(1, -1);
			const list = frontmatter[listKey];
			if (Array.isArray(list)) list.push(value);
			continue;
		}
		if (parent !== undefined && (line.startsWith("  ") || line.startsWith("\t"))) {
			const nested = line.trim();
			const colon = nested.indexOf(":");
			if (colon === -1) continue;
			const flatKey = `${parent}.${nested.slice(0, colon).trim()}`;
			const value = nested.slice(colon + 1).trim();
			if (value === "") {
				frontmatter[flatKey] = [];
				listKey = flatKey;
			} else {
				frontmatter[flatKey] = parseScalar(value);
				listKey = undefined;
			}
			continue;
		}
		parent = undefined;
		listKey = undefined;
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (value === "" && key === "metadata") {
			parent = key;
			continue;
		}
		if (key === "globs" && value === "") {
			frontmatter.globs = [];
			listKey = "globs";
			continue;
		}
		frontmatter[key] = parseScalar(value);
	}
	return { frontmatter, body };
}

function parseScalar(raw: string): string | boolean {
	const value = raw.trim();
	if (value === "true") return true;
	if (value === "false") return false;
	return isQuoted(value) ? value.slice(1, -1) : value;
}

function isQuoted(value: string): boolean {
	return (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
}

function parseGlobs(value: unknown): string[] | undefined {
	let globs: string[];
	if (typeof value === "string") {
		globs = splitCommaSeparatedGlobs(value);
	} else if (Array.isArray(value)) {
		globs = value
			.filter((item): item is string => typeof item === "string")
			.map((item) => item.trim())
			.filter(Boolean);
	} else {
		return undefined;
	}
	return globs.length > 0 ? globs : undefined;
}

// Splits on commas that are outside braces, so {a,b} stays one glob.
function splitCommaSeparatedGlobs(value: string): string[] {
	const globs: string[] = [];
	let start = 0;
	let braceDepth = 0;
	for (let index = 0; index < value.length; index++) {
		const ch = value[index];
		if (ch === "{") {
			braceDepth++;
		} else if (ch === "}" && braceDepth > 0) {
			braceDepth--;
		} else if (ch === "," && braceDepth === 0) {
			const glob = value.slice(start, index).trim();
			if (glob) globs.push(glob);
			start = index + 1;
		}
	}
	if (braceDepth > 0) {
		for (const piece of value.slice(start).split(",")) {
			const glob = piece.trim();
			if (glob) globs.push(glob);
		}
		return globs;
	}
	const glob = value.slice(start).trim();
	if (glob) globs.push(glob);
	return globs;
}

function ruleFromFile({ path, body, frontmatter }: RuleFile): CursorRule {
	if (frontmatter.alwaysApply === true) return { fullPath: path, content: body, kind: "global" };
	const globs = parseGlobs(frontmatter.globs);
	if (globs !== undefined) return { fullPath: path, content: body, kind: "fileGlobbed", globs };
	const description = frontmatter.description;
	if (typeof description === "string" && description.trim().length > 0) {
		return {
			fullPath: path,
			content: body,
			kind: "agentFetched",
			description: description.slice(0, MAX_RULE_DESCRIPTION_LENGTH),
		};
	}
	return { fullPath: path, content: body, kind: "manuallyAttached" };
}

// Cursor's categorizeCursorRules for a workspace with no user, team or environment rules.
function categorizeRules(
	rules: readonly CursorRule[],
	workspacePaths: readonly string[],
): { global: CursorRule[]; agentRequestable: CursorRule[] } {
	const global: CursorRule[] = [];
	const agentRequestable: CursorRule[] = [];
	for (const rule of rules) {
		if (isSkillPath(rule.fullPath)) {
			if (rule.kind === "global") global.push(rule);
			continue;
		}
		if (rule.kind === "manuallyAttached") continue;
		if (rule.kind !== "global" || isFileScopedCursorRule(rule, workspacePaths)) agentRequestable.push(rule);
		else global.push(rule);
	}
	return { global, agentRequestable };
}

function isSkillPath(path: string): boolean {
	const normalized = normalizeToUnixPath(path);
	return SKILL_PATH_REGEXPS.some((regex) => regex.test(normalized));
}

// A global rule in a folder below a workspace root applies to files there only, so it is not always-applied.
function isFileScopedCursorRule(rule: CursorRule, workspacePaths: readonly string[]): boolean {
	if (rule.kind === "fileGlobbed") return true;
	if (rule.kind !== "global") return false;
	const ruleDir = normalizePath(getRuleDir(rule.fullPath));
	const containing = workspacePaths.map((root) => normalizePath(root)).find((root) => isPathWithinDir(ruleDir, root));
	return containing !== undefined && ruleDir !== containing;
}

// The folder that owns a rule: the parent of its .cursor/rules folder, or the rule's own folder.
function getRuleDir(mdcPath: string): string {
	const literalRuleDir = posix.normalize(posix.dirname(normalizeToUnixPath(mdcPath)));
	const segments = literalRuleDir.split("/");
	for (let i = segments.length - 2; i >= 0; i--) {
		if (segments[i] === ".cursor" && segments[i + 1] === "rules") {
			const parentSegments = segments.slice(0, i);
			return parentSegments.length === 0 ? "/" : parentSegments.join("/");
		}
	}
	return literalRuleDir;
}

function normalizeToUnixPath(path: string): string {
	return path.replace(/\\/g, "/");
}

function normalizePath(value: string): string {
	const normalized = posix.normalize(normalizeToUnixPath(value));
	return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
}

function isPathWithinDir(pathValue: string, dir: string): boolean {
	const normalizedDir = normalizePath(dir);
	if (normalizedDir === "/") return pathValue.startsWith("/");
	return pathValue === normalizedDir || pathValue.startsWith(`${normalizedDir}/`);
}

// Renders the rules section exactly as Cursor's buildRulesPromptSection does for these rules, or returns undefined
// when there is nothing to show.
export function renderRulesSection(rules: readonly CursorRule[], workspacePaths: readonly string[]): string | undefined {
	const { global, agentRequestable } = categorizeRules(rules, workspacePaths);
	const requestable = agentRequestable.filter((rule) => !isFileScopedCursorRule(rule, workspacePaths));
	if (global.length === 0 && requestable.length === 0) return undefined;
	return renderContent(rulesElement(global, requestable));
}

// Once file-scoped rules are filtered out, only description-based rules reach this list.
function agentRequestableDescription(rule: CursorRule): string | undefined {
	return rule.kind === "agentFetched" ? rule.description : undefined;
}

function rulesElement(global: CursorRule[], agentRequestable: CursorRule[]): PromptElement {
	return sectionOf("rules", {}, [
		paragraphOf(RULES_INTRO),
		lineBreakOf(),
		global.length > 0 &&
			sectionOf(
				"always_applied_workspace_rules",
				{ description: ALWAYS_APPLIED_DESCRIPTION },
				global.map((rule) => tagOf("always_applied_workspace_rule", { name: rule.fullPath }, rule.content)),
			),
		agentRequestable.length > 0 &&
			sectionOf(
				"agent_requestable_workspace_rules",
				{ description: AGENT_REQUESTABLE_DESCRIPTION },
				agentRequestable.map((rule) =>
					tagOf("agent_requestable_workspace_rule", { fullPath: rule.fullPath }, agentRequestableDescription(rule)),
				),
			),
		lineBreakOf(),
	]);
}

// Small model of the prompt JSX that Cursor renders. Block elements (p, section, x) keep their own text; runs of text
// and breaks form paragraphs; paragraphs are separated by a blank line unless the earlier one already ends in a newline.
interface PromptElement {
	type: "p" | "br" | "section" | "x";
	title?: string;
	tag?: string;
	attrs?: Record<string, string>;
	children?: PromptNode;
}

type PromptNode = string | false | undefined | PromptElement | readonly PromptNode[];

const BLOCK_TYPES = new Set(["p", "section", "x"]);

function paragraphOf(text: string): PromptElement {
	return { type: "p", children: text };
}

function lineBreakOf(): PromptElement {
	return { type: "br" };
}

function sectionOf(title: string, attrs: Record<string, string>, children: PromptNode): PromptElement {
	return { type: "section", title, attrs, children };
}

function tagOf(tag: string, attrs: Record<string, string>, children: PromptNode): PromptElement {
	return { type: "x", tag, attrs, children };
}

// Element children always go through the paragraph pass, so a bare string is trimmed like any other run of text.
function childNodes(children: PromptNode): readonly PromptNode[] {
	return Array.isArray(children) ? (children as readonly PromptNode[]) : [children];
}

function renderContent(node: PromptNode): string {
	if (node === undefined || node === false) return "";
	if (typeof node === "string") return node;
	if (Array.isArray(node)) return renderParagraphs(node as readonly PromptNode[]);
	return renderElement(node as PromptElement);
}

function renderElement(element: PromptElement): string {
	switch (element.type) {
		case "p":
			return renderParagraphs(childNodes(element.children));
		case "br":
			return "\n";
		case "section":
			return renderSection(element);
		case "x":
			return renderTag(element);
	}
}

function renderSection(element: PromptElement): string {
	const tag = (element.title ?? "").toLowerCase().replace(/\s+/g, "-");
	const content = renderParagraphs(childNodes(element.children));
	const open = openTag(tag, element.attrs);
	return content.trim() === "" ? `${open} />` : `${open}>\n${content}\n</${tag}>`;
}

function renderTag(element: PromptElement): string {
	const tag = element.tag ?? "x";
	const content = renderParagraphs(childNodes(element.children));
	const open = openTag(tag, element.attrs);
	return content.trim() === "" ? `${open} />` : `${open}>${content}</${tag}>`;
}

function openTag(tag: string, attrs: Record<string, string> = {}): string {
	const pairs = Object.entries(attrs).map(([name, value]) => `${name}="${value.replace(/"/g, "&quot;")}"`);
	return pairs.length > 0 ? `<${tag} ${pairs.join(" ")}` : `<${tag}`;
}

function renderParagraphs(nodes: readonly PromptNode[]): string {
	const paragraphs: string[] = [];
	let pending: string[] = [];
	const flush = () => {
		if (pending.length === 0) return;
		const text = pending.join("");
		if (text.trim() !== "") paragraphs.push(normalizeWhitespace(text));
		else if (text.includes("\n")) paragraphs.push(text);
		pending = [];
	};
	for (const node of flattenNodes(nodes)) {
		if (typeof node === "string") {
			if (node !== "") pending.push(node);
		} else if (BLOCK_TYPES.has(node.type)) {
			flush();
			const content = renderElement(node).trim();
			if (content !== "") paragraphs.push(content);
		} else {
			pending.push(renderElement(node));
		}
	}
	flush();
	if (paragraphs.length === 0) return "";
	let result = paragraphs[0];
	for (let i = 1; i < paragraphs.length; i++) {
		const previous = paragraphs[i - 1];
		const current = paragraphs[i];
		if (current.trim() === "") result += current;
		else if (previous.trim() !== "" && previous.endsWith("\n")) result += current;
		else result += `\n\n${current}`;
	}
	return result.replace(/^\n+/, "").replace(/\n+$/, "");
}

function flattenNodes(nodes: readonly PromptNode[]): Array<string | PromptElement> {
	const flat: Array<string | PromptElement> = [];
	for (const node of nodes) {
		if (node === undefined || node === false) continue;
		if (Array.isArray(node)) flat.push(...flattenNodes(node as readonly PromptNode[]));
		else flat.push(node as string | PromptElement);
	}
	return flat;
}

// Keeps the trailing newlines of a run, collapses repeated spaces and trims the rest.
function normalizeWhitespace(text: string): string {
	const trailing = text.match(/\n+$/)?.[0] ?? "";
	return text.replace(/ +/g, " ").trim() + trailing;
}

// Cursor's git-status and skill paths use a darwin-only rule: a folder that holds a protected home folder is skipped.
function hasProtectedFolderUnder(root: string, home: string): boolean {
	if (process.platform !== "darwin") return false;
	const comparableRoot = normalizeSlashes(root).toLowerCase();
	const normalizedHome = normalizeSlashes(home);
	const folders = [...PROTECTED_HOME_FOLDERS.map((folder) => `${normalizedHome}/${folder}`), PROTECTED_VOLUMES_FOLDER];
	return folders.some((folder) => isStrictlyInside(folder.toLowerCase(), comparableRoot));
}

function normalizeSlashes(path: string): string {
	const normalized = path.replace(/\/{2,}/g, "/");
	return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isStrictlyInside(child: string, parent: string): boolean {
	if (child === parent) return false;
	return child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

function classifyNestedNameForIgnore(path: string): string {
	return path;
}

// .cursorignore applies to markdown rule files. Cursor resolves the file's real path, then tests it against every
// .cursorignore in its ancestor folders, except the filesystem root's.
async function isCursorIgnored(path: string): Promise<boolean> {
	const real = await resolveRealPathStrict(path);
	if (real === null) return true;
	let dir = dirname(real);
	while (dir !== dirname(dir)) {
		const rules = await readCursorIgnoreRules(dir);
		if (rules.length > 0 && isCursorIgnoredPath(rules, relative(dir, real))) return true;
		dir = dirname(dir);
	}
	return false;
}

async function readCursorIgnoreRules(dir: string): Promise<IgnoreRule[]> {
	try {
		return parseIgnoreRules(await readRuleText(join(dir, ".cursorignore")));
	} catch {
		return [];
	}
}

// Like Cursor's resolveRealPathStrict: the realpath of the longest existing ancestor, with the rest appended.
async function resolveRealPathStrict(path: string): Promise<string | null> {
	const tail: string[] = [];
	let current = resolve(path);
	for (;;) {
		try {
			return join(await realpath(current), ...tail.reverse());
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
			const parent = dirname(current);
			if (parent === current) return null;
			tail.push(basename(current));
			current = parent;
		}
	}
}

// gitignore-style rules, as the `ignore` package reads them: comments and blank lines are skipped, a leading "!"
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

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
