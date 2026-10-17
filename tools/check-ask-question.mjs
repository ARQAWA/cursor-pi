#!/usr/bin/env bun
// Checks AskQuestion against Cursor Desktop's own code. For each case, Cursor's createAskQuestionTool().execute runs on
// the arguments with a scripted client answer (or none, for bad arguments), and its result goes through Cursor's render.
// Cursor Pi's executeAskQuestion runs on the same arguments with a scripted ui. Both texts must be equal.
// Usage: bun tools/check-ask-question.mjs
// Captured call 057 (runs-2026-10-16-T4) is reproduced from its own arguments and output.

import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeAskQuestion } from "../extensions/cursor-pi/tools/ask-question.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(ROOT, "research", "cursor", "reverse", "runs-2026-10-16-T4", "calls", "057-S4-AskQuestion.md");
const TOOL_CALL_ID = "toolcall-ask-1";
const QUERY_ID = "query-ask-1";
// A skip is an empty client reason, which Cursor's agent answers with this text. No Desktop capture of a skipped AskQuestion exists.
const SKIPPED_TEXT = "Questions skipped by user";
const NO_CLIENT_TEXT = "The client could not show this request to the user";
// Modules whose functions and variables the AskQuestion path reads; each is initialized once in the oracle.
const ORACLE_MODULES = [
	"../agent/dist/tools/lenient-array.js",
	"../agent/dist/tools/core/ask-question/degenerate.js",
	"../agent/dist/tools/core/ask-question/index.js",
	"../agent-core/dist/interaction-queries.js",
];

const cursor = await loadCursor();
for (const marker of ORACLE_MODULES) initModule(cursor, marker);

// A constant of Cursor's interaction controller, read from the same extracted bundle the oracle evaluates.
async function cursorConstant(name) {
	const bundle = await readFile(join(os.tmpdir(), "cursor-3.25.6-f0df777c", "pretty.js"), "utf8");
	const match = new RegExp(`${name} = "([^"]+)"`).exec(bundle);
	if (!match) throw new Error(`${name} not found in pretty.js`);
	return match[1];
}
const CLIENT_CANNOT_SHOW_REASON = await cursorConstant("INTERACTION_SURFACE_FAILED_REASON");

