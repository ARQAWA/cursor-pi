// Cursor Pi's skill catalog: finds the SKILL.md files Cursor loads for a workspace, the list the read tool and the catalog both use, and renders the agent_skills section.
// Discovery, budget and path aliasing follow Cursor's code; nothing is copied from it.
import { readdir, readFile } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { minimatch } from "minimatch";
import { DEFAULT_GLOB_IGNORE_DIRS, findGitRoot, hasProtectedFolderUnder, lineBreakOf, parseGlobs, parseMdc, renderContent, ripwalk, sectionOf, tagOf, type PromptElement, type PromptNode } from "./rules.ts";

// Skill folders under the workspace and under the home folder. Cursor's built-in skills-cursor folder is not listed.
const SKILL_CONFIG_DIRS = [".cursor/skills", ".claude/skills", ".codex/skills", ".grok/skills", ".agents/skills"];
// The skill folders Cursor's nested walk classifies: the same as above, and the built-in skills-cursor folder.
const NESTED_SKILL_CONFIG_DIRS = [...SKILL_CONFIG_DIRS, ".cursor/skills-cursor"];
const NESTED_SKILL_GLOBS = ["*/**/.cursor/**", "*/**/.agents/**", "*/**/.claude/**", "*/**/.codex/**", "*/**/.grok/**"];
const NESTED_SKILL_DIR_PATTERNS = NESTED_SKILL_CONFIG_DIRS.map(
	(dir) => new RegExp(`[/\\\\]${dir.split("/").map((part) => part.replaceAll(".", "\\.")).join("[/\\\\]")}[/\\\\]`, "i"),
);
// The folders that scope a skill to the folder above them, as Cursor's getSkillScopeRoot reads them.
const SKILL_SCOPE_DIRS = [".cursor/skills", ".cursor/skills-cursor", ".agents/skills", ".claude/skills", ".codex/skills", ".grok/skills"];
// The environment of this IDE agent: Cursor's filterByAgentEnvironment maps AgentType.IDE to "local".
export const IDE_SKILL_ENVIRONMENT = "local";
const EXCLUDED_CODEX_SKILL_NAMES = new Set(["imagegen", "openai-docs", "opneai-docs", "plugin-creator", "skill-creator", "skill-installer"]);
const MAX_SKILL_DESCRIPTION_LENGTH = 1536;
const SKILL_FILE_NAME = "SKILL.md";
const READ_TOOL = "ReadFile";
export const SKILL_CATALOG_PATH_ALIAS_NOTE = "A path that starts with an alias ($0, $1, ...) continues from the directory listed for that alias.";
const INITIAL_SKILL_CATALOG_CONTEXT_FRACTION = 0.02;
const FALLBACK_AGENT_TOKEN_LIMIT = 200_000;
const TRUNCATED_DESCRIPTION_SUFFIX = "...";
const MIN_TRUNCATED_DESCRIPTION_LENGTH = 24;
const MAX_TRUNCATED_DESCRIPTION_LENGTH = 480;
const SHORT_DESCRIPTION_PATH_ONLY_THRESHOLD = 80;
const MAX_OMITTED_DIRECTORY_COUNT = 5;
const PROTECTED_SKILL_NAMES = new Set([
	"canvas",
	"env-setup",
	"meetings",
	"purchases",
	"visualize",
	"x-api-mcp-guide",
	"accommodation-booking",
	"flight-booking",
	"food-ordering",
	"job-search",
	"restaurant-booking",
	"restaurant-recommendations",
	"rideshare",
	"scheduling",
	"shopping",
]);
const PROTECTED_SKILL_NAME_PREFIXES = ["site-playbooks-"];
const ALIAS_LENGTH = 2;
const ROOT_LINE_OVERHEAD = ALIAS_LENGTH + 4;
const ALIASING_OVERHEAD = SKILL_CATALOG_PATH_ALIAS_NOTE.length + 2;
const UNLISTABLE_PATH = / {2}|[\r\n]|^\s|\s[\\/]/;
const SKILL_DIRECTORY_MARKERS = ["/.cursor/skills/", "/.cursor/skills-cursor/", "/.agents/skills/", "/.claude/skills/", "/.codex/skills/", "/.grok/skills/", "/.claude/plugins/"];
const PLUGIN_SKILLS_MARKER = "/.cursor/plugins/cache/";

