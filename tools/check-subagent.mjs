#!/usr/bin/env bun
// Checks the Subagent tool against Cursor Desktop 3.25.6's captures. Catalog: the captured parent sections, and the models list
// with Cursor Pi's models. Declaration: the captured Subagent.json. Then, through Cursor Pi with tools/capture-session.mjs and a
// fake provider, an explore run and a bugbot run (readonly): the child's tools, system prompt, reminders and query; the parent's
// first request with the catalogs; the result text the parent receives; the child's transcript. Argument errors are checked too.
// Exits non-zero on any FAIL. Usage: BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun tools/check-subagent.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScriptedSession } from "./capture-session.mjs";
import { getDynamicTool } from "../extensions/cursor-pi/dynamic/registry.ts";
import { promptForModel, SUPPORTED_MODELS } from "../extensions/cursor-pi/prompts.ts";
import { DEFAULT_SUBAGENT_REMINDER, renderAvailableSubagentModels, renderAvailableSubagentTypes, SUBAGENT_CONFIGS } from "../extensions/cursor-pi/subagents/config.ts";
import { subagentFinishedNotice } from "../extensions/cursor-pi/background/subagent-notice.ts";
import { registerSubagent } from "../extensions/cursor-pi/subagents/tool.ts";
import { executeGlob } from "../extensions/cursor-pi/tools/glob.ts";
import { executeReadFile } from "../extensions/cursor-pi/tools/read-file.ts";
import { executeRg } from "../extensions/cursor-pi/tools/rg.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const REVERSE = path.join(ROOT, "research", "cursor", "reverse");
const MODELS = ["openai-codex/gpt-5.6-sol", "anthropic/claude-opus-5-5"];

let passed = 0;
const failed = [];
function report(name, ok, detail = "") {
	if (ok) {
		passed += 1;
		console.log(`ok - ${name}`);
		return;
	}
	failed.push(name);
	console.log(`FAIL - ${name}${detail === "" ? "" : `\n${detail}`}`);
}

// The captured section, read on its own so the check does not trust the module it checks.
function capturedSection(file, tag) {
	const text = readFileSync(path.join(REVERSE, file), "utf8");
	const start = text.indexOf(`<${tag}>`);
	const end = text.indexOf(`</${tag}>`, start);
	return start < 0 || end < 0 ? undefined : text.slice(start, end + `</${tag}>`.length);
}
const capturedText = (file) => readFileSync(path.join(REVERSE, file), "utf8");
const PARENT_CAPTURE = "runs-2026-10-16-T3/items/002-S1-user-f2fc311e.txt";

// The system text and the user messages of a request, for either provider's body shape.
function systemOf(body) {
	if (typeof body?.instructions === "string") return body.instructions;
	if (typeof body?.system === "string") return body.system;
	return (body?.system ?? []).map((block) => block.text ?? "").join("\n");
}
function userTexts(body) {
	const items = Array.isArray(body?.input) ? body.input : Array.isArray(body?.messages) ? body.messages : [];
	return items
		.filter((item) => item.role === "user")
		.map((item) => (typeof item.content === "string" ? item.content : (item.content ?? []).map((part) => part.text ?? "").join("")));
}
const toolNames = (body) => (body?.tools ?? []).map((tool) => tool.name ?? tool.function?.name).sort();
const sortedEqual = (ours, expected) => JSON.stringify(ours) === JSON.stringify([...expected].sort());

