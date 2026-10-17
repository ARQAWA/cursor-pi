import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { formatGoalElapsedLabel, goalElapsedMs, type GoalState, registerGoalStore, saveGoal, startClock, stopClock, storedGoal } from "../../goals/goal-state.ts";
import { type ArgIssue, checkType, invalidArguments, optionalEnum } from "../cursor-args.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";

// Cursor's UpdateGoal (agent/dist/tools/core/glob/glob.js, createGoalTools), for the cursor namespace.
const NAMESPACE = "cursor";
const UPDATE_GOAL = capturedNamespaceDeclaration("UpdateGoal");
// Cursor's GOAL_STATUSES: the statuses the model may set. Pausing is the user's to do.
const SETTABLE_STATUSES = ["active", "complete"] as const;
type SettableStatus = (typeof SETTABLE_STATUSES)[number];

export function register(pi: ExtensionAPI): void {
	registerGoalStore(pi);
	registerDynamicTool({ namespace: NAMESPACE, declaration: UPDATE_GOAL, conciseInstructions: capturedConciseInstruction(UPDATE_GOAL.name), execute: executeUpdateGoal });
}

// Argument errors come from Cursor's zod parse before the tool runs, so they are errors. The other results are rendered text.
export async function executeUpdateGoal(params: unknown, _signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { text: invalidArguments(issues), isError: true };
	const status = statusArg((params as Record<string, unknown>).status, issues);
	if (status === undefined) return { text: invalidArguments(issues), isError: true };
	const current = storedGoal(ctx);
	// Cursor's executor throws an Error here, and its render shows that Error in String form.
	if (current === undefined) return { text: "Error updating goal: Error: UpdateGoal requires an existing goal", isError: false };
	const now = Date.now();
	let updated: GoalState = { ...current, status };
	if (status === "active") {
		updated = { ...updated, idleContinuationsWithoutToolCalls: 0 };
		if (current.status !== "active") updated = startClock(updated, now);
	} else if (current.status === "active") {
		updated = stopClock(updated, now);
	}
	saveGoal(updated);
	if (status === "complete") {
		return { text: `Goal is now complete. Report total runtime to the user: ${formatGoalElapsedLabel(goalElapsedMs(updated, now))}`, isError: false };
	}
	return { text: `Goal is now ${status}`, isError: false };
}

function statusArg(value: unknown, issues: ArgIssue[]): SettableStatus | undefined {
	if (value === undefined) {
		issues.push({ path: ["status"], message: "Required" });
		return undefined;
	}
	return optionalEnum(value, SETTABLE_STATUSES, ["status"], issues);
}
