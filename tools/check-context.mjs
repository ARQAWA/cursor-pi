#!/usr/bin/env bun
// Checks Cursor Pi's UserInfo block two ways. E1 renders the same workspace through Cursor Desktop's own UserInfo, run by
// tools/cursor-oracle.mjs from the extracted bundle, and compares the text byte for byte. E2 captures the request Pi sends
// for each model and compares its context message with the GPT-5.5 capture, after normalizing paths, dates, the rules body
// and the git status body. Usage: bun tools/check-context.mjs

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, platform, release, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gitRepoPath, gitStatus } from "../extensions/cursor-pi/git-status.ts";
import { discoverCursorRules } from "../extensions/cursor-pi/rules.ts";
import { discoverAgentSkills } from "../extensions/cursor-pi/skills.ts";
import { friendlyDate, renderUserInfo } from "../extensions/cursor-pi/user-info.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(ROOT, "tools", "capture-request.mjs");
const REFERENCE = join(ROOT, "research", "cursor", "reverse", "runs-2026-10-16-T4", "items", "002-S1-user-06a7b147.txt");
const RG = Bun.which("rg");
const NOW = new Date("2026-10-16T07:25:00Z");
const TIME_ZONE = "UTC";
const REQUEST_MODELS = ["openai-codex/gpt-5.6-sol", "anthropic/claude-opus-5-5"];
const SHELL = "zsh";
// MountedAgentStoreKind values (proto/dist/generated/agent/v1/request_context_exec_pb.js): SELF = 1, PRINCIPAL = 4.
const STORE_SELF = 1;
const STORE_PRINCIPAL = 4;
// AgentType.IDE (agent/dist/utils/agent-config.js).
const AGENT_TYPE_IDE = "ide";
// Modules whose top-level variables the user info code reads; each one is initialized once in the oracle.
const ORACLE_MODULES = [
	"../prompt-jsx/dist/render.js",
	"../shell-exec/dist/runtime-env/output-suppression.js",
	"../agent/dist/prompts/user-info.js",
	"../agent/dist/utils/cursor-rule-matching.js",
	"../agent/dist/tools/core/shell/prompts/git-sections.js",
	"../agent/dist/prompts/vega-frontend-user-rule.js",
	"../local-exec/dist/services/extensibility/cursor-rules-service.js",
];

async function writeTree(base, files) {
	for (const [relativePath, content] of Object.entries(files)) {
		const file = join(base, relativePath);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
	}
}

// A repository with a modified tracked file (its status line starts with a space), an untracked file, rules and skills;
// and a plain folder with rules only. Skills are enough to pass the 2% budget, so shortening and omission run.
async function buildFixtures() {
	const base = await realpath(await mkdtemp(join(tmpdir(), "cursor-pi-context-")));
	const bulk = Object.fromEntries(
		Array.from({ length: 60 }, (_, index) => [
			`.cursor/skills/bulk-${index}/SKILL.md`,
			`---\ndescription: Bulk skill ${index} ${"describes a repeatable check step. ".repeat(12)}\n---\nBody ${index}.\n`,
		]),
	);
	const repo = join(base, "repo");
	await writeTree(repo, {
		"AGENTS.md": "Root agents rule.\n",
		".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\nAlways rule body.\n",
		"tracked.txt": "one\n",
		".cursor/skills/alpha/SKILL.md": "---\ndescription: Alpha skill for checks.\n---\nAlpha body.\n",
		".cursor/skills/hidden/SKILL.md": "---\ndescription: Hidden skill.\ndisable-model-invocation: true\n---\nBody.\n",
		...bulk,
	});
	await execFileAsync("git", ["init", "-q"], { cwd: repo });
	await execFileAsync("git", ["add", "-A"], { cwd: repo });
	await execFileAsync("git", ["-c", "user.name=check", "-c", "user.email=check@example.invalid", "commit", "-qm", "init"], { cwd: repo });
	await writeFile(join(repo, "tracked.txt"), "two\n");
	await writeFile(join(repo, "T3_probe.py"), "print('probe')\n");
	const plain = join(base, "plain");
	await writeTree(plain, {
		"AGENTS.md": "Plain agents rule.\n",
		".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\nPlain always body.\n",
	});
	return [
		{ name: "repo", cwd: repo },
		{ name: "plain", cwd: plain },
	].map((fixture) => ({
		...fixture,
		home: join(base, "home"),
		terminals: join(base, "projects", fixture.name, "terminals"),
		transcripts: join(base, "projects", fixture.name, "agent-transcripts"),
		stores: { self: join(base, "stores", fixture.name, "files"), user: join(base, "stores", "user", "files") },
	}));
}