// A user_info with its environment values normalized: paths, the date, the git repo line, the store and skill lists, the rules
// and git status bodies, and the MCP namespaces, which are the user's own servers. Everything else must match.
function normalizeUserInfo(text) {
	return text
		.trimEnd()
		.replace(/<rules>[\s\S]*?<\/rules>/g, "<rules/>")
		.replace(/<git_status>[\s\S]*?<\/git_status>/g, "<git_status/>")
		.replace(/<available_skills[^>]*>[\s\S]*?<\/available_skills>/g, "<available_skills/>")
		.replace(/<namespace name="(?:(?!<namespace )[\s\S])*?source="mcp" \/>/g, "")
		.replace(/Is directory a git repo: [^\n]*/g, "Is directory a git repo: <GIT>")
		.replace(/Today's date: [^\n]*/g, "Today's date: <DATE>")
		.replace(/(Current agent's store|User's personal store): \/[^\n]*/g, "$1: <STORE>")
		.replace(/use \/[^\n]*?\. Only use/g, "use <STORE>. Only use")
		.replace(/(?<!<)\/[^\s"<>()\[\]`]+/g, "<PATH>")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.join("\n");
}

// The first line where two texts differ, for a failure message.
function firstDifference(expected, actual) {
	const a = expected.split("\n");
	const b = actual.split("\n");
	let i = 0;
	while (i < a.length && a[i] === b[i]) i++;
	return i === a.length && i === b.length ? "" : `  first difference at line ${i + 1}\n  capture: ${JSON.stringify(a[i])}\n  ours:    ${JSON.stringify(b[i])}`;
}

// Catalog and declaration.
const types = renderAvailableSubagentTypes();
report("types catalog is Cursor's captured <available_subagent_types> section", types === capturedSection(PARENT_CAPTURE, "available_subagent_types"));
const models = renderAvailableSubagentModels();
const modelLines = models.split("\n");
report("models catalog lists inherit and Cursor Pi's supported models only",
	modelLines.includes("- inherit (default; required unless the user explicitly requested another model)") &&
		SUPPORTED_MODELS.every((slug) => modelLines.includes(`- ${slug}`)) &&
		!modelLines.includes("- gpt-5.5-medium") && models.endsWith("</available_subagent_models>"));
registerSubagent();
const entry = getDynamicTool("cursor", "Subagent");
const captured = JSON.parse(capturedText("prompts/tools/cursor-namespace/Subagent.json"));
report("Subagent is registered in the cursor namespace with the captured declaration",
	entry !== undefined && entry.declaration.description === captured.description &&
		JSON.stringify(entry.declaration.parameters) === JSON.stringify(captured.inputSchema));

// Scripted sessions.
async function run(model, turns, prompt, cwd) {
	const home = await mkdtemp(path.join(os.tmpdir(), "cursor-pi-subagent-home-"));
	const result = await runScriptedSession({ model, cwd, prompt, turns, homeDir: home });
	return { ...result, home };
}
async function transcriptFiles(dir) {
	const found = [];
	for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) found.push(...(await transcriptFiles(full)));
		else if (entry.name.endsWith(".jsonl") && full.includes(`${path.sep}subagents${path.sep}`)) found.push(full);
	}
	return found;
}

const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-subagent-cwd-")));
// The captured workspace was a git repository with a skill, so the workspace here is one too. The captures were taken with zsh.
execFileSync("git", ["init", "-q"], { cwd });
await mkdir(path.join(cwd, ".cursor", "skills", "check-skill"), { recursive: true });
await writeFile(path.join(cwd, ".cursor", "skills", "check-skill", "SKILL.md"), "---\ndescription: Check skill.\n---\nCheck body.\n");
process.env.SHELL = "/bin/zsh";
const EXPLORE_QUERY = "Find the README file.";
const EXPLORE_TURNS = [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Find README", subagent_type: "explore", prompt: EXPLORE_QUERY } } }] },
	{ text: "README.md is at the repository root." },
	{ text: "Parent finished." },
];
const BUGBOT_PROMPT = "Full Repository Path: /tmp/repo\nDiff: uncommitted changes";
const BUGBOT_TURNS = [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Bugbot", subagent_type: "bugbot", prompt: BUGBOT_PROMPT } } }] },
	{ text: "<answer></answer>" },
	{ text: "No bugs found." },
];

for (const model of MODELS) {
	const modelId = model.slice(model.indexOf("/") + 1);
	const explore = await run(model, EXPLORE_TURNS, "Find the README.", cwd);
	report(`${model}: explore: Cursor Pi exits 0 without errors`, explore.code === 0 && explore.errors.length === 0,
		`  exit ${explore.code}; errors: ${explore.errors.join(" | ")}\n${explore.stderr.slice(-800)}`);
	report(`${model}: explore: three requests (parent, child, parent)`, explore.requests.length === 3, `  requests: ${explore.requests.length}`);
	const parentFirst = explore.requests[0]?.body;
	report(`${model}: explore: the parent's context carries both catalogs in order`,
		userTexts(parentFirst)[0]?.includes(types) === true && userTexts(parentFirst)[0]?.includes(models) === true);
	const child = explore.requests[1]?.body;
	report(`${model}: explore: the child runs the child model`, child?.model === modelId, `  model: ${child?.model}`);
	report(`${model}: explore: the child has Glob, rg, ReadFile and UpdateCurrentStep`,
		sortedEqual(toolNames(child), ["Glob", "rg", "ReadFile", "UpdateCurrentStep"]), `  tools: ${JSON.stringify(toolNames(child))}`);
	report(`${model}: explore: the child's system prompt is the model's prompt`, systemOf(child) === promptForModel(modelId)?.text);
	const childUsers = userTexts(child);
	report(`${model}: explore: the child's user_info has no git status`, childUsers[0]?.includes("<user_info>") && !childUsers[0].includes("<git_status>"));
	if (model === MODELS[0]) {
		// The captured explore child ran on gpt-5.6-sol, so its user_info carries the names-a-skill preamble.
		const NOT_PORTED = ["ConnectScm", "SetActiveBranch", "SwitchMode"];
		// The capture's cursor namespace lists ConnectScm, SetActiveBranch and SwitchMode, which we do not port (they need Cursor's
		// servers, and Plan mode is excluded): they are taken out of the capture before the comparison, a recorded difference.
		const expectedInfo = normalizeUserInfo(capturedText("prompts/items/context-b315a735c81c.md").replace(
			/<namespace name="cursor" tools="([^"]*)"/,
			(_match, names) => `<namespace name="cursor" tools="${names.split(", ").filter((name) => !NOT_PORTED.includes(name)).join(", ")}"`,
		).replace(new RegExp(`^- (${NOT_PORTED.join("|")}): .*\n`, "gm"), ""));
		const oursInfo = normalizeUserInfo(childUsers[0] ?? "");
		report(`${model}: explore: the child's user_info is Cursor's captured explore user_info, normalized`, oursInfo === expectedInfo, firstDifference(expectedInfo, oursInfo));
	} else {
		report(`${model}: explore: the child's user_info has the default skill preamble`,
			childUsers[0]?.includes("When users ask you to perform tasks") === true && !childUsers[0].includes("When the user names a skill"));
	}
	const last = childUsers[childUsers.length - 1] ?? "";
	report(`${model}: explore: the reminder shares the query message, before the timestamp`,
		last.startsWith("<system_reminder>\nYou are running as a subagent") && last.includes("You are a file search specialist") &&
			last.includes("<progress_reporting_instructions>") && last.includes(`</system_reminder>\n<timestamp>`) &&
			last.endsWith(`<user_query>\n${EXPLORE_QUERY}\n</user_query>`));
	const parentSecond = JSON.stringify(explore.requests[2]?.body ?? null);
	report(`${model}: explore: the parent receives the result text with its agent id`,
		parentSecond.includes("This is the output of the subagent:") && parentSecond.includes("README.md is at the repository root.") &&
			parentSecond.includes("Agent ID: "));
	const transcripts = await transcriptFiles(explore.home);
	const transcript = transcripts.length > 0 ? await readFile(transcripts[0], "utf8") : "";
	report(`${model}: explore: the child transcript is written under <parent>/subagents`,
		transcripts.length === 1 && transcript.includes("README.md is at the repository root.") && transcript.includes(`"type":"turn_ended"`),
		`  transcripts: ${transcripts.join(", ")}`);

	const bugbot = await run(model, BUGBOT_TURNS, "Review my changes.", cwd);
	report(`${model}: bugbot: Cursor Pi exits 0 without errors`, bugbot.code === 0 && bugbot.errors.length === 0,
		`  exit ${bugbot.code}; errors: ${bugbot.errors.join(" | ")}\n${bugbot.stderr.slice(-800)}`);
	const bugChild = bugbot.requests[1]?.body;
	report(`${model}: bugbot: the child's system prompt is Cursor's bugbot prompt`,
		systemOf(bugChild) === capturedText("runs-2026-10-16-T3/roles/03-bugbot-developer-prompt.txt").trim());
	report(`${model}: bugbot: the child has Glob, rg, ReadFile and WebSearch`, sortedEqual(toolNames(bugChild), ["Glob", "rg", "ReadFile", "WebSearch"]),
		`  tools: ${JSON.stringify(toolNames(bugChild))}`);
	const bugUsers = userTexts(bugChild);
	report(`${model}: bugbot: the child's messages are user_info, ask mode, the subagent reminder, then the query`,
		bugUsers.length === 4 && bugUsers[0].includes("<user_info>") &&
			bugUsers[1] === capturedText("runs-2026-10-16-T3/roles/07-ask-mode-reminder-seen-in-bugbot.txt").trim() &&
			bugUsers[2] === `<system_reminder>\n${"You are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions. Do not create Cursor Canvas files unless requested by the user or by your instructions."}\n</system_reminder>` &&
			bugUsers[3].endsWith(`<user_query>\n${BUGBOT_PROMPT}\n</user_query>`),
		`  messages: ${bugUsers.map((text) => text.slice(0, 60)).join(" | ")}`);
	report(`${model}: bugbot: the child's user_info has no dynamic_tool_catalog`, bugUsers[0]?.includes("<user_info>") === true && !bugUsers[0].includes("dynamic_tool_catalog"));
}

