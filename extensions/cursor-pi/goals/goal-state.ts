import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Session entry holding the goal after each change, so a resumed session reads the goal it ended with. Cursor keeps the same
// record on the conversation as GoalState.
export const GOAL_ENTRY = "cursor-pi-goal";

export type GoalStatus = "active" | "paused" | "complete";

export interface GoalState {
	conversationId: string;
	goalId: string;
	objective: string;
	status: GoalStatus;
	// Continuation turns that started since a turn last called a tool. Cursor pauses the goal at three.
	idleContinuationsWithoutToolCalls: number;
	continuationCount: number;
	// Milliseconds active up to lastAccruedAtMs; while the clock runs, the time since lastAccruedAtMs counts as well.
	activeDurationMs: number;
	lastAccruedAtMs: number | undefined;
	// Context tokens the goal's active turns added, and the context size that the last turn measured.
	contextTokensAdded: number;
	lastContextTokens: number | undefined;
}

let appendSessionEntry: ((customType: string, data: unknown) => void) | undefined;

// The goal tools and the continuation hooks write through the Pi that registered them.
export function registerGoalStore(pi: ExtensionAPI): void {
	appendSessionEntry = (customType, data) => pi.appendEntry(customType, data);
}

// The goal the session's last write left, or undefined when there is none.
export function storedGoal(ctx: ExtensionContext): GoalState | undefined {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === GOAL_ENTRY) {
			return (entry.data as { goal?: GoalState | null } | undefined)?.goal ?? undefined;
		}
	}
	return undefined;
}

export function saveGoal(goal: GoalState): void {
	if (appendSessionEntry === undefined) throw new Error("the goal store is not registered with Pi");
	appendSessionEntry(GOAL_ENTRY, { goal });
}

// Cursor's goalElapsedMs: the accrued time, plus the time since the anchor while the clock runs.
export function goalElapsedMs(goal: GoalState, nowMs: number): number {
	return goal.activeDurationMs + (goal.lastAccruedAtMs === undefined ? 0 : Math.max(0, nowMs - goal.lastAccruedAtMs));
}

// Cursor's goalClockOnActivation: the clock starts at nowMs and keeps the time already accrued.
export function startClock(goal: GoalState, nowMs: number): GoalState {
	return { ...goal, lastAccruedAtMs: nowMs };
}

// Cursor's goalClockOnDeactivation: the elapsed time is folded into the accrued time, and the clock stops.
export function stopClock(goal: GoalState, nowMs: number): GoalState {
	return { ...goal, activeDurationMs: goalElapsedMs(goal, nowMs), lastAccruedAtMs: undefined };
}

// Cursor's formatGoalElapsedLabel: hours, minutes and seconds, leaving out the larger units when they are zero.
export function formatGoalElapsedLabel(elapsedMs: number): string {
	const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	const hours = Math.floor(elapsedSeconds / 3600);
	const minutes = Math.floor((elapsedSeconds % 3600) / 60);
	const seconds = elapsedSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

// The context tokens Pi reports for the session, or undefined when Pi cannot tell.
export function contextTokensOf(ctx: ExtensionContext): number | undefined {
	return ctx.getContextUsage()?.tokens ?? undefined;
}
