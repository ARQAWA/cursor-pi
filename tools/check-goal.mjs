#!/usr/bin/env bun
// Checks CreateGoal and UpdateGoal against Cursor Desktop 3.25.6's own code, through tools/cursor-oracle.mjs: the captured
// declarations, the text of success and error results, the argument errors, the continuation prompt and the pursuit guidelines.
// Then it runs scripted sessions through Cursor Pi with tools/capture-session.mjs: the continuation request after the turn that
// created the goal, the goal text in it, UpdateGoal's result, no continuation once the goal completes, and the pause after three
// continuations that used no tool. Needs the extracted bundle (bun tools/extract-cursor.mjs). Exits non-zero on any FAIL.
// Usage: bun tools/check-goal.mjs

import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runScriptedSession } from "./capture-session.mjs";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { getDynamicTool } from "../extensions/cursor-pi/dynamic/registry.ts";
import { buildGoalContinuationPrompt, buildGoalPursuitGuidelines } from "../extensions/cursor-pi/goals/goal-prompts.ts";
import { capturedNamespaceDeclaration } from "../extensions/cursor-pi/tools/namespace/captured.ts";
import { executeCreateGoal } from "../extensions/cursor-pi/tools/namespace/create-goal.ts";
import { registerCursorNamespace } from "../extensions/cursor-pi/tools/namespace/index.ts";
import { executeUpdateGoal } from "../extensions/cursor-pi/tools/namespace/update-goal.ts";

const cursor = await loadCursor();
for (const marker of [
	"../constants/dist/system-notification.js",
	"../proto/dist/generated/agent/v1/goal_tool_pb.js",
	"../agent/dist/tools/core/goals/goals.js",
	"../agent/dist/tools/core/glob/glob.js",
	"../agent/dist/goal-metrics.js",
	"../agent-core/dist/goal-continuation.js",
]) {
	initModule(cursor, marker);
}

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
function same(name, ours, expected) {
	report(name, ours === expected, ours === expected ? "" : `  ours:   ${JSON.stringify(ours)}\n  cursor: ${JSON.stringify(expected)}`);
}