// generalPurpose and explore's tool calls, end to end. The explore child's tool results must be what the tools return when run
// directly in the same fixture workspace.
const GENERAL_TEXT = "The project is a Pi extension.";
const GENERAL_TURNS = [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Summarize", subagent_type: "generalPurpose", prompt: "Summarize the project." } } }] },
	{ text: GENERAL_TEXT },
	{ text: "Parent finished." },
];
const FIXTURE_FINAL = "greet is defined in src/app.ts.";
const GLOB_ARGS = { glob_pattern: "src/*.ts" };
const RG_ARGS = { pattern: "greet", output_mode: "content" };
const READ_ARGS = { path: "src/app.ts" };
const TOOLS_TURNS = [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Find greet", subagent_type: "explore", prompt: "Find where greet is defined." } } }] },
	{ calls: [{ name: "Glob", arguments: GLOB_ARGS }] },
	{ calls: [{ name: "rg", arguments: RG_ARGS }] },
	{ calls: [{ name: "ReadFile", arguments: READ_ARGS }] },
	{ text: FIXTURE_FINAL },
	{ text: "The subagent found it." },
];
const fixture = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-subagent-fixture-")));
await mkdir(path.join(fixture, "src"), { recursive: true });
await writeFile(path.join(fixture, "README.md"), "# Fixture\n");
await writeFile(path.join(fixture, "src", "app.ts"), 'export function greet(name: string): string {\n\treturn "hello " + name;\n}\n');
await writeFile(path.join(fixture, "src", "util.ts"), 'export const VERSION = "1.0.0";\n');