// One entry of Cursor's agentSkills list, with the fields the read tool and the catalog filter read.
export interface DiscoveredSkill {
	fullPath: string;
	description: string;
	globs: string[];
	disableModelInvocation: boolean;
	environments: string[];
	disabledEnvironments: string[];
	// Cursor lists a skill that cannot be read, or that has no description and does not disable model invocation, with a
	// parse error; the read tool never reminds of those.
	parseError: boolean;
}

interface SkillCatalogItem {
	fullPath: string;
	description?: string;
}

type RenderSkills = (skills: readonly SkillCatalogItem[], omittedNotice: PromptElement | undefined) => PromptElement;

// Cursor's agentSkills list for a workspace: its skill folders, the skills in its subfolders, and the home folder's skill
// folders, sorted by path. Skills that disable model invocation or apply to some files stay in the list with their globs
// and flags; the catalog and the read tool filter them.
export async function discoverAgentSkills(workspacePath: string, home: string): Promise<DiscoveredSkill[]> {
	const roots = [workspacePath, home].flatMap((base) => SKILL_CONFIG_DIRS.map((dir) => join(base, dir)));
	const files = new Set<string>();
	for (const root of roots) {
		for (const file of await findSkillFiles(root)) files.add(file);
	}
	for (const file of await findNestedSkillFiles(workspacePath, home)) files.add(file);
	const loaded = await Promise.all([...files].filter((file) => !shouldIgnoreSkillPath(file)).map((file) => loadSkill(file)));
	return loaded
		.filter((skill): skill is DiscoveredSkill => skill !== undefined)
		.sort((a, b) => (a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : 0));
}

// Walks a skill folder for SKILL.md files; hidden entries are skipped, as Cursor skips them below a skill root.
async function findSkillFiles(root: string): Promise<string[]> {
	const found: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name.startsWith(".")) continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && entry.name === SKILL_FILE_NAME) found.push(path);
		}
	};
	await walk(root);
	return found;
}

// Cursor's buildAgentSkillFromParsed. A file that cannot be read stays in the list with a parse error, as Cursor keeps it.
async function loadSkill(fullPath: string): Promise<DiscoveredSkill | undefined> {
	let content: string;
	try {
		content = await readFile(fullPath, "utf8");
	} catch {
		return { fullPath, description: "", globs: [], disableModelInvocation: false, environments: [], disabledEnvironments: [], parseError: true };
	}
	const frontmatter = parseMdc(content)?.frontmatter ?? {};
	// An alwaysApply skill is a rule only, so it is not in the skill list.
	if (frontmatter.alwaysApply === true) return undefined;
	const description = typeof frontmatter.description === "string" ? frontmatter.description.slice(0, MAX_SKILL_DESCRIPTION_LENGTH) : "";
	const disableModelInvocation = frontmatter["disable-model-invocation"] === true;
	return {
		fullPath,
		description,
		globs: parseGlobs(frontmatter.paths ?? frontmatter.globs) ?? [],
		disableModelInvocation,
		environments: stringList(frontmatter.environments ?? frontmatter["metadata.environments"]),
		disabledEnvironments: stringList(frontmatter["disabled-environments"] ?? frontmatter["metadata.disabledEnvironments"]),
		// Cursor's skillDescriptionError: a skill without a description is an error unless it disables model invocation.
		parseError: description === "" && !disableModelInvocation,
	};
}

// Cursor's parseStringListFrontmatter: a list, or a comma-separated string.
function stringList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
	if (typeof value === "string") return value.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
	return [];
}

