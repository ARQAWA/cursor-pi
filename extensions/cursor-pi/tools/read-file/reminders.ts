import { minimatch } from "minimatch";
import type { CursorRule } from "../../rules.ts";
import { IDE_SKILL_ENVIRONMENT, isEnvironmentEligible, skillMatchesReadPath, type DiscoveredSkill } from "../../skills.ts";

// Cursor's read reminders: the rules and skills whose globs, or whose folder, cover a file the model reads for the first
// time in a session. Matching follows Cursor's cursor-rule-matching behavior on POSIX-style paths.

function normalizeToUnixPath(value: string): string {
	return value.replace(/\\/g, "/");
}

function normalizeDir(value: string): string {
	const normalized = posixNormalize(normalizeToUnixPath(value));
	if (normalized === "/") return "/";
	return normalized.replace(/\/+$/, "");
}

function posixNormalize(path: string): string {
	const absolute = path.startsWith("/");
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
			else if (!absolute) parts.push("..");
			continue;
		}
		parts.push(part);
	}
	const joined = parts.join("/");
	if (absolute) return `/${joined}`;
	return joined === "" ? "." : joined;
}

function posixDirname(path: string): string {
	const index = path.lastIndexOf("/");
	if (index === -1) return ".";
	if (index === 0) return "/";
	return path.slice(0, index);
}

// The folder that holds the .cursor/rules folder a rule file is in, or the folder of the file itself.
function ruleDirOf(rulePath: string): string {
	const literalDir = posixNormalize(posixDirname(normalizeToUnixPath(rulePath)));
	const segments = literalDir.split("/");
	for (let i = segments.length - 2; i >= 0; i--) {
		if (segments[i] === ".cursor" && segments[i + 1] === "rules") {
			const parent = segments.slice(0, i);
			if (parent.length === 0) return "/";
			return parent.join("/");
		}
	}
	return literalDir;
}

function isWithinDir(path: string, dir: string): boolean {
	const normalizedDir = normalizeDir(dir);
	if (normalizedDir === "/") return path.startsWith("/");
	return path === normalizedDir || path.startsWith(`${normalizedDir}/`);
}

// A nested rule (a rule under a subfolder of a workspace) is file-scoped; a rule at the workspace root is not.
function isNestedGlobalRule(rule: CursorRule, workspacePaths: readonly string[]): boolean {
	if (rule.kind !== "global") return false;
	const ruleDir = normalizeDir(ruleDirOf(rule.fullPath));
	const root = workspacePaths.map(normalizeDir).find((workspaceRoot) => isWithinDir(ruleDir, workspaceRoot));
	if (root === undefined) return false;
	return ruleDir !== root;
}

function isFileScopedRule(rule: CursorRule, workspacePaths: readonly string[]): boolean {
	if (rule.kind === "fileGlobbed") return true;
	return isNestedGlobalRule(rule, workspacePaths);
}

function doesRuleMatchPath(rule: CursorRule, readPath: string): boolean {
	const normalizedReadPath = normalizeDir(readPath);
	const ruleDir = normalizeDir(ruleDirOf(rule.fullPath));
	if (rule.kind === "fileGlobbed") {
		const relativeCandidate = isWithinDir(normalizedReadPath, ruleDir) ? normalizedReadPath.slice(ruleDir.length + 1) : undefined;
		return rule.globs.some((globPattern) => {
			const glob = normalizeToUnixPath(globPattern);
			if (glob.startsWith("/")) return minimatch(normalizedReadPath, glob, { dot: true });
			return relativeCandidate !== undefined ? minimatch(relativeCandidate, glob, { dot: true }) : false;
		});
	}
	if (rule.kind === "global") return isWithinDir(normalizedReadPath, ruleDir);
	return false;
}