// The text of each tool result a request carries, in order, for either provider's body shape.
function toolOutputs(body) {
	const textOf = (content) => (typeof content === "string" ? content : (content ?? []).map((part) => part.text ?? "").join(""));
	if (Array.isArray(body?.input)) return body.input.filter((item) => item.type === "function_call_output").map((item) => textOf(item.output));
	return (body?.messages ?? []).flatMap((message) => (Array.isArray(message.content) ? message.content : []).filter((part) => part.type === "tool_result").map((part) => textOf(part.content)));
}

// The three tools run directly in the fixture. ReadFile's reminders depend on the HOME the child ran with, so HOME is set to it.
async function directToolTexts(root, home) {
	const saved = process.env.HOME;
	process.env.HOME = home;
	try {
		const ctx = { cwd: root, sessionManager: {} };
		const glob = await executeGlob(GLOB_ARGS, undefined, ctx);
		const rg = await executeRg(RG_ARGS, undefined, ctx);
		const read = await executeReadFile(READ_ARGS, undefined, ctx);
		return [glob, rg, read].map((result) => result.content[0].text);
	} finally {
		if (saved === undefined) delete process.env.HOME;
		else process.env.HOME = saved;
	}
}

for (const model of MODELS) {
	const general = await run(model, GENERAL_TURNS, "Summarize the project.", cwd);
	report(`${model}: generalPurpose: Cursor Pi exits 0 without errors`, general.code === 0 && general.errors.length === 0,
		`  exit ${general.code}; errors: ${general.errors.join(" | ")}\n${general.stderr.slice(-800)}`);
	report(`${model}: generalPurpose: three requests (parent, child, parent)`, general.requests.length === 3, `  requests: ${general.requests.length}`);
	report(`${model}: generalPurpose: the child's first request carries tools`, toolNames(general.requests[1]?.body).length > 0,
		`  tools: ${JSON.stringify(toolNames(general.requests[1]?.body))}`);
	const generalParent = JSON.stringify(general.requests[2]?.body ?? null);
	report(`${model}: generalPurpose: the parent receives the result text with its agent id`,
		generalParent.includes("This is the output of the subagent:") && generalParent.includes(GENERAL_TEXT) && generalParent.includes("Agent ID: "));

	const tools = await run(model, TOOLS_TURNS, "Find greet in the fixture.", fixture);
	report(`${model}: explore tools: Cursor Pi exits 0 without errors`, tools.code === 0 && tools.errors.length === 0,
		`  exit ${tools.code}; errors: ${tools.errors.join(" | ")}\n${tools.stderr.slice(-800)}`);
	report(`${model}: explore tools: six requests (parent, four child, parent)`, tools.requests.length === 6, `  requests: ${tools.requests.length}`);
	const direct = await directToolTexts(fixture, tools.home);
	// The last child request carries every tool result so far, in the order the child made the calls.
	const childResults = toolOutputs(tools.requests[4]?.body);
	report(`${model}: explore tools: each tool result the child sees is the direct execute output`,
		JSON.stringify(childResults) === JSON.stringify(direct),
		`  child: ${JSON.stringify(childResults)}\n  direct: ${JSON.stringify(direct)}`);
	const toolsParent = toolOutputs(tools.requests[5]?.body);
	report(`${model}: explore tools: the parent receives the child's final text in Cursor's result text`,
		toolsParent.some((text) => text.includes(`This is the output of the subagent:\n\nresponse:\n<response>\n${FIXTURE_FINAL}\n</response>\n\nAgent ID: `)));
}