// Cursor's shouldIgnoreExtensibilitySkillPath: a skill under a hidden folder of its skill folder is skipped, and so is a
// Codex skill that Cursor does not list.
function shouldIgnoreSkillPath(skillPath: string): boolean {
	const segments = skillPath.replace(/\\/g, "/").split("/").filter(Boolean);
	const rootIndex = segments.findIndex((segment, i) => NESTED_SKILL_CONFIG_DIRS.includes(`${segment}/${segments[i + 1]}`));
	if (rootIndex !== -1 && segments.slice(rootIndex + 2).some((segment) => segment.startsWith("."))) return true;
	const codexIndex = segments.lastIndexOf(".codex");
	if (codexIndex === -1 || segments[codexIndex + 1] !== "skills") return false;
	const lastSegment = segments.at(-1);
	const skillName = lastSegment === SKILL_FILE_NAME ? segments.at(-2) : lastSegment;
	return skillName !== undefined && EXCLUDED_CODEX_SKILL_NAMES.has(skillName);
}

// Cursor's NestedExtensibilityService: skill files in subfolders of the workspace. Only a workspace inside a git repository
// is searched, and never the home folder or a folder that holds a protected home folder.
async function findNestedSkillFiles(workspacePath: string, home: string): Promise<string[]> {
	const root = resolve(workspacePath);
	const homeDir = resolve(home);
	if (root === homeDir || hasProtectedFolderUnder(root, homeDir)) return [];
	if ((await findGitRoot(root)) === null) return [];
	const relativePaths = await ripwalk(root, { includeGlobs: NESTED_SKILL_GLOBS, excludeGlobs: DEFAULT_GLOB_IGNORE_DIRS, followSymlinks: true });
	return relativePaths.filter(isNestedSkillPath).map((relativePath) => join(root, relativePath));
}

function isNestedSkillPath(relativePath: string): boolean {
	const normalized = relativePath.replace(/\\/g, "/");
	return posix.basename(normalized) === SKILL_FILE_NAME && NESTED_SKILL_DIR_PATTERNS.some((pattern) => pattern.test(normalized));
}

// Cursor's isEnvironmentEligible, as filterByEnvironment uses it: out when disabled for the environment, and in when it
// lists no environments or lists this one.
export function isEnvironmentEligible(skill: Pick<DiscoveredSkill, "environments" | "disabledEnvironments">, environment: string): boolean {
	if (skill.disabledEnvironments.includes(environment)) return false;
	return skill.environments.length === 0 || skill.environments.includes(environment);
}

// Cursor's isFileScopedSkill: a skill with globs, or a skill kept in a folder below a workspace root, applies to some
// files only.
export function isFileScopedSkill(skill: DiscoveredSkill, workspacePaths: readonly string[]): boolean {
	if (skill.globs.length > 0) return true;
	if (isGrokBundledSkill(skill.fullPath)) return false;
	const scopeRoot = normalizeScopePath(skillScopeRoot(skill.fullPath));
	const containingRoot = workspacePaths.map((root) => normalizeScopePath(root)).find((root) => isWithinDir(scopeRoot, root));
	return containingRoot !== undefined && scopeRoot !== containingRoot;
}

// Cursor's doesSkillMatchPath: whether a skill applies to a file the read tool has just read.
export function skillMatchesReadPath(skill: DiscoveredSkill, readPath: string, workspacePaths: readonly string[]): boolean {
	if (!isFileScopedSkill(skill, workspacePaths)) return false;
	const normalizedReadPath = normalizeScopePath(readPath);
	const scopeRoot = normalizeScopePath(skillScopeRoot(skill.fullPath));
	if (skill.globs.length === 0) return isWithinDir(normalizedReadPath, scopeRoot);
	const scopeRootWithinWorkspace = !isGrokBundledSkill(skill.fullPath) && workspacePaths.some((root) => isWithinDir(scopeRoot, normalizeScopePath(root)));
	if (scopeRootWithinWorkspace && !isWithinDir(normalizedReadPath, scopeRoot)) return false;
	let relativeCandidate: string | undefined;
	if (isWithinDir(normalizedReadPath, scopeRoot)) {
		relativeCandidate = scopeRoot === "/" ? normalizedReadPath.slice(1) : normalizedReadPath.slice(scopeRoot.length + 1);
	}
	const workspaceCandidates = scopeRootWithinWorkspace ? [] : workspaceRelativeCandidates(normalizedReadPath, workspacePaths);
	return skill.globs.some((globPattern) => {
		const glob = globPattern.replace(/\\/g, "/");
		if (glob.startsWith("/")) return minimatch(normalizedReadPath, glob, { dot: true });
		if (relativeCandidate) return minimatch(relativeCandidate, glob, { dot: true });
		return workspaceCandidates.some((candidate) => minimatch(candidate, glob, { dot: true }));
	});
}