// Cursor's matchFileScopedRulesToReadPaths for one read: rule path to the read paths it matches.
function matchFileScopedRules(rules: readonly CursorRule[], readPath: string, workspacePaths: readonly string[]): Map<string, string[]> {
	const matches = new Map<string, string[]>();
	for (const rule of rules) {
		if (!isFileScopedRule(rule, workspacePaths)) continue;
		if (!doesRuleMatchPath(rule, readPath)) continue;
		const existing = matches.get(rule.fullPath);
		if (existing) existing.push(readPath);
		else matches.set(rule.fullPath, [readPath]);
	}
	return matches;
}

export interface RelatedRulesInput {
	rules: readonly CursorRule[];
	readPath: string;
	workspacePaths: readonly string[];
	// Paths already seen in this session, read files and rule files alike. New rules are added to it.
	seen: Set<string>;
}

// The rules to remind about for this read, sorted by path as Cursor sorts them. Rules already seen are skipped.
export function relatedCursorRules({ rules, readPath, workspacePaths, seen }: RelatedRulesInput): CursorRule[] {
	const matches = matchFileScopedRules(rules, readPath, workspacePaths);
	if (matches.size === 0) return [];
	const ruleByPath = new Map(rules.map((rule) => [rule.fullPath, rule] as const));
	const related: CursorRule[] = [];
	for (const rulePath of [...matches.keys()].sort()) {
		if (seen.has(rulePath)) continue;
		const rule = ruleByPath.get(rulePath);
		if (rule === undefined) continue;
		related.push(rule);
		seen.add(rulePath);
	}
	return related;
}

// Cursor's renderCursorRuleReminder.
export function renderCursorRuleReminder(rules: readonly CursorRule[]): string | undefined {
	if (rules.length === 0) return undefined;
	const blocks = rules.map((rule) => {
		const content = rule.content.trimEnd();
		const body = content.length > 0 ? content : "(Rule file is empty.)";
		const rulePath = rule.fullPath || "(unknown rule path)";
		return `- ${rulePath}\n${body}`;
	});
	return ["The following cursor rule files are relevant to the files you just read:", ...blocks, "Consider these rules if they affect your changes."].join("\n\n");
}

export interface SkillReminder {
	fullPath: string;
	description: string | undefined;
}

export interface RelatedSkillsInput {
	skills: readonly DiscoveredSkill[];
	readPath: string;
	workspacePaths: readonly string[];
	// Paths already seen in this session. Skills are marked here under their reminder key, beside the read paths and rules.
	seen: Set<string>;
}

// Cursor's reminder key for a skill, kept in the same seen set as the read paths and the rule files.
const SKILL_REMINDER_PREFIX = "__skill_reminder__:";

// Cursor's skill matching for one read: the skills for this IDE that the model may invoke and that apply to the read path,
// sorted by path as Cursor sorts them. Skills already reminded of in the session are skipped.
export function relatedSkills({ skills, readPath, workspacePaths, seen }: RelatedSkillsInput): DiscoveredSkill[] {
	const matches = new Map<string, DiscoveredSkill>();
	for (const skill of skills) {
		if (!isEnvironmentEligible(skill, IDE_SKILL_ENVIRONMENT)) continue;
		if (skill.disableModelInvocation || skill.parseError) continue;
		if (matches.has(skill.fullPath)) continue;
		if (!skillMatchesReadPath(skill, readPath, workspacePaths)) continue;
		matches.set(skill.fullPath, skill);
	}
	const related: DiscoveredSkill[] = [];
	for (const [skillPath, skill] of [...matches.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		const key = `${SKILL_REMINDER_PREFIX}${skillPath}`;
		if (seen.has(key)) continue;
		related.push(skill);
		seen.add(key);
	}
	return related;
}

// Cursor's renderSkillReminder.
export function renderSkillReminder(skills: readonly SkillReminder[]): string | undefined {
	if (skills.length === 0) return undefined;
	const blocks = skills.map((skill) => `- ${skill.fullPath}\n${skill.description || "(No description)"}`);
	return ["The following skills may be relevant to the files you just read:", ...blocks].join("\n\n");
}