// Argument errors: nothing reaches the child, and the parent's next request carries the error.
const unknown = await run(MODELS[0], [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Probe", subagent_type: "nope", prompt: "Hi" } } }] },
	{ text: "Understood." },
], "Probe.", cwd);
report("an unknown subagent_type fails the call with the enum message", unknown.requests.length === 2 &&
	JSON.stringify(unknown.requests[1]?.body ?? null).includes("Invalid enum value. Expected 'generalPurpose' | 'explore'"),
	`  requests: ${unknown.requests.length}`);

// Cursor's child tool sets and reminders, from the config and the captures.
const sortedList = (list) => [...list].sort();
const configTools = (type) => sortedList(SUBAGENT_CONFIGS[type].tools);
const REMINDER_HEAD = `<system_reminder>\n${DEFAULT_SUBAGENT_REMINDER}\n\n`;
function capturedReminder(file) {
	const text = capturedText(file).trim();
	return text.slice(REMINDER_HEAD.length, text.lastIndexOf("\n</system_reminder>")).trim();
}
report("bugbot and security-review carry WebSearch in Cursor's captured child sets",
	JSON.stringify(configTools("bugbot")) === JSON.stringify(sortedList(["Glob", "rg", "ReadFile", "WebSearch"])) &&
		JSON.stringify(configTools("security-review")) === JSON.stringify(sortedList(["Glob", "rg", "ReadFile", "UpdateCurrentStep", "WebSearch"])));
