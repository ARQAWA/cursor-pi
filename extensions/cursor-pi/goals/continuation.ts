import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CURSOR_FEATURE_FLAGS } from "../feature-flags.ts";
import { buildTimestampPrefix, resolveTimeZone } from "../user-turn.ts";
import { buildGoalContinuationPrompt } from "./goal-prompts.ts";
import { contextTokensOf, type GoalState, registerGoalStore, saveGoal, startClock, stopClock, storedGoal } from "./goal-state.ts";

// The custom message that carries a goal continuation into its run. Cursor sends the same text as a simulated user message.
export const GOAL_CONTINUATION_MESSAGE = "cursor-pi-goal-continuation";
// Cursor's MAX_IDLE_CONTINUATIONS_WITHOUT_TOOL_CALLS: after this many continuations in a row without a tool call, the goal pauses.
const MAX_IDLE_CONTINUATIONS_WITHOUT_TOOL_CALLS = 3;
// The tool names the continuation prompt gives, as the cursor namespace lists them.
const TODO_WRITE_TOOL_NAME = "TodoWrite";
const UPDATE_GOAL_TOOL_NAME = "UpdateGoal";

// What the settle handler needs to know about the run that just ended.
interface RunFacts {
	continuation: boolean;
	goalActive: boolean;
	toolCalls: number;
	stopReason: string | undefined;
}

function runFacts(continuation: boolean, goalActive: boolean): RunFacts {
	return { continuation, goalActive, toolCalls: 0, stopReason: undefined };
}

let run = runFacts(false, false);

// Cursor's goal continuation, on Pi. When a run settles with an active goal, the goal starts another run with its prompt.
// agent_settled comes after Pi's retries and compaction, once no queued run is left, so the continuation is sent from there.
export function registerGoalContinuation(pi: ExtensionAPI): void {
	registerGoalStore(pi);
	pi.on("before_agent_start", (event, ctx) => {
		if (event.messageType === "custom") {
			run = runFacts(event.message.customType === GOAL_CONTINUATION_MESSAGE, storedGoal(ctx)?.status === "active");
			return undefined;
		}
		// Cursor's reactivatePausedGoalForTurn: a user's message resumes a paused goal.
		reactivatePausedGoal(ctx);
		run = runFacts(false, storedGoal(ctx)?.status === "active");
		return undefined;
	});
	pi.on("tool_execution_start", () => {
		run.toolCalls += 1;
	});
	pi.on("agent_end", (event) => {
		const last = event.messages.findLast((message) => message.role === "assistant");
		run.stopReason = last?.role === "assistant" ? last.stopReason : undefined;
	});
	pi.on("agent_settled", (event, ctx) => {
		const facts = run;
		run = runFacts(false, false);
		// Cursor's user stop pauses an active goal.
		if (event.aborted) {
			pauseActiveGoal(ctx);
			return;
		}
		const stored = storedGoal(ctx);
		if (stored === undefined) return;
		let next = withContextGrowth(stored, contextTokensOf(ctx), facts.goalActive || stored.status === "active");
		// Cursor clears the idle streak after a continuation turn that called a tool.
		if (facts.continuation && facts.toolCalls > 0) next = { ...next, idleContinuationsWithoutToolCalls: 0 };
		// Cursor starts a continuation only after a completed turn and only while the goal is active.
		if (next.status !== "active" || facts.stopReason === "error") {
			if (next !== stored) saveGoal(next);
			return;
		}
		const now = Date.now();
		if (next.idleContinuationsWithoutToolCalls >= MAX_IDLE_CONTINUATIONS_WITHOUT_TOOL_CALLS) {
			// Cursor's adaptAction: a stalled goal pauses and its clock stops, and no continuation is sent.
			saveGoal(stopClock({ ...next, status: "paused" }, now));
			return;
		}
		const started = accrue(
			{ ...next, idleContinuationsWithoutToolCalls: next.idleContinuationsWithoutToolCalls + 1, continuationCount: next.continuationCount + 1 },
			now,
		);
		saveGoal(started);
		pi.sendMessage({ customType: GOAL_CONTINUATION_MESSAGE, content: [{ type: "text", text: continuationText(started) }], display: false }, { triggerTurn: true });
	});
}

// The text of a continuation as Cursor's request carries it: the timestamp line of a user turn, then the goal prompt. The prompt
// is a notification, so Cursor does not wrap it in user_query.
function continuationText(goal: GoalState): string {
	const timestamp = CURSOR_FEATURE_FLAGS.userMessageTimestamps ? buildTimestampPrefix(new Date(), resolveTimeZone()) : "";
	return `${timestamp}${buildGoalContinuationPrompt({ objective: goal.objective, todoWriteToolName: TODO_WRITE_TOOL_NAME, updateGoalToolName: UPDATE_GOAL_TOOL_NAME })}`;
}

// Cursor's continuation start: the time since the clock last accrued joins the active duration, and the clock restarts.
function accrue(goal: GoalState, nowMs: number): GoalState {
	const span = goal.lastAccruedAtMs === undefined ? 0 : Math.max(0, nowMs - goal.lastAccruedAtMs);
	return { ...goal, activeDurationMs: goal.activeDurationMs + span, lastAccruedAtMs: nowMs };
}

// Cursor's goalContextTokensAdded: the growth of the context between two turns counts while the goal is active.
function withContextGrowth(goal: GoalState, tokens: number | undefined, activeDuringRun: boolean): GoalState {
	if (tokens === undefined) return goal;
	const growth = goal.lastContextTokens === undefined ? 0 : tokens - goal.lastContextTokens;
	const added = activeDuringRun && growth > 0 ? growth : 0;
	return { ...goal, contextTokensAdded: goal.contextTokensAdded + added, lastContextTokens: tokens };
}

// Cursor's pauseActiveGoal: the goal pauses and its clock stops.
function pauseActiveGoal(ctx: ExtensionContext): void {
	const goal = storedGoal(ctx);
	if (goal?.status !== "active") return;
	saveGoal(stopClock({ ...goal, status: "paused" }, Date.now()));
}

// Cursor's reactivatePausedGoalForTurn: a paused goal becomes active again, with its idle streak cleared and its clock started.
function reactivatePausedGoal(ctx: ExtensionContext): void {
	const goal = storedGoal(ctx);
	if (goal?.status !== "paused") return;
	saveGoal(startClock({ ...goal, status: "active", idleContinuationsWithoutToolCalls: 0 }, Date.now()));
}
