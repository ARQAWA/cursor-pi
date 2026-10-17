#!/usr/bin/env bun
// Checks Cursor Pi's rules against Cursor Desktop's own code, then checks the request Pi sends for the fullest fixture.
// Usage: bun tools/check-rules.mjs
// Cursor's side comes from tools/cursor-oracle.mjs: LocalCursorRulesService for discovery, and buildRulesPromptSection
// with renderContent for the section. Discovery and the section must match byte for byte.

import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildContextMessageText } from "../extensions/cursor-pi/context-message.ts";
import { discoverCursorRules, renderRulesSection } from "../extensions/cursor-pi/rules.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(ROOT, "tools", "capture-request.mjs");
const RG = Bun.which("rg");
const REQUEST_MODELS = ["openai-codex/gpt-5.6-sol", "anthropic/claude-opus-5-5"];
// Modules whose top-level variables the rules code reads; each one is initialized once in the oracle.
const ORACLE_MODULES = [
	"../prompt-jsx/dist/render.js",
	"../shell-exec/dist/runtime-env/output-suppression.js",
	"../agent/dist/prompts/user-info.js",
	"../agent/dist/utils/cursor-rule-matching.js",
	"../agent/dist/tools/core/shell/prompts/git-sections.js",
	"../agent/dist/prompts/vega-frontend-user-rule.js",
	"../local-exec/dist/services/extensibility/cursor-rules-service.js",
];
// 160 KB of two-byte characters after one ASCII byte: the 100 KB cut lands inside a character.
const BIG_AGENTS = `a${"\u0436".repeat(80_000)}\n`;

async function writeTree(base, files) {
	for (const [relativePath, content] of Object.entries(files)) {
		const file = join(base, relativePath);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
	}
}

async function gitRepo(dir, files) {
	await writeTree(dir, files);
	await execFileAsync("git", ["init", "-q"], { cwd: dir });
}

async function buildFixtures() {
	const base = await realpath(await mkdtemp(join(tmpdir(), "cursor-pi-rules-")));

	const full = join(base, "full");
	const repo = join(full, 'repo "quoted"');
	await writeTree(full, { "AGENTS.md": "Parent agents rule.\n" });
	await gitRepo(repo, {
		".gitignore": "ignored/\n",
		"AGENTS.md": "Root agents rule.\n",
		"CLAUDE.md": 'Claude "quoted" & <tag> rule.\n',
		"CLAUDE.local.md": "Local claude rule.\n",
		".cursorrules": "Legacy cursor rules.\n",
		".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\nAlways rule body.\n",
		".cursor/rules/desc.mdc": '---\ndescription: Use "quotes" when describing things\n---\nDescription rule body.\n',
		".cursor/rules/globs.mdc": "---\nglobs: *.ts,*.tsx\n---\nGlob rule body.\n",
		".cursor/rules/nofront.mdc": "No frontmatter here.\n",
		".cursor/rules/spaced.mdc": "---\nalwaysApply: true\n---\nSpaced   words  here.\n\n    Indented code line.\n\tTabbed line.\n",
		".cursor/rules/manual.mdc": "---\nalwaysApply: false\n---\nManual rule body.\n",
		".cursor/rules/sub/x.mdc": "---\nalwaysApply: true\n---\nNested rules folder body.\n",
		"sub/pkg/AGENTS.md": "Nested package agents rule.\n",
		"sub/pkg/.cursor/rules/nested.mdc": "---\nalwaysApply: true\n---\nNested global rule body.\n",
		"sub/pkg/.cursor/rules/nesteddesc.mdc": "---\ndescription: Nested description rule\n---\nNested description body.\n",
		"sub/.hidden/AGENTS.md": "Hidden folder agents rule.\n",
		"ignored/AGENTS.md": "Gitignored agents rule.\n",
		"node_modules/x/AGENTS.md": "Dependency agents rule.\n",
	});

	const nogit = join(base, "nogit");
	await writeTree(nogit, {
		"AGENTS.md": "Plain agents rule.\n",
		".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\nPlain always body.\n",
		"sub/AGENTS.md": "Plain nested rule.\n",
	});

	const empty = join(base, "empty");
	await gitRepo(empty, { "README.md": "No rules here.\n" });

	const big = join(base, "big");
	await gitRepo(big, { "AGENTS.md": BIG_AGENTS });

	const ignore = join(base, "ignore");
	await gitRepo(ignore, {
		".cursorignore": "CLAUDE.local.md\n# comment\nsecret/\n",
		"AGENTS.md": "Ignore agents rule.\n",
		"CLAUDE.md": "Ignore claude rule.\n",
		"CLAUDE.local.md": "Ignored local claude rule.\n",
		"secret/AGENTS.md": "Secret agents rule.\n",
		".cursor/rules/always.mdc": "---\nalwaysApply: true\n---\nIgnore always body.\n",
	});

	return [
		{ name: "full", cwd: repo },
		{ name: "subcwd", cwd: join(repo, "sub", "pkg") },
		{ name: "nogit", cwd: nogit },
		{ name: "empty", cwd: empty },
		{ name: "big", cwd: big },
		{ name: "cursorignore", cwd: ignore },
	];
}

function initIfPresent(cursor, marker) {
	try {
		initModule(cursor, marker);
	} catch (error) {
		if (!String(error.message).startsWith("module not found")) throw error;
	}
}