report("cursor-guide: readonly, ReadFile, rg, WebFetch, WebSearch and UpdateCurrentStep, with Cursor's captured reminder",
	SUBAGENT_CONFIGS["cursor-guide"].readonly === true &&
		JSON.stringify(configTools("cursor-guide")) === JSON.stringify(sortedList(["ReadFile", "rg", "WebFetch", "WebSearch", "UpdateCurrentStep"])) &&
		SUBAGENT_CONFIGS["cursor-guide"].reminderParts().join("\n\n") === capturedReminder("runs-2026-10-16/sol/roles/cursor-guide.md"));
report("ci-investigator: Cursor's captured reminder, and the full tool set with its edit tools by model",
	SUBAGENT_CONFIGS["ci-investigator"].reminderParts().join("\n\n") === capturedReminder("runs-2026-10-16/sol/roles/ci-investigator.md") &&
		JSON.stringify(configTools("ci-investigator")) === JSON.stringify(sortedList(["Shell", "Glob", "rg", "ReadFile", "EditTools", "GetDynamicTools", "CallDynamicTool", "UpdateCurrentStep"])));
report("best-of-n-runner: the full tool set, with no reminder beyond the default",
	JSON.stringify(configTools("best-of-n-runner")) === JSON.stringify(sortedList(["Shell", "Glob", "rg", "ReadFile", "EditTools", "GetDynamicTools", "CallDynamicTool"])) &&
		SUBAGENT_CONFIGS["best-of-n-runner"].reminderParts().length === 0);

// The completion notice against Cursor's captured notification (a subagent that finished with its result).
const noticeText = capturedText("prompts/items/notification-3052c1ecc533.md");
const capturedField = (name) => noticeText.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1];
const detailStart = noticeText.indexOf("detail: ") + "detail: ".length;
const completion = subagentFinishedNotice({
	agentId: capturedField("task_id"),
	toolCallId: capturedField("tool_call_id"),
	title: capturedField("title"),
	outcome: { status: "success", text: noticeText.slice(detailStart, noticeText.indexOf("\n</task>")) },
});
const capturedSystem = noticeText.slice(noticeText.indexOf("<system_notification>"), noticeText.indexOf("</system_notification>") + "</system_notification>".length);
const capturedAck = noticeText.slice(noticeText.indexOf("<user_query>"), noticeText.indexOf("</user_query>") + "</user_query>".length);
report("the subagent completion notice is Cursor's captured notification", completion.body === capturedSystem);
report("the subagent completion acknowledgement is Cursor's captured query", completion.acknowledgement === capturedAck);

// cursor-guide, on the Anthropic model: its child carries WebFetch and WebSearch directly, and Cursor's guide reminder.
const guide = await run(MODELS[1], [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Guide", subagent_type: "cursor-guide", prompt: "How do I open a terminal?" } } }] },
	{ text: "Use the terminal shortcut." },
	{ text: "The guide answered." },
], "How do I open a terminal in Cursor?", cwd);
const guideChild = guide.requests[1]?.body;
report("cursor-guide: the child has ReadFile, rg, WebFetch, WebSearch and UpdateCurrentStep, and the guide reminder",
	guide.code === 0 && guide.errors.length === 0 && sortedEqual(toolNames(guideChild), ["ReadFile", "rg", "WebFetch", "WebSearch", "UpdateCurrentStep"]) &&
		userTexts(guideChild).some((text) => text.includes("You are a Cursor product documentation specialist")),
	`  exit ${guide.code}; errors: ${guide.errors.join(" | ")}\n${guide.stderr.slice(-800)}\n  tools: ${JSON.stringify(toolNames(guideChild))}`);

