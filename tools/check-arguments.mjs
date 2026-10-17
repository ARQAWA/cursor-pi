#!/usr/bin/env bun
// Checks how Cursor Pi's tools handle invalid, null and stringified arguments. For each case, our execute and Cursor Desktop's
// own tool (run through tools/cursor-oracle.mjs) must return the same text and the same error flag. Cursor's failure path is
// its argument parse, then the tool's serializeError and render. Cursor's orchestrator marks every thrown error as an error
// result, so a thrown error is compared with isError true.
// Also checks that each tool is registered with the pass-through schema, so the arguments reach execute unchanged. ApplyPatch
// keeps its grammar carrier.
// Usage: bun tools/check-arguments.mjs

import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAskQuestion } from "../extensions/cursor-pi/tools/ask-question.ts";
import { MAIN_TOOL_ORDER, PASSTHROUGH_PARAMETERS } from "../extensions/cursor-pi/tools/declarations.ts";
import { executeGlob } from "../extensions/cursor-pi/tools/glob.ts";
import { registerAllTools } from "../extensions/cursor-pi/tools/index.ts";
import { executeReadFile } from "../extensions/cursor-pi/tools/read-file.ts";
import { executeRg } from "../extensions/cursor-pi/tools/rg.ts";
import { executeShell } from "../extensions/cursor-pi/tools/shell.ts";
import { executeUpdateCurrentStep } from "../extensions/cursor-pi/tools/update-current-step.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

// Cursor modules whose functions the tools' parse and render paths read.
const ORACLE_MODULES = [
	"../proto/dist/generated/agent/v1/grep_exec_pb.js",
	"../proto/dist/generated/agent/v1/glob_tool_pb.js",
	"../agent/dist/tools/common.js",
	"../agent/dist/tools/core/get-pr-code-tour.js",
	"../agent/dist/tools/core/ripgrep-error-classification.js",
	"../agent/dist/tools/core/grep/formatters.js",
	"../agent/dist/tools/core/grep/pagination.js",
	"../agent/dist/tools/core/grep/cache.js",
	"../agent/dist/tools/core/grep/grep.js",
	"../agent/dist/tools/core/glob/glob.js",
	"../agent/dist/tools/core/shell/shell.js",
	"../agent/dist/tools/core/read/read.js",
	"../agent/dist/tools/lenient-array.js",
	"../agent/dist/tools/core/ask-question/degenerate.js",
	"../agent/dist/tools/core/ask-question/index.js",
	"../agent/dist/tools/meta/update-current-step.js",
];

const cursor = await loadCursor();
for (const marker of ORACLE_MODULES) initModule(cursor, marker);

const root = await realpath(await mkdtemp(join(tmpdir(), "cursor-pi-args-")));

// A parse-error case never reaches an executor, so any executor that is called throws and the case fails.
const unusedExecutor = {
	execute: async () => {
		throw new Error("an executor was reached by a parse-error case");
	},
};
const resourceAccessor = { get: () => unusedExecutor };
const stateHandler = {
	hasCompletedAskQuestion: () => false,
	markAskQuestionCompleted() {},
	getNextMessageIndex: () => 0,
	appendCommunicateUpdateHistoryEntry() {},
	recordReadPath() {},
	getBlobStore() {
		return undefined;
	},
};
const interactionHandler = {
	emitPartialToolCall() {},
	emitToolCallDelta() {},
	rememberToolCallForArgPreservation() {},
	markToolCallForArgPreservation() {},
	emitToolCallError: async () => {},
	recordPendingToolCall: async () => undefined,
	getAbortSignal: () => undefined,
	listener: { query: async () => undefined },
	executeToolCall: async (ctx, _call, _id, run) => run(ctx),
};
const meta = { toolCallId: "call-args-check", workspacePaths: [root], stateHandler };
const RENDER_PROPS = { allTools: {} };
const noDialog = {
	select: async () => {
		throw new Error("a parse-error case opened a dialog");
	},
	input: async () => {
		throw new Error("a parse-error case opened a dialog");
	},
	setStatus() {},
	notify() {},
};

const cursorTools = {
	Glob: () => cursor.createGlobTool(resourceAccessor, "latest"),
	rg: () => cursor.createGrepTool(resourceAccessor, "latest"),
	ReadFile: () => cursor.createReadTool(resourceAccessor, {}, "latest", { enableNegativeOffset: true }),
	Shell: () => cursor.createShellTool(resourceAccessor, { enableBlockUntilMs: true, enableJobProgressNotifications: true }, "latest"),
	AskQuestion: () =>
		cursor.createAskQuestionTool({}, { name: "AskQuestion", useAntiAskQuestionDescription: false, autoRejectFirstAskQuestion: false, getDynamicTools: () => [] }),
	UpdateCurrentStep: () => cursor.createCommunicateUpdateTool(stateHandler, { includeFinalSummary: true }),
};

const ours = {
	Glob: (args) => executeGlob(args, undefined, { cwd: root }),
	rg: (args) => executeRg(args, undefined, { cwd: root }),
	ReadFile: (args) => executeReadFile(args, undefined, { cwd: root, sessionManager: {} }),
	Shell: (args) => executeShell(args, undefined, { cwd: root }),
	AskQuestion: (args) => executeAskQuestion(args, undefined, { hasUI: true, cwd: root, ui: noDialog }),
	UpdateCurrentStep: (args) => executeUpdateCurrentStep(args, undefined, { hasUI: true, cwd: root, ui: { setStatus() {} } }),
};