// Pi's session stand-in: the entries a session holds, the appendEntry that writes them, and the context usage.
const entries = [];
registerCursorNamespace({ appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
const sessionCtx = (branch = entries) => ({
	sessionManager: { getBranch: () => branch, getSessionId: () => "goal-check-session" },
	getContextUsage: () => undefined,
});
const goalEntry = (goal) => ({ type: "custom", customType: "cursor-pi-goal", data: { goal } });
const goalFixture = (fields) => ({
	conversationId: "goal-check-session",
	goalId: "0d6f1d36-7f3a-4b8e-9c1a-2f4e5d6c7b8a",
	objective: "Ship the report",
	status: "active",
	idleContinuationsWithoutToolCalls: 0,
	continuationCount: 0,
	activeDurationMs: 0,
	lastAccruedAtMs: undefined,
	contextTokensAdded: 0,
	lastContextTokens: undefined,
	...fields,
});
const lastSavedGoal = () => entries.filter((entry) => entry.customType === "cursor-pi-goal").at(-1)?.data.goal;

// Cursor's goal tools, with a state handler that holds the goal the render reads.
const stateHandler = { goalState: undefined, setGoalState(goal) { this.goalState = goal; }, getBlobStore: () => undefined, mode: undefined, getPrivacyMode: () => 0 };
const cursorTools = cursor.createGoalTools(stateHandler, { agentSessionId: undefined });
const renderText = async (tool, result) => (await tool.render(cursor.createContext(), result, {})).content[0].text;

// Declarations: the captured descriptions are the ones Cursor's tools describe themselves with.
const createDecl = capturedNamespaceDeclaration("CreateGoal");
const updateDecl = capturedNamespaceDeclaration("UpdateGoal");
same("declaration: CreateGoal description is Cursor's", createDecl.description, cursorTools.createGoalTool.descriptionGenerator({}));
same("declaration: UpdateGoal description is Cursor's", updateDecl.description, cursorTools.updateGoalTool.descriptionGenerator({}));
same("declaration: CreateGoal requires objective", JSON.stringify(createDecl.parameters.required), '["objective"]');
same("declaration: UpdateGoal status is active or complete", JSON.stringify(updateDecl.parameters.properties.status.enum), '["active","complete"]');
report("registry: CreateGoal and UpdateGoal are in the cursor namespace", getDynamicTool("cursor", "CreateGoal") !== undefined && getDynamicTool("cursor", "UpdateGoal") !== undefined);

// CreateGoal: success text, and the stored goal.
const created = await executeCreateGoal({ objective: "  Ship the report  " }, undefined, sessionCtx());
same("CreateGoal: success text is Cursor's", created.text, await renderText(cursorTools.createGoalTool, new cursor.CreateGoalResult({ result: { case: "success", value: new cursor.CreateGoalSuccess() } })));
report("CreateGoal: isError is false", created.isError === false);
report("CreateGoal: stores an active goal with the trimmed objective", lastSavedGoal()?.status === "active" && lastSavedGoal()?.objective === "Ship the report");

// UpdateGoal without a goal: the render of Cursor's error.
const noGoal = await executeUpdateGoal({ status: "complete" }, undefined, sessionCtx([]));
same("UpdateGoal without a goal: text is Cursor's error text", noGoal.text, await renderText(cursorTools.updateGoalTool, cursorTools.updateGoalTool.serializeError(new Error("UpdateGoal requires an existing goal")).tool.value.result));

// UpdateGoal active from paused: text is Cursor's.
const paused = goalFixture({ status: "paused", activeDurationMs: 1480000 });
const resumed = await executeUpdateGoal({ status: "active" }, undefined, sessionCtx([goalEntry(paused)]));
stateHandler.goalState = { status: cursor.GoalStatus.ACTIVE, activeDurationMs: 1480000, lastAccruedAtMs: 1 };
same("UpdateGoal active: text is Cursor's", resumed.text, await renderText(cursorTools.updateGoalTool, new cursor.UpdateGoalResult({ result: { case: "success", value: new cursor.UpdateGoalSuccess({ status: cursor.GoalStatus.ACTIVE }) } })));
report("UpdateGoal active: the clock restarts", lastSavedGoal()?.lastAccruedAtMs !== undefined && lastSavedGoal()?.status === "active");

// UpdateGoal complete from paused: the runtime text is Cursor's, and matches the captured sample.
const completed = await executeUpdateGoal({ status: "complete" }, undefined, sessionCtx([goalEntry(paused)]));
stateHandler.goalState = { status: cursor.GoalStatus.COMPLETE, activeDurationMs: 1480000, lastAccruedAtMs: undefined };
same("UpdateGoal complete: text is Cursor's, with the runtime", completed.text, await renderText(cursorTools.updateGoalTool, new cursor.UpdateGoalResult({ result: { case: "success", value: new cursor.UpdateGoalSuccess({ status: cursor.GoalStatus.COMPLETE }) } })));
same("UpdateGoal complete: runtime text is the captured one", completed.text, "Goal is now complete. Report total runtime to the user: 24m 40s");

// UpdateGoal complete from active: the running clock is counted up to now, and then stops.
const running = goalFixture({ status: "active", activeDurationMs: 0, lastAccruedAtMs: Date.now() - 90000 });
const ranDown = await executeUpdateGoal({ status: "complete" }, undefined, sessionCtx([goalEntry(running)]));
report("UpdateGoal complete from active: runtime counts the running clock", /^Goal is now complete\. Report total runtime to the user: 1m \d+s$/.test(ranDown.text), `  text: ${JSON.stringify(ranDown.text)}`);
report("UpdateGoal complete from active: the clock stops", lastSavedGoal()?.status === "complete" && lastSavedGoal()?.lastAccruedAtMs === undefined);

// Argument errors: the text Cursor's zod parse throws.
const streamOf = (text) => (async function* () { yield text; })();
async function cursorArgError(tool, args) {
	const interactionHandler = { emitPartialToolCall: async () => undefined, executeToolCall: async (callCtx, _call, _id, execute) => execute(callCtx) };
	try {
		await tool.execute(cursor.createContext(), interactionHandler, streamOf(JSON.stringify(args)), { toolCallId: "goal-args" });
		return "no error";
	} catch (error) {
		return error.modelVisibleErrorMessage ?? error.message;
	}
}
for (const args of [{}, { objective: 5 }, { objective: null }, { objective: "   " }, []]) {
	same(`CreateGoal ${JSON.stringify(args)}: argument error text is Cursor's`, (await executeCreateGoal(args, undefined, sessionCtx())).text, await cursorArgError(cursorTools.createGoalTool, args));
}
for (const args of [{}, { status: "paused" }, { status: 1 }]) {
	same(`UpdateGoal ${JSON.stringify(args)}: argument error text is Cursor's`, (await executeUpdateGoal(args, undefined, sessionCtx())).text, await cursorArgError(cursorTools.updateGoalTool, args));
}

// The continuation prompt and the pursuit guidelines, for the objectives and tool-name sets that the session can produce.
const NAME_SETS = [{ todoWriteToolName: "TodoWrite", updateGoalToolName: "UpdateGoal" }, { updateGoalToolName: "UpdateGoal" }, {}];
for (const objective of ["Ship the <report> & tests", "Plain objective"]) {
	NAME_SETS.forEach((names, i) => {
		same(`continuation prompt: objective ${JSON.stringify(objective)}, tool names set ${i + 1}`, buildGoalContinuationPrompt({ objective, ...names }), cursor.buildGoalContinuationPrompt({ goalState: { objective }, ...names }));
	});
}
NAME_SETS.forEach((names, i) => {
	same(`pursuit guidelines: tool names set ${i + 1}`, buildGoalPursuitGuidelines(names), cursor.buildGoalPursuitGuidelines(names));
});

// End to end: scripted sessions through Cursor Pi, for two models.
const MODELS = ["openai-codex/gpt-5.6-sol", "anthropic/claude-opus-5-5"];
const OBJECTIVE = "Ship the <report> & tests";
const GOAL_TAG = '<system_notification source="goal">';
const TIMESTAMP_LINE = /^<timestamp>[^\n]*<\/timestamp>\n$/;
const goalCall = (toolName, args) => ({ name: "CallDynamicTool", arguments: { namespace: "cursor", toolName, arguments: args } });
const SCENARIOS = {
	complete: [{ calls: [goalCall("CreateGoal", { objective: OBJECTIVE })] }, { text: "Goal set." }, { calls: [goalCall("UpdateGoal", { status: "complete" })] }, { text: "Done." }],
	idle: [{ calls: [goalCall("CreateGoal", { objective: OBJECTIVE })] }, { text: "First." }, { text: "Second." }, { text: "Third." }, { text: "Fourth." }],
};

// The text parts of the user messages in a request body, in the Responses and the Messages shapes.
function userTexts(body) {
	const items = body?.input ?? body?.messages ?? [];
	const texts = [];
	for (const item of items) {
		if (item.role !== "user") continue;
		if (typeof item.content === "string") texts.push(item.content);
		else if (Array.isArray(item.content)) for (const part of item.content) if (typeof part.text === "string") texts.push(part.text);
	}
	return texts;
}
const bodyText = (request) => JSON.stringify(request?.body ?? null);

async function runSession(model, turns) {
	const cwd = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-goal-cwd-")));
	try {
		return await runScriptedSession({ model, cwd, prompt: "Start a goal for the report.", turns });
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

for (const model of MODELS) {
	const complete = await runSession(model, SCENARIOS.complete);
	report(`${model}: complete: Pi exits 0 without errors`, complete.code === 0 && complete.errors.length === 0, `  exit ${complete.code}; errors: ${complete.errors.join(" | ")}\n${complete.stderr.slice(-800)}`);
	report(`${model}: complete: four requests, so nothing continues after UpdateGoal`, complete.requests.length === 4, `  requests: ${complete.requests.length}`);
	report(`${model}: complete: CreateGoal's result reaches the model`, bodyText(complete.requests[1]).includes("Goal created"));
	const goalTexts = (complete.requests[2] ? userTexts(complete.requests[2].body) : []).filter((text) => text.includes(GOAL_TAG));
	report(`${model}: complete: request 3 carries one goal continuation`, goalTexts.length === 1, `  found: ${goalTexts.length}`);
	const expected = cursor.buildGoalContinuationPrompt({ goalState: { objective: OBJECTIVE }, todoWriteToolName: "TodoWrite", updateGoalToolName: "UpdateGoal" });
	const text = goalTexts[0] ?? "";
	report(`${model}: complete: the continuation is a timestamp line and Cursor's prompt, not wrapped`, text.endsWith(expected) && TIMESTAMP_LINE.test(text.slice(0, text.length - expected.length)) && !text.includes("<user_query>"), `  text: ${JSON.stringify(text.slice(0, 240))}`);
	report(`${model}: complete: request 4 carries UpdateGoal's runtime text`, /Goal is now complete\. Report total runtime to the user: \d+s/.test(bodyText(complete.requests[3])));

	const idle = await runSession(model, SCENARIOS.idle);
	report(`${model}: idle: Pi exits 0 without errors`, idle.code === 0 && idle.errors.length === 0, `  exit ${idle.code}; errors: ${idle.errors.join(" | ")}\n${idle.stderr.slice(-800)}`);
	report(`${model}: idle: five requests, so the goal pauses after three continuations`, idle.requests.length === 5, `  requests: ${idle.requests.length}`);
	const carries = idle.requests.map((request) => userTexts(request.body).some((item) => item.includes(GOAL_TAG)));
	same(`${model}: idle: requests 3 to 5 are the continuations`, JSON.stringify(carries), "[false,false,true,true,true]");
}

console.log(`check-goal: ${passed} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