// ci-investigator, on the Anthropic model: the full tool set, with StrReplace and Write, and its captured reminder.
const ci = await run(MODELS[1], [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "CI check", subagent_type: "ci-investigator", prompt: "Investigate the build-linux check." } } }] },
	{ text: "**Root cause:** unknown" },
	{ text: "The check was summarized." },
], "Why did CI fail?", cwd);
const ciChild = ci.requests[1]?.body;
report("ci-investigator: the child has the full tool set, with StrReplace and Write for Anthropic",
	ci.code === 0 && sortedEqual(toolNames(ciChild), ["Shell", "Glob", "rg", "ReadFile", "StrReplace", "Write", "GetDynamicTools", "CallDynamicTool", "UpdateCurrentStep"]),
	`  exit ${ci.code}; errors: ${ci.errors.join(" | ")}\n${ci.stderr.slice(-800)}\n  tools: ${JSON.stringify(toolNames(ciChild))}`);
report("ci-investigator: the child's reminder is Cursor's captured ci-investigator text", userTexts(ciChild).some((text) => text.includes("You are a CI failure investigator.")));

// browser-use, on the Anthropic model: the cursor-ide-browser tools as direct tools with the local context tools, the browser namespace
// in the child's catalog, and Cursor's captured browser-use reminder as the child's own message.
const browserUse = await run(MODELS[1], [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Browse", subagent_type: "browser-use", prompt: "Open the page." } } }] },
	{ text: "The page is open." },
	{ text: "The browser task finished." },
], "Check the page.", cwd);
const browserChild = browserUse.requests[1]?.body;
const browserUsers = userTexts(browserChild);
const browserToolNames = JSON.parse(readFileSync(path.join(ROOT, "extensions", "cursor-pi", "tools", "generated", "browser-tools.json"), "utf8")).tools.map((tool) => tool.name);
report("browser-use: the child has the browser tools with Glob, rg, ReadFile and UpdateCurrentStep",
	browserUse.code === 0 && browserUse.errors.length === 0 &&
		sortedEqual(toolNames(browserChild), [...browserToolNames, "Glob", "rg", "ReadFile", "UpdateCurrentStep"]),
	`  exit ${browserUse.code}; errors: ${browserUse.errors.join(" | ")}\n${browserUse.stderr.slice(-800)}\n  tools: ${JSON.stringify(toolNames(browserChild))}`);
report("browser-use: the child's catalog carries the cursor-ide-browser namespace", browserUsers[0]?.includes('name="cursor-ide-browser"') === true);
report("browser-use: the child's reminder is Cursor's captured browser-use text, as its own message",
	browserUsers.includes(`<system_reminder>\n${DEFAULT_SUBAGENT_REMINDER}\n\n${capturedReminder("runs-2026-10-16/sol/roles/browser-use.md")}\n</system_reminder>`));

// Self-fork: the child starts from the parent's messages, and its answer comes back to the parent.
const SELF_MARKER = "Remember the marker ZETA-7.";
const selfFork = await run(MODELS[0], [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Fork", prompt: "Continue from here.", resume: "self" } } }] },
	{ text: "FORK-DONE" },
	{ text: "The fork reported back." },
], SELF_MARKER, cwd);
const forkChild = JSON.stringify(selfFork.requests[1]?.body ?? null);
report("self-fork: the child's first request carries the parent's history and its own query",
	selfFork.code === 0 && selfFork.errors.length === 0 && forkChild.includes("ZETA-7") && forkChild.includes("Continue from here."),
	`  exit ${selfFork.code}; errors: ${selfFork.errors.join(" | ")}\n${selfFork.stderr.slice(-800)}`);
report("self-fork: the parent receives the fork's answer", JSON.stringify(selfFork.requests[2]?.body ?? null).includes("FORK-DONE"));

// Background: the launch result names the transcript and the agent, and the completion comes back as a subagent notice.
const background = await run(MODELS[0], [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Find LICENSE", subagent_type: "explore", prompt: "Find the LICENSE file.", run_in_background: true } } }] },
	{ calls: [{ name: "Shell", arguments: { command: "sleep 2; echo waited", block_until_ms: 10000 } }] },
	{ text: "Waiting for the background subagent." },
	{ text: "The background subagent reported." },
	{ text: "The notice arrived." },
	{ text: "Done." },
], "Start a background search.", cwd);
const backgroundBodies = background.requests.map((request) => JSON.stringify(request.body));
report("background: the launch result says the subagent runs in the background, with its agent id",
	backgroundBodies.some((body) => body.includes("Subagent is running in the background.") && body.includes("Agent ID: ")));