// Cursor's getWorkspaceRelativeCandidates: the read path relative to each workspace root that contains it.
function workspaceRelativeCandidates(readPath: string, workspacePaths: readonly string[]): string[] {
	const candidates = new Set<string>();
	for (const workspacePath of workspacePaths) {
		const root = normalizeScopePath(workspacePath);
		if (!isWithinDir(readPath, root)) continue;
		candidates.add(root === "/" ? readPath.slice(1) : readPath.slice(root.length + 1));
	}
	return [...candidates];
}

// Cursor's getSkillScopeRoot: the folder that holds the skill's config folder, or else the skill's own folder.
function skillScopeRoot(skillPath: string): string {
	const normalized = skillPath.replace(/\\/g, "/");
	const segments = posix.normalize(posix.dirname(normalized)).split("/");
	for (let i = segments.length - 2; i >= 0; i--) {
		if (SKILL_SCOPE_DIRS.includes(`${segments[i]}/${segments[i + 1]}`)) {
			const parent = segments.slice(0, i);
			return parent.length === 0 || (parent.length === 1 && parent[0] === "") ? "/" : parent.join("/");
		}
	}
	return posix.normalize(posix.dirname(normalized));
}

// Cursor's normalizePath: POSIX separators and dot segments resolved, with no trailing slash except at the root.
function normalizeScopePath(value: string): string {
	const normalized = posix.normalize(value.replace(/\\/g, "/"));
	return normalized === "/" ? "/" : normalized.replace(/\/+$/, "");
}

// Cursor's isPathWithinDir: the path is the folder itself or lies below it.
function isWithinDir(pathValue: string, dir: string): boolean {
	const normalizedDir = normalizeScopePath(dir);
	if (normalizedDir === "/") return pathValue.startsWith("/");
	return pathValue === normalizedDir || pathValue.startsWith(`${normalizedDir}/`);
}

// Cursor's isGrokBundledSkill: a skill from the grok bundled folder, which no workspace scopes.
function isGrokBundledSkill(skillPath: string): boolean {
	const segments = skillPath.replace(/\\/g, "/").split("/");
	return segments.some((_segment, i) => [".grok", "bundled", "skills"].every((segment, offset) => segments[i + offset] === segment));
}

// Cursor's two agent_skills preambles: GPT-5.6 models get the names-a-skill wording, the others the default.
export type SkillPreamble = "default" | "gpt-5.6";

// Cursor's BudgetedAgentSkillsSection for the catalog: the skills this IDE lists, which are not disabled for model
// invocation and do not apply to some files only. Undefined when none are left.
export function buildAgentSkillsSection(skills: readonly DiscoveredSkill[], workspacePaths: readonly string[], aliasPathPrefixes: boolean, preamble: SkillPreamble = "default"): PromptElement | undefined {
	const listed = skills.filter(
		(skill) => isEnvironmentEligible(skill, IDE_SKILL_ENVIRONMENT) && !skill.disableModelInvocation && !isFileScopedSkill(skill, workspacePaths),
	);
	if (listed.length === 0) return undefined;
	const items: SkillCatalogItem[] = listed.map((skill) => ({ fullPath: skill.fullPath, description: skill.description || undefined }));
	return applySkillCatalogBudget(items, (listed, omittedNotice) => {
		const aliased = aliasPathPrefixes ? aliasSkillCatalogPathRoots(listed) : undefined;
		return agentSkillsSection(aliased?.skills ?? listed, omittedNotice, aliased?.roots ?? [], preamble);
	});
}

