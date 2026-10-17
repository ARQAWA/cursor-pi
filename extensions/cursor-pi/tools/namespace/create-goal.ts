import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { contextTokensOf, type GoalState, registerGoalStore, saveGoal, startClock } from "../../goals/goal-state.ts";
import { type ArgIssue, checkType, invalidArguments } from "../cursor-args.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";

// Cursor's CreateGoal (agent/dist/tools/core/glob/glob.js, createGoalTools), for the cursor namespace.
const NAMESPACE = "cursor";
const CREATE_GOAL = capturedNamespaceDeclaration("CreateGoal");

export function register(pi: ExtensionAPI): void {
	registerGoalStore(pi);
	registerDynamicTool({ namespace: NAMESPACE, declaration: CREATE_GOAL, conciseInstructions: capturedConciseInstruction(CREATE_GOAL.name), execute: executeCreateGoal });
}

// Cursor's createGoalSchema: an object whose objective is a string, trimmed, with at least one character. Argument errors are
// errors; a created goal is a result.
export async function executeCreateGoal(params: unknown, _signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { text: invalidArguments(issues), isError: true };
	const objective = objectiveArg((params as Record<string, unknown>).objective, issues);
	if (objective === undefined) return { text: invalidArguments(issues), isError: true };
	// Cursor's CreateGoal replaces the conversation's goal, whatever status that goal had.
	const goal: GoalState = {
		conversationId: ctx.sessionManager.getSessionId(),
		goalId: randomUUID(),
		objective,
		status: "active",
		idleContinuationsWithoutToolCalls: 0,
		continuationCount: 0,
		activeDurationMs: 0,
		lastAccruedAtMs: undefined,
		contextTokensAdded: 0,
		lastContextTokens: contextTokensOf(ctx),
	};
	saveGoal(startClock(goal, Date.now()));
	return { text: "Goal created", isError: false };
}

function objectiveArg(value: unknown, issues: ArgIssue[]): string | undefined {
	if (!checkType(value, "string", ["objective"], issues)) return undefined;
	const trimmed = (value as string).trim();
	if (trimmed.length === 0) {
		issues.push({ path: ["objective"], message: "String must contain at least 1 character(s)" });
		return undefined;
	}
	return trimmed;
}