function capturedCall(file) {
	const text = readFileSync(file, "utf8");
	const args = JSON.parse(text.match(/^(\{"questions".*\})$/m)[1]);
	const output = JSON.parse(text.match(/^(\[\{"text".*\])$/m)[1]);
	return { args, text: output[0].text };
}
const captured = capturedCall(CAPTURE);

function streamOf(text) {
	return (async function* () {
		yield text;
	})();
}

// Cursor's interaction handler: the listener answers the AskQuestion query with `response`.
function cursorHandler(response) {
	return {
		listener: { query: async () => response },
		emitPartialToolCall: async () => undefined,
		recordPendingToolCall: async () => undefined,
		executeToolCall: async (ctx, _call, _id, execute) => execute(ctx),
	};
}

const stateHandler = { hasCompletedAskQuestion: () => false, markAskQuestionCompleted() {} };

async function renderText(tool, ctx, result) {
	const rendered = await tool.render(ctx, result, {});
	return rendered.content[0].text;
}

// Cursor's text for the arguments, given the client's response to the question query.
async function cursorAsk(args, response) {
	const tool = cursor.createAskQuestionTool(
		{},
		{ name: "AskQuestion", useAntiAskQuestionDescription: false, autoRejectFirstAskQuestion: false, getDynamicTools: () => [] },
	);
	const ctx = cursor.createContext();
	try {
		const result = await tool.execute(ctx, cursorHandler(response), streamOf(JSON.stringify(args)), { toolCallId: TOOL_CALL_ID, stateHandler });
		return await renderText(tool, ctx, result);
	} catch (error) {
		// Cursor turns a thrown argument error into an error result, then renders that result.
		return await renderText(tool, ctx, tool.serializeError(error).tool.value.result);
	}
}

function interactionResponse(askResult) {
	return { result: { case: "askQuestionInteractionResponse", value: { result: askResult } } };
}
const answered = (answers) => interactionResponse({ result: { case: "success", value: { answers } } });
const rejected = (reason) => interactionResponse({ result: { case: "rejected", value: { reason } } });
// What Cursor's controller answers when the client cannot show the query.
const clientCannotShow = () =>
	cursor.createFailClosedInteractionResponse({ id: QUERY_ID, query: { case: "askQuestionInteractionQuery", value: {} } }, CLIENT_CANNOT_SHOW_REASON);

// Runs executeAskQuestion with scripted dialogs. Each step gets the dialog's call and returns what the user did;
// undefined is Escape.
async function ourAsk(args, { hasUI = true, steps = [] } = {}) {
	const pending = [...steps];
	const answer = (call) => {
		const step = pending.shift();
		if (step === undefined) throw new Error(`unexpected ${call.method} dialog: ${call.title}`);
		return step(call);
	};
	const ui = {
		select: async (title, options) => answer({ method: "select", title, options }),
		input: async (title, placeholder) => answer({ method: "input", title, placeholder }),
		setStatus() {},
		notify() {},
	};
	const result = await executeAskQuestion(args, undefined, { hasUI, ui, cwd: ROOT });
	if (pending.length > 0) throw new Error(`${pending.length} scripted dialog(s) were not shown`);
	return result.content[0].text;
}

// Dialog steps. Select rows are matched by their text without the [x] or [ ] mark.
const selectCall = (call) => {
	if (call.method !== "select") throw new Error(`expected a select, got ${call.method}`);
	return call;
};
const byLabel = (label) => (call) => {
	const row = selectCall(call).options.find((text) => text.replace(/^\[[ x]\] /, "") === label);
	if (row === undefined) throw new Error(`no row "${label}" in ${JSON.stringify(call.options)}`);
	return row;
};
const byText = (text) => (call) => {
	if (!selectCall(call).options.includes(text)) throw new Error(`no row "${text}" in ${JSON.stringify(call.options)}`);
	return text;
};
const byIndex = (index) => (call) => selectCall(call).options[index];
const typed = (text) => (call) => {
	if (call.method !== "input") throw new Error(`expected an input, got ${call.method}`);
	return text;
};
const cancel = () => undefined;

const SINGLE = {
	questions: [{ id: "color", prompt: "Which color do you want?", options: [{ id: "red", label: "Red" }, { id: "blue", label: "Blue" }] }],
};
const SECOND = { id: "size", prompt: "Which size do you want?", options: [{ id: "small", label: "Small" }, { id: "large", label: "Large" }] };
const MULTI = {
	title: "Fruit form",
	questions: [
		{
			id: "fruit",
			prompt: "Pick fruits",
			allow_multiple: true,
			options: [{ id: "a", label: "Apple" }, { id: "b", label: "Banana" }, { id: "c", label: "Cherry" }],
		},
	],
};

const cases = [
	{
		name: "captured 057 (T4): two single-choice questions",
		args: captured.args,
		steps: [byIndex(1), byIndex(0)],
		client: answered([
			{ questionId: "scope", selectedOptionIds: ["success"], freeformText: "" },
			{ questionId: "policy", selectedOptionIds: ["default"], freeformText: "" },
		]),
		expect: captured.text,
	},
	{
		name: "single: option chosen",
		args: SINGLE,
		steps: [byLabel("Blue")],
		client: answered([{ questionId: "color", selectedOptionIds: ["blue"], freeformText: "" }]),
		expect: "User questions responses:\nQuestion color: Selected option(s) blue",
	},
	{
		name: "single: Other with freeform text",
		args: SINGLE,
		steps: [byLabel("Other"), typed("  a dark teal  ")],
		client: answered([{ questionId: "color", selectedOptionIds: [], freeformText: "  a dark teal  " }]),
		expect: "User questions responses:\nQuestion color: a dark teal",
	},
	{
		name: "single: skipped on the first question",
		args: SINGLE,
		steps: [cancel],
		client: rejected(""),
		expect: SKIPPED_TEXT,
	},
	{
		name: "single: skipped on the freeform input",
		args: SINGLE,
		steps: [byLabel("Other"), cancel],
		client: rejected(""),
		expect: SKIPPED_TEXT,
	},
	{
		name: "two questions: second one skipped",
		args: { questions: [SINGLE.questions[0], SECOND] },
		steps: [byLabel("Red"), cancel],
		client: rejected(""),
		expect: SKIPPED_TEXT,
	},
	{
		name: "multi: toggles, then Done",
		args: MULTI,
		steps: [byLabel("Banana"), byLabel("Cherry"), byLabel("Banana"), byLabel("Done")],
		client: answered([{ questionId: "fruit", selectedOptionIds: ["c"], freeformText: "" }]),
		expect: "User questions responses:\nQuestion fruit: Selected option(s) c",
	},
	{
		name: "multi: option and Other text",
		args: MULTI,
		steps: [byLabel("Apple"), byLabel("Other"), typed("green"), byLabel("Done")],
		client: answered([{ questionId: "fruit", selectedOptionIds: ["a"], freeformText: "green" }]),
		expect: "User questions responses:\nQuestion fruit: Selected option(s) a, freeform: green",
	},
	{
		name: "multi: Done with nothing selected",
		args: MULTI,
		steps: [byLabel("Done")],
		client: answered([{ questionId: "fruit", selectedOptionIds: [], freeformText: "" }]),
		expect: "User questions responses:\nQuestion fruit: No answer provided",
	},
	{
		name: "multi: skipped inside the loop",
		args: MULTI,
		steps: [byLabel("Apple"), cancel],
		client: rejected(""),
		expect: SKIPPED_TEXT,
	},
	{
		name: "single: repeated labels stay distinct",
		args: { questions: [{ id: "pick", prompt: "Pick one option", options: [{ id: "x", label: "Same" }, { id: "y", label: "Same" }] }] },
		steps: [byText("Same (2)")],
		client: answered([{ questionId: "pick", selectedOptionIds: ["y"], freeformText: "" }]),
		expect: "User questions responses:\nQuestion pick: Selected option(s) y",
	},
	{
		name: "no client to ask (hasUI false)",
		args: SINGLE,
		hasUI: false,
		steps: [],
		client: clientCannotShow(),
		expect: NO_CLIENT_TEXT,
	},
	{
		name: 'cursor only: an empty client reason becomes "Questions skipped by user"',
		args: SINGLE,
		client: rejected(""),
		expect: "Questions skipped by user",
		cursorOnly: true,
	},
	{ name: "invalid: empty object", args: {}, steps: [] },
	{ name: "invalid: empty questions array", args: { questions: [] }, steps: [] },
	{
		name: "invalid: one option",
		args: { questions: [{ id: "a", prompt: "Pick a size", options: [{ id: "x", label: "X" }] }] },
		steps: [],
	},
	{
		name: "invalid: wrong field types",
		args: { questions: [{ id: 1, prompt: "Pick a size", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], allow_multiple: "yes" }] },
		steps: [],
	},
	{ name: "invalid: title and questions types", args: { title: 5, questions: 5 }, steps: [] },
	{ name: "invalid: null question", args: { questions: [null] }, steps: [] },
	{ name: "invalid: array instead of object", args: [], steps: [] },
	{
		name: "invalid: missing id, options not an array",
		args: { questions: [{ prompt: "Pick a size", options: "XY" }] },
		steps: [],
	},
	{
		name: "invalid: option issues",
		args: { questions: [{ id: "a", prompt: "Pick a size", options: [{ id: "x" }, "y"] }] },
		steps: [],
	},
	{ name: "invalid: null title", args: { title: null, questions: [SINGLE.questions[0]] }, steps: [] },
];

let failed = 0;
for (const c of cases) {
	try {
		const cursorText = await cursorAsk(c.args, c.client);
		const ours = c.cursorOnly ? cursorText : await ourAsk(c.args, { hasUI: c.hasUI, steps: c.steps });
		const problems = [];
		if (c.expect !== undefined && cursorText !== c.expect) {
			problems.push(`  expected ${JSON.stringify(c.expect)}\n  cursor   ${JSON.stringify(cursorText)}`);
		}
		if (ours !== cursorText) problems.push(`  cursor ${JSON.stringify(cursorText)}\n  ours   ${JSON.stringify(ours)}`);
		if (problems.length === 0) {
			console.log(`ok ${c.name}`);
		} else {
			failed++;
			console.log(`FAIL ${c.name}\n${problems.join("\n")}`);
		}
	} catch (error) {
		failed++;
		console.log(`FAIL ${c.name}: ${error?.stack ?? error}`);
	}
}
console.log(failed === 0 ? `all ${cases.length} cases ok` : `${failed} of ${cases.length} cases failed`);
process.exit(failed === 0 ? 0 : 1);