function agentSkillsSection(items: readonly SkillCatalogItem[], omittedNotice: PromptElement | undefined, pathRoots: readonly string[], preamble: SkillPreamble): PromptElement {
	const hasOmitted = omittedNotice !== undefined;
	const hasListed = items.length > 0;
	const description = `Skills the agent can use. Use the ${READ_TOOL} tool with the provided absolute path to fetch full contents.${pathRoots.length > 0 ? ` ${SKILL_CATALOG_PATH_ALIAS_NOTE}` : ""}`;
	const pathRootList: PromptElement | undefined =
		pathRoots.length > 0 ? { type: "p", children: pathRoots.map((root, index) => `$${index} = ${root}`).join("\n") } : undefined;
	const listingNote = !hasListed && hasOmitted
		? "No skills are listed below, but additional skills may exist in the directories shown in the skills section if a later task specifically requires discovering more skills."
		: hasOmitted
			? "Use the skills listed below. If a later task specifically requires discovering more skills, additional skills may exist in the directories shown in the skills section."
			: "Only use skills listed below.";
	return sectionOf("agent_skills", {}, [
		...preambleNodes(preamble, listingNote),
		lineBreakOf(),
		sectionOf("available_skills", { description }, [
			pathRootList,
			items.map((item) => tagOf("agent_skill", { fullPath: item.fullPath }, item.description)),
			omittedNotice,
		]),
		lineBreakOf(),
	]);
}

// The agent_skills preamble: GPT-5.6 models get Cursor's wording for skills the user names, the other models the default.
function preambleNodes(preamble: SkillPreamble, listingNote: string): PromptElement[] {
	if (preamble === "gpt-5.6") {
		return [
			{
				type: "p",
				children: [
					"When the user names a skill, use it faithfully as part of the current task.",
					` Read the skill file using the ${READ_TOOL} tool before following its instructions.`,
					" ",
					"The user's instructions take precedence over skill guidance, and an invoked skill takes precedence over autonomous judgment where they do not conflict.",
				],
			},
			{
				type: "p",
				children: [
					"Tell the user in `commentary` when a skill causes a material action or pause. Before using a skill the user did not name, briefly explain why it is relevant and keep its use within the task's scope. Mention material effects in the final response, but do not cite skills you merely inspected.",
					" ",
					listingNote,
				],
			},
		];
	}
	return [
		{
			type: "p",
			children: [
				"When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.",
				` To use a skill, read the skill file at the provided absolute path using the ${READ_TOOL} tool, then follow the instructions within.`,
				" ",
				"When a skill is relevant, read and follow it IMMEDIATELY as your first action. NEVER just announce or mention a skill without actually reading and following it.",
				" ",
				listingNote,
			],
		},
	];
}

// Cursor's applySkillCatalogBudget: the section as written when it fits in 2% of the agent's token limit, otherwise
// shortened descriptions, then path-only entries, then as many skills as fit with an omitted-skills notice.
function applySkillCatalogBudget(skills: readonly SkillCatalogItem[], renderSection: RenderSkills): PromptElement {
	const uncapped = renderSection(skills, undefined);
	const budgetTokens = Math.floor(FALLBACK_AGENT_TOKEN_LIMIT * INITIAL_SKILL_CATALOG_CONTEXT_FRACTION);
	if (estimateTokens(uncapped) <= budgetTokens) return uncapped;
	const shortened = truncateDescriptionsToFit(skills, budgetTokens, renderSection);
	if (shortened !== undefined) return shortened;
	const pathOnly = skills.map((skill) => (isProtectedSkill(skill) ? skill : { fullPath: skill.fullPath, description: undefined }));
	const pathOnlySection = renderSection(pathOnly, undefined);
	if (estimateTokens(pathOnlySection) <= budgetTokens) return pathOnlySection;
	return omitSkillsToFit(skills, pathOnly, budgetTokens, renderSection);
}

function estimateTokens(node: PromptNode): number {
	return Math.round(renderContent(node).length / 4);
}