function streamOf(args) {
	return (async function* () {
		yield JSON.stringify(args);
	})();
}

// Cursor's text for the arguments: the tool's own result, or the rendered serialized error when the parse throws.
async function cursorText(name, args) {
	const tool = cursorTools[name]();
	const ctx = cursor.createContext();
	try {
		const result = await tool.execute(ctx, interactionHandler, streamOf(args), meta);
		const rendered = await tool.render(ctx, result, RENDER_PROPS);
		return { text: rendered.content[0].text, isError: rendered.isError === true };
	} catch (error) {
		const serialized = tool.serializeError(error);
		const rendered = await tool.render(ctx, serialized.tool.value.result, RENDER_PROPS);
		return { text: rendered.content[0].text, isError: true };
	}
}

async function ourText(name, args) {
	const result = await ours[name](args);
	return { text: result.content[0].text, isError: result.isError === true };
}

const VALID_QUESTION = { id: "a", prompt: "Pick a size", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }] };
const CASES = {
	Glob: [
		null,
		[],
		"text",
		{},
		{ glob_pattern: null },
		{ glob_pattern: 5 },
		{ glob_pattern: "*.ts", target_directory: null },
		{ glob_pattern: "*.ts", target_directory: 7 },
		{ glob_pattern: "" },
		{ glob_pattern: "/" },
	],
	rg: [
		null,
		[],
		{},
		{ pattern: null },
		{ pattern: "a", "-A": "x" },
		{ pattern: "a", "-A": null },
		{ pattern: "a", "-i": "maybe" },
		{ pattern: "a", output_mode: "lines" },
		{ pattern: "a", output_mode: 3 },
		{ pattern: "a", head_limit: -1 },
		{ pattern: "a", offset: "-2" },
		{ pattern: "" },
		{ pattern: "a", "-A": "-3" },
		{ pattern: "a", multiline: 5 },
	],
	ReadFile: [
		null,
		[],
		{},
		{ path: null },
		{ path: 5 },
		{ path: "a.txt", offset: "abc" },
		{ path: "a.txt", offset: 1.5 },
		{ path: "a.txt", limit: 0 },
		{ path: "a.txt", limit: null },
	],
	Shell: [
		null,
		[],
		{},
		{ command: null },
		{ command: 5 },
		{ command: "echo hi", block_until_ms: "abc" },
		{ command: "echo hi", block_until_ms: null },
		{ command: "echo hi", working_directory: 5 },
		{ command: "echo hi", notify_on_output: null },
		{ command: "echo hi", notify_on_output: { pattern: 1, reason: "r" } },
		{ command: "echo hi", description: false },
	],
	AskQuestion: [
		null,
		[],
		{},
		{ questions: [] },
		{ questions: null },
		{ questions: "not json" },
		{ questions: "[]" },
		{ questions: '[{"id":"a"}]' },
		{ questions: '[{"id":"a","prompt":"p","options":[{"id":"x","label":"X"}]}]' },
		{ title: null, questions: [VALID_QUESTION] },
		{ title: 5, questions: 5 },
		{ questions: [null] },
		{ questions: [{ id: "a", prompt: "Pick a size", options: [{ id: "x", label: "X" }] }] },
	],
	UpdateCurrentStep: [null, [], {}, { current_step: null }, { current_step: 5, final_summary: "" }, { current_step: "   " }, "text"],
};

let failed = 0;
let checks = 0;
for (const [name, cases] of Object.entries(CASES)) {
	for (const args of cases) {
		checks++;
		const label = `${name} ${JSON.stringify(args)}`;
		try {
			const want = await cursorText(name, args);
			const got = await ourText(name, args);
			if (want.text === got.text && want.isError === got.isError) {
				console.log(`ok ${label}\n  text ${JSON.stringify(got.text)} isError ${got.isError}`);
			} else {
				failed++;
				console.log(`FAIL ${label}\n  cursor ${JSON.stringify(want)}\n  ours   ${JSON.stringify(got)}`);
			}
		} catch (error) {
			failed++;
			console.log(`FAIL ${label}: ${error?.stack ?? error}`);
		}
	}
}

const registered = [];
registerAllTools({ registerTool: (definition) => registered.push(definition), on() {} });
const expectedNames = [...MAIN_TOOL_ORDER, "UpdateCurrentStep"];
checks++;
if (JSON.stringify(registered.map((definition) => definition.name)) === JSON.stringify(expectedNames)) {
	console.log(`ok registered tools ${JSON.stringify(expectedNames)}`);
} else {
	failed++;
	console.log(`FAIL registered tools ${JSON.stringify(registered.map((definition) => definition.name))} differ from ${JSON.stringify(expectedNames)}`);
}
for (const definition of registered) {
	checks++;
	const isCarrier = definition.name === "ApplyPatch";
	const passthrough = definition.parameters === PASSTHROUGH_PARAMETERS;
	if (isCarrier ? !passthrough : passthrough) {
		console.log(`ok registration ${definition.name}: ${isCarrier ? "grammar carrier" : "pass-through schema"}`);
	} else {
		failed++;
		console.log(`FAIL registration ${definition.name}: ${JSON.stringify(definition.parameters)}`);
	}
}

console.log(failed === 0 ? `all ${checks} checks ok` : `${failed} of ${checks} checks failed`);
process.exit(failed === 0 ? 0 : 1);
