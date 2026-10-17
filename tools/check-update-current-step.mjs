#!/usr/bin/env bun
// Checks UpdateCurrentStep against Cursor Desktop's own code. For each case, Cursor's createCommunicateUpdateTool().execute
// runs on the arguments, and its result goes through Cursor's render. Cursor Pi's executeUpdateCurrentStep runs on the
// same arguments with a fake ui that records setStatus. Both texts must be equal, and the footer status must match.
// Usage: bun tools/check-update-current-step.mjs
// Captured call 0007 (runs-2026-10-16, sol) is reproduced from its own arguments and output.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeUpdateCurrentStep } from "../extensions/cursor-pi/tools/update-current-step.ts";
import { initModule, loadCursor } from "./cursor-oracle.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(ROOT, "research", "cursor", "reverse", "runs-2026-10-16", "sol", "calls", "0007-UpdateCurrentStep.md");
const STATUS_KEY = "cursor-pi-current-step";
const TOOL_CALL_ID = "toolcall-step-1";
const RECORDED_TEXT = "Progress update recorded.";

const cursor = await loadCursor();
initModule(cursor, "../agent/dist/tools/meta/update-current-step.js");

function capturedCall(file) {
	const text = readFileSync(file, "utf8");
	const args = JSON.parse(text.split("OUTPUT:")[0].split("ARGS:")[1].trim());
	const output = JSON.parse(text.split("OUTPUT:")[1].trim());
	return { args, text: output[0].text };
}
const captured = capturedCall(CAPTURE);

function streamOf(text) {
	return (async function* () {
		yield text;
	})();
}

async function renderText(tool, ctx, result) {
	const rendered = await tool.render(ctx, result, {});
	return rendered.content[0].text;
}

// Cursor's text for the arguments. Its state handler only records the step history, which this check does not read.
async function cursorUpdate(args) {
	const stateHandler = { getNextMessageIndex: () => 0, appendCommunicateUpdateHistoryEntry() {} };
	const tool = cursor.createCommunicateUpdateTool(stateHandler, { includeFinalSummary: true });
	const ctx = cursor.createContext();
	const interactionHandler = {
		emitPartialToolCall: async () => undefined,
		executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx),
	};
	try {
		const result = await tool.execute(ctx, interactionHandler, streamOf(JSON.stringify(args)), { toolCallId: TOOL_CALL_ID });
		return await renderText(tool, ctx, result);
	} catch (error) {
		// Cursor turns a thrown argument error into an error result, then renders that result.
		return await renderText(tool, ctx, tool.serializeError(error).tool.value.result);
	}
}

async function ourUpdate(args) {
	const statuses = [];
	const ui = { setStatus: (key, text) => statuses.push([key, text]) };
	const result = await executeUpdateCurrentStep(args, undefined, { hasUI: true, ui, cwd: ROOT });
	return { text: result.content[0].text, statuses };
}

const cases = [
	{ name: "captured 0007 (sol) reproduced", args: captured.args, text: captured.text, statuses: [[STATUS_KEY, captured.args.current_step]] },
	{ name: "trims the step", args: { current_step: "  Reading files  " }, text: RECORDED_TEXT, statuses: [[STATUS_KEY, "Reading files"]] },
	{ name: "completed_subtitle alone leaves the footer", args: { completed_subtitle: "Reviewed the change" }, text: RECORDED_TEXT, statuses: [] },
	{ name: "blank step with a final summary", args: { current_step: " ", final_summary: "Summary here" }, text: RECORDED_TEXT, statuses: [] },
	{ name: "invalid: no fields", args: {}, statuses: [] },
	{ name: "invalid: blank step", args: { current_step: "   " }, statuses: [] },
	{ name: "invalid: number step", args: { current_step: 5 }, statuses: [] },
	{ name: "invalid: null step", args: { current_step: null }, statuses: [] },
	{ name: "invalid: type error skips the at-least-one rule", args: { current_step: 5, final_summary: "" }, statuses: [] },
	{ name: "invalid: numeric completed_subtitle", args: { current_step: "Working", completed_subtitle: 7 }, statuses: [] },
	{ name: "invalid: array arguments", args: [], statuses: [] },
	{ name: "invalid: null arguments", args: null, statuses: [] },
];

let failed = 0;
for (const c of cases) {
	try {
		const cursorText = await cursorUpdate(c.args);
		const ours = await ourUpdate(c.args);
		const problems = [];
		if (c.text !== undefined && cursorText !== c.text) {
			problems.push(`  expected ${JSON.stringify(c.text)}\n  cursor   ${JSON.stringify(cursorText)}`);
		}
		if (ours.text !== cursorText) problems.push(`  cursor ${JSON.stringify(cursorText)}\n  ours   ${JSON.stringify(ours.text)}`);
		if (JSON.stringify(ours.statuses) !== JSON.stringify(c.statuses)) {
			problems.push(`  status expected ${JSON.stringify(c.statuses)}\n  status ours     ${JSON.stringify(ours.statuses)}`);
		}
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