function truncateDescriptionsToFit(skills: readonly SkillCatalogItem[], budgetTokens: number, renderSection: RenderSkills): PromptElement | undefined {
	const longest = skills.reduce((max, skill) => (isProtectedSkill(skill) ? max : Math.max(max, skill.description?.length ?? 0)), 0);
	if (longest <= SHORT_DESCRIPTION_PATH_ONLY_THRESHOLD) return undefined;
	let best: PromptElement | undefined;
	let low = MIN_TRUNCATED_DESCRIPTION_LENGTH;
	let high = Math.min(longest - 1, MAX_TRUNCATED_DESCRIPTION_LENGTH);
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = skills.map((skill) =>
			isProtectedSkill(skill) ? skill : { fullPath: skill.fullPath, description: truncateDescription(skill.description, middle) },
		);
		const section = renderSection(candidate, undefined);
		if (estimateTokens(section) <= budgetTokens) {
			best = section;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return best;
}

function omitSkillsToFit(
	all: readonly SkillCatalogItem[],
	pathOnly: readonly SkillCatalogItem[],
	budgetTokens: number,
	renderSection: RenderSkills,
): PromptElement {
	const droppable: number[] = [];
	all.forEach((skill, index) => {
		if (!isProtectedSkill(skill)) droppable.push(index);
	});
	for (let retainedCount = droppable.length; retainedCount >= 0; retainedCount--) {
		const retained = new Set(droppable.slice(0, retainedCount));
		const listed: SkillCatalogItem[] = [];
		const omitted: SkillCatalogItem[] = [];
		all.forEach((skill, index) => {
			if (isProtectedSkill(skill) || retained.has(index)) listed.push(pathOnly[index]);
			else omitted.push(skill);
		});
		const directories = omittedDirectories(omitted).slice(0, MAX_OMITTED_DIRECTORY_COUNT);
		const notice = omitted.length > 0 ? omittedNotice(directories, omitted.length) : undefined;
		const section = renderSection(listed, notice);
		if (estimateTokens(section) <= budgetTokens || retainedCount === 0) return section;
	}
	throw new Error("omitSkillsToFit: loop ended without returning");
}

function omittedNotice(directories: readonly string[], count: number): PromptElement {
	return {
		type: "p",
		children: `Additional skills omitted from this initial list (${count}). Directories containing omitted skills: ${directories.join(", ")}.`,
	};
}

function isProtectedSkill(skill: SkillCatalogItem): boolean {
	const name = skillNameFromPath(skill.fullPath);
	return PROTECTED_SKILL_NAMES.has(name) || PROTECTED_SKILL_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function skillNameFromPath(fullPath: string): string {
	const parts = fullPath.replace(/\\/g, "/").split("/");
	const last = parts.at(-1) ?? "";
	if (last === SKILL_FILE_NAME && parts.length >= 2) return parts.at(-2) ?? "";
	return last;
}

function truncateDescription(description: string | undefined, maxLength: number): string | undefined {
	if (description === undefined || description.length <= maxLength) return description;
	const contentLength = Math.max(0, maxLength - TRUNCATED_DESCRIPTION_SUFFIX.length);
	return `${description.slice(0, contentLength).trimEnd()}${TRUNCATED_DESCRIPTION_SUFFIX}`;
}

function omittedDirectories(skills: readonly SkillCatalogItem[]): string[] {
	return [...new Set(skills.map((skill) => directoryHint(skill.fullPath)))];
}

function directoryHint(fullPath: string): string {
	const normalized = fullPath.replace(/\\/g, "/");
	for (const marker of SKILL_DIRECTORY_MARKERS) {
		const index = normalized.indexOf(marker);
		if (index !== -1) return normalized.slice(0, index + marker.length - 1);
	}
	const pluginIndex = normalized.indexOf(PLUGIN_SKILLS_MARKER);
	if (pluginIndex !== -1) {
		const skillsIndex = normalized.indexOf("/skills/", pluginIndex);
		if (skillsIndex !== -1) return normalized.slice(0, skillsIndex + "/skills".length);
	}
	const lastSlash = normalized.lastIndexOf("/");
	return lastSlash === -1 ? normalized : normalized.slice(0, lastSlash);
}

// Cursor's aliasSkillCatalogPathRoots: shares common folder prefixes as $0, $1, ... roots when that saves text.
interface AliasNode {
	path: string;
	depth: number;
	parent?: AliasNode;
	children: Map<string, AliasNode>;
	skillIndexes: number[];
	costByRoot: Map<AliasNode | undefined, number>;
}

function createAliasNode(path: string, parent?: AliasNode): AliasNode {
	return { path, depth: parent === undefined ? 0 : parent.depth + 1, parent, children: new Map(), skillIndexes: [], costByRoot: new Map() };
}

function subtreeCost(node: AliasNode, root: AliasNode | undefined): number {
	let cost = node.costByRoot.get(root);
	if (cost === undefined) {
		cost = Math.min(openRootCost(node), keepRootCost(node, root));
		node.costByRoot.set(root, cost);
	}
	return cost;
}

function openRootCost(node: AliasNode): number {
	if (node.parent === undefined) return Number.POSITIVE_INFINITY;
	return node.path.length + ROOT_LINE_OVERHEAD + keepRootCost(node, node);
}

function keepRootCost(node: AliasNode, root: AliasNode | undefined): number {
	const directoryCost = root === undefined ? node.path.length : ALIAS_LENGTH + node.path.length - root.path.length;
	let cost = directoryCost * node.skillIndexes.length;
	for (const child of node.children.values()) cost += subtreeCost(child, root);
	return cost;
}

function assignRoots(node: AliasNode, root: AliasNode | undefined, rootByIndex: Map<number, AliasNode>): void {
	const nodeRoot = openRootCost(node) < keepRootCost(node, root) ? node : root;
	if (nodeRoot !== undefined) {
		for (const index of node.skillIndexes) rootByIndex.set(index, nodeRoot);
	}
	for (const child of node.children.values()) assignRoots(child, nodeRoot, rootByIndex);
}

function commonAncestor(first: AliasNode, second: AliasNode): AliasNode {
	let a = first;
	let b = second;
	while (a !== b) {
		if (a.depth >= b.depth) a = a.parent as AliasNode;
		else b = b.parent as AliasNode;
	}
	return a;
}

function aliasSkillCatalogPathRoots(skills: readonly SkillCatalogItem[]): { roots: string[]; skills: SkillCatalogItem[] } {
	const trie = createAliasNode("");
	const nodeByIndex: AliasNode[] = [];
	skills.forEach((skill, index) => {
		if (UNLISTABLE_PATH.test(skill.fullPath)) return;
		const segments = skill.fullPath.replace(/\\/g, "/").split("/");
		const identityLength = segments[segments.length - 1] === SKILL_FILE_NAME ? 2 : 1;
		let node = trie;
		for (const segment of segments.slice(0, -identityLength)) {
			let child = node.children.get(segment);
			if (child === undefined) {
				child = createAliasNode(node === trie ? segment : `${node.path}/${segment}`, node);
				node.children.set(segment, child);
			}
			node = child;
		}
		node.skillIndexes.push(index);
		nodeByIndex[index] = node;
	});
	const rootByIndex = new Map<number, AliasNode>();
	assignRoots(trie, undefined, rootByIndex);
	const membersByRoot = new Map<AliasNode, number[]>();
	skills.forEach((_skill, index) => {
		const root = rootByIndex.get(index);
		if (root === undefined) return;
		const members = membersByRoot.get(root);
		if (members === undefined) membersByRoot.set(root, [index]);
		else members.push(index);
	});
	const roots: string[] = [];
	const aliased = [...skills];
	let savedLength = 0;
	for (const members of membersByRoot.values()) {
		const directoryLength = members.map((index) => nodeByIndex[index]).reduce(commonAncestor).path.length;
		const alias = `$${roots.length}`;
		const root = skills[members[0]].fullPath.slice(0, directoryLength);
		roots.push(root);
		savedLength += members.length * (directoryLength - alias.length) - `${alias} = ${root}\n`.length;
		for (const index of members) {
			aliased[index] = { ...skills[index], fullPath: alias + skills[index].fullPath.slice(directoryLength) };
		}
	}
	if (savedLength <= ALIASING_OVERHEAD) return { roots: [], skills: [...skills] };
	return { roots, skills: aliased };
}