// Cursor's own rules service and section builder, evaluated from the extracted bundle.
async function cursorSide(root) {
	const cursor = await loadCursor();
	for (const marker of ORACLE_MODULES) initIfPresent(cursor, marker);
	if (typeof cursor.configureRipgrepPath !== "function") throw new Error("oracle has no configureRipgrepPath");
	cursor.configureRipgrepPath(RG);
	const gitExecutor = {
		exec: async (_ctx, cwd, args) => ({ stdout: (await execFileAsync("git", args, { cwd })).stdout }),
	};
	const ctx = cursor.createContext();
	const service = new cursor.LocalCursorRulesService(ctx, gitExecutor, root, true, () => true, undefined, undefined, undefined);
	const rules = await service.getAllCursorRules(ctx);
	const { section } = cursor.buildRulesPromptSection(
		{ cursorRules: rules, env: { workspacePaths: [root] }, featureFlags: {} },
		{ readToolName: "ReadFile" },
	);
	return { rules, text: section === undefined ? "" : cursor.renderContent(section) };
}

function summarizeOurs(rule) {
	return {
		fullPath: rule.fullPath,
		content: rule.content,
		kind: rule.kind,
		globs: rule.kind === "fileGlobbed" ? rule.globs : undefined,
		description: rule.kind === "agentFetched" ? rule.description : undefined,
	};
}

function summarizeCursor(rule) {
	const kind = rule.type?.type.case;
	const value = rule.type?.type.value;
	return {
		fullPath: rule.fullPath,
		content: rule.content,
		kind,
		globs: kind === "fileGlobbed" ? [...value.globs] : undefined,
		description: kind === "agentFetched" ? value.description : undefined,
	};
}

function textDiff(expected, actual) {
	let i = 0;
	while (i < expected.length && expected[i] === actual[i]) i++;
	const snippet = (text) => JSON.stringify(text.slice(Math.max(0, i - 60), i + 160));
	return `  first difference at char ${i} (cursor ${expected.length} chars, ours ${actual.length})\n  cursor: ${snippet(expected)}\n  ours:   ${snippet(actual)}`;
}

async function checkFixture(fixture) {
	const cursor = await cursorSide(fixture.cwd);
	const ours = await discoverCursorRules(fixture.cwd);
	const ourText = renderRulesSection(ours, [fixture.cwd]) ?? "";
	const ourList = ours.map((rule) => JSON.stringify(summarizeOurs(rule)));
	const cursorList = cursor.rules.map((rule) => JSON.stringify(summarizeCursor(rule)));
	const problems = [];
	if (ourList.join("\n") !== cursorList.join("\n")) {
		problems.push(
			[`  discovery differs (cursor ${cursorList.length} rules, ours ${ourList.length})`, ...cursorList.map((line) => `    cursor ${line}`), ...ourList.map((line) => `    ours   ${line}`)].join("\n"),
		);
	}
	if (ourText !== cursor.text) problems.push(`  section differs\n${textDiff(cursor.text, ourText)}`);
	if (problems.length === 0) {
		const section = ourText === "" ? "no section" : `section ${ourText.length} chars`;
		console.log(`ok ${fixture.name}: ${ours.length} rules, ${section}`);
		return 0;
	}
	console.log(`FAIL ${fixture.name}:\n${problems.join("\n")}`);
	return 1;
}

function runBun(args) {
	return new Promise((resolveRun) => {
		const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
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

// Captures what Pi sends for each model and checks the rules message comes first, with the user's prompt after it.
async function checkRequests(fixture, expected) {
	const dir = await mkdtemp(join(tmpdir(), "cursor-pi-rules-request-"));
	let failed = 0;
	for (const model of REQUEST_MODELS) {
		const out = join(dir, `${model.replace("/", "-")}.json`);
		const run = await runBun([CAPTURE, "--model", model, "--cwd", fixture.cwd, "--prompt", "hello", "--out", out]);
		if (run.code !== 0) {
			failed++;
			console.log(`FAIL ${model}: capture-request exit ${run.code}: ${run.stderr.trim().split("\n").pop() ?? ""}`);
			continue;
		}
		const body = JSON.parse(await readFile(out, "utf8")).body;
		const items = Array.isArray(body.input) ? body.input : Array.isArray(body.messages) ? body.messages : [];
		const problems = [];
		const first = items[0];
		if (first?.role !== "user") problems.push(`first item role is ${first?.role}`);
		if (textOf(first?.content) !== expected) {
			problems.push(`first user item is not the rules message (starts ${JSON.stringify(textOf(first?.content).slice(0, 80))})`);
		}
		const next = items.slice(1).find((item) => item?.role === "user");
		if (textOf(next?.content) !== "hello") problems.push(`next user item text is ${JSON.stringify(textOf(next?.content))}`);
		if (problems.length === 0) {
			console.log(`ok ${model}`);
		} else {
			failed++;
			console.log(`FAIL ${model}: ${problems.join("; ")}`);
		}
	}
	return failed;
}

if (!RG) {
	console.log("FAIL: ripgrep (rg) is not on PATH");
	process.exit(1);
}

const fixtures = await buildFixtures();
let failed = 0;
for (const fixture of fixtures) {
	try {
		failed += await checkFixture(fixture);
	} catch (error) {
		failed++;
		console.log(`FAIL ${fixture.name}: ${error?.stack ?? error}`);
	}
}
const full = fixtures[0];
const expected = buildContextMessageText({ rules: renderRulesSection(await discoverCursorRules(full.cwd), [full.cwd]) });
failed += await checkRequests(full, expected);
process.exit(failed === 0 ? 0 : 1);