// Our side: the same inputs the Pi context builder uses, with a fixed date and time zone.
async function ourUserInfo(fixture) {
	const rules = await discoverCursorRules(fixture.cwd);
	const skills = await discoverAgentSkills(fixture.cwd, fixture.home);
	const repoPath = await gitRepoPath(fixture.cwd);
	const status = repoPath === undefined ? undefined : await gitStatus(repoPath);
	const text = renderUserInfo({
		osVersion: `${platform()} ${release()}`,
		shell: SHELL,
		workspacePath: fixture.cwd,
		isWorkingDirHomeDir: false,
		gitRepos: repoPath === undefined ? [] : [{ path: repoPath, status }],
		todaysDate: friendlyDate(NOW, TIME_ZONE),
		terminalsFolder: fixture.terminals,
		agentTranscriptsFolder: fixture.transcripts,
		stores: [
			{ kind: "self", path: fixture.stores.self },
			{ kind: "user", path: fixture.stores.user },
		],
		rules,
		skills,
	});
	return { text, rules, skills, repoPath, status };
}

const gitExecutor = {
	exec: async (_ctx, cwd, args) => ({ stdout: (await execFileAsync("git", args, { cwd })).stdout }),
};

function initIfPresent(cursor, marker) {
	try {
		initModule(cursor, marker);
	} catch (error) {
		if (!String(error.message).startsWith("module not found")) throw error;
	}
}

// Cursor's own UserInfo, rendered by the oracle for the same workspace and the same environment.
async function cursorUserInfo(fixture, ours) {
	const cursor = await loadCursor();
	for (const marker of ORACLE_MODULES) initIfPresent(cursor, marker);
	if (typeof cursor.configureRipgrepPath !== "function") throw new Error("oracle has no configureRipgrepPath");
	cursor.configureRipgrepPath(RG);
	const ctx = cursor.createContext();
	const service = new cursor.LocalCursorRulesService(ctx, gitExecutor, fixture.cwd, true, () => true, undefined, undefined, undefined);
	const cursorRules = await service.getAllCursorRules(ctx);
	return cursor.UserInfo({
		cursorRules,
		agentSkills: ours.skills.map((skill) => ({
			fullPath: skill.fullPath,
			description: skill.description,
			disableModelInvocation: skill.disableModelInvocation,
			environments: skill.environments,
			disabledEnvironments: skill.disabledEnvironments,
			globs: skill.globs,
			scopedTo: [],
		})),
		env: {
			osVersion: `${platform()} ${release()}`,
			shell: SHELL,
			workspacePaths: [fixture.cwd],
			isWorkingDirHomeDir: false,
			timeZone: TIME_ZONE,
			agentTranscriptsFolder: fixture.transcripts,
			processWorkingDirectory: fixture.cwd,
			mountedAgentStores: [
				{ kind: STORE_SELF, path: fixture.stores.self, alias: "", readOnly: false },
				{ kind: STORE_PRINCIPAL, alias: "user", path: fixture.stores.user, readOnly: false },
			],
			devMockPromptTime: { toDate: () => NOW },
		},
		gitRepos: ours.repoPath === undefined ? [] : [{ path: ours.repoPath, status: ours.status }],
		gitRepoInfoComplete: true,
		terminalsFolder: fixture.terminals,
		displayOptions: {
			displayGitStatus: true,
			displayCursorRules: true,
			displaySkills: true,
			includeOnlyUserInfoAndGitStatus: false,
			agentType: AGENT_TYPE_IDE,
		},
		featureFlags: { userMessageTimestamps: true, aliasSkillCatalogPathPrefixes: true, agentStorePathsAdvertisedInPrompt: true },
		toolInfo: { allTools: { READ: { name: "ReadFile" } } },
		dsv3: false,
		useLocalAgentPrompting: false,
	});
}

function textDiff(expected, actual) {
	let i = 0;
	while (i < expected.length && expected[i] === actual[i]) i++;
	const snippet = (text) => JSON.stringify(text.slice(Math.max(0, i - 60), i + 160));
	return `  first difference at char ${i} (cursor ${expected.length} chars, ours ${actual.length})\n  cursor: ${snippet(expected)}\n  ours:   ${snippet(actual)}`;
}