report("background: the completion arrives as a subagent notice with Cursor's acknowledgement",
	backgroundBodies.some((body) => body.includes("kind: subagent\\nstatus: success") && body.includes("Perform any necessary follow-up actions in response to the subagent completion above.")),
	`  exit ${background.code}; errors: ${background.errors.join(" | ")}`);

// An unknown resume id: Cursor's Error: text, with no agent id.
const missing = await run(MODELS[0], [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Resume", subagent_type: "explore", prompt: "Hi", resume: "missing-agent" } } }] },
	{ text: "Understood." },
], "Resume a missing agent.", cwd);
const missingBody = JSON.stringify(missing.requests[1]?.body ?? null);
report("an unknown resume id: the parent gets Cursor's Error: text, with no agent id",
	missingBody.includes("Error: Subagent session not found: missing-agent") && !missingBody.includes("Agent ID: missing-agent"));

// best-of-n-runner: its own git worktree under the home, the child's workspace is that worktree, and its query starts with the worktree command.
const WORKTREE_COMMAND = "Work only inside your worktree.";
const BEST_OF_N_PROMPT = "Try the fix.";
const BEST_OF_N_TURNS = [
	{ calls: [{ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName: "Subagent", arguments: { description: "Best of n", subagent_type: "best-of-n-runner", prompt: BEST_OF_N_PROMPT } } }] },
	{ text: "Attempt done." },
	{ text: "The runner finished." },
];
const bestRepo = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-subagent-repo-")));
execFileSync("git", ["init", "-q"], { cwd: bestRepo });
execFileSync("git", ["-c", "user.name=check", "-c", "user.email=check@example.com", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: bestRepo });
const bestHome = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-subagent-home-")));
await mkdir(path.join(bestHome, ".cursor-pi", "commands"), { recursive: true });
await writeFile(path.join(bestHome, ".cursor-pi", "commands", "worktree.md"), WORKTREE_COMMAND);
const bestOfN = await runScriptedSession({ model: MODELS[0], cwd: bestRepo, prompt: "Run a best-of-n attempt.", turns: BEST_OF_N_TURNS, homeDir: bestHome });
report(`${MODELS[0]}: best-of-n-runner: Cursor Pi exits 0 without errors`, bestOfN.code === 0 && bestOfN.errors.length === 0,
	`  exit ${bestOfN.code}; errors: ${bestOfN.errors.join(" | ")}\n${bestOfN.stderr.slice(-800)}`);
const worktrees = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: bestRepo }).toString().split("\n")
	.filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length))
	.filter((dir) => dir.startsWith(path.join(bestHome, ".cursor-pi", "worktrees") + path.sep));
report("best-of-n-runner: one git worktree is created under ~/.cursor-pi/worktrees", worktrees.length === 1, `  worktrees: ${worktrees.join(", ")}`);
const bestWorktree = worktrees[0] ?? "";
const bestBranch = bestWorktree === "" ? "" : execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: bestWorktree }).toString().trim();
report("best-of-n-runner: the worktree is on a cursor/ branch", bestBranch.startsWith("cursor/"), `  branch: ${bestBranch}`);
const bestUsers = userTexts(bestOfN.requests[1]?.body);
report("best-of-n-runner: the child's workspace is the worktree", bestUsers[0]?.includes(bestWorktree) === true && bestWorktree !== "");
const BEST_QUERY = `<user_query>\n<cursor_commands>\n--- Cursor Command: worktree ---\n${WORKTREE_COMMAND}\n--- End Command ---\n</cursor_commands>\n\n${BEST_OF_N_PROMPT}\n</user_query>`;
report("best-of-n-runner: the query starts with Cursor's worktree command, then the prompt", (bestUsers.at(-1) ?? "").endsWith(BEST_QUERY),
	`  query: ${JSON.stringify(bestUsers.at(-1))}`);

console.log(`\n${passed} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