async function checkE1(fixture) {
	const ours = await ourUserInfo(fixture);
	const cursorText = await cursorUserInfo(fixture, ours);
	if (cursorText === ours.text) {
		console.log(`ok E1 ${fixture.name}: ${ours.text.length} chars, ${ours.skills.length} skills, ${ours.rules.length} rules`);
		return 0;
	}
	console.log(`FAIL E1 ${fixture.name}:\n${textDiff(cursorText, ours.text)}`);
	return 1;
}

function runBun(args, env) {
	return new Promise((resolveRun) => {
		const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		child.stdout.resume();
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => resolveRun({ code: 1, stderr: error.message }));
		child.on("close", (code) => resolveRun({ code, stderr }));
	});
}

function textOf(content) {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
	return "";
}

// Paths, store folders, dates, blank lines, and the bodies of the rules and git status are environment data; the rest must match.
function normalize(text) {
	return text
		.trimEnd()
		.replace(/<rules>[\s\S]*?<\/rules>/g, "<rules/>")
		.replace(/<git_status>[\s\S]*?<\/git_status>/g, "<git_status/>")
		.replace(/<agent_skills>[\s\S]*?<\/agent_skills>/g, "")
		.replace(/<available_subagent_types>[\s\S]*?<\/available_subagent_types>/g, "")
		.replace(/<available_subagent_models>[\s\S]*?<\/available_subagent_models>/g, "")
		.replace(/<dynamic_tool_catalog>[\s\S]*?<\/dynamic_tool_catalog>/g, "")
		.replace(/(Current agent's store|User's personal store): \/[^\n]*/g, "$1: <STORE>")
		.replace(/use \/[^\n]*?\. Only use/g, "use <STORE>. Only use")
		.replace(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) [A-Z][a-z]{2} \d{1,2}, \d{4}/g, "<DATE>")
		.replace(/(?<!<)\/[^\s"<>()\[\]`]+/g, "<PATH>")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.join("\n");
}

async function checkE2(fixture, model) {
	const dir = await mkdtemp(join(tmpdir(), "cursor-pi-context-request-"));
	const out = join(dir, "request.json");
	// The reference capture was taken with zsh, so the request is captured with the same shell.
	const run = await runBun([CAPTURE, "--model", model, "--cwd", fixture.cwd, "--prompt", "hello", "--out", out], { ...process.env, SHELL: "/bin/zsh" });
	if (run.code !== 0) {
		console.log(`FAIL E2 ${model} ${fixture.name}: capture-request exit ${run.code}: ${run.stderr.trim().split("\n").pop() ?? ""}`);
		return 1;
	}
	const body = JSON.parse(await readFile(out, "utf8")).body;
	const items = Array.isArray(body.input) ? body.input : Array.isArray(body.messages) ? body.messages : [];
	const ours = normalize(textOf(items[0]?.content));
	const reference = normalize(await readFile(REFERENCE, "utf8"));
	if (ours === reference) {
		console.log(`ok E2 ${model} ${fixture.name}`);
		return 0;
	}
	const ourLines = ours.split("\n");
	const refLines = reference.split("\n");
	const differing = [];
	for (let index = 0; index < Math.max(ourLines.length, refLines.length) && differing.length < 5; index++) {
		if (refLines[index] !== ourLines[index]) {
			differing.push(`  line ${index + 1}\n  capture: ${JSON.stringify(refLines[index])}\n  ours:    ${JSON.stringify(ourLines[index])}`);
		}
	}
	console.log(`FAIL E2 ${model} ${fixture.name}: capture ${refLines.length} lines, ours ${ourLines.length}\n${differing.join("\n")}`);
	return 1;
}

const fixtures = await buildFixtures();
let failed = 0;
for (const fixture of fixtures) {
	try {
		failed += await checkE1(fixture);
	} catch (error) {
		failed++;
		console.log(`FAIL E1 ${fixture.name}: ${error?.stack ?? error}`);
	}
}
for (const model of REQUEST_MODELS) {
	try {
		failed += await checkE2(fixtures[0], model);
	} catch (error) {
		failed++;
		console.log(`FAIL E2 ${model}: ${error?.stack ?? error}`);
	}
}
process.exit(failed === 0 ? 0 : 1);
