import type { ChildOutcome } from "../subagents/child.ts";
import type { BackgroundNotice } from "./notices.ts";

// Cursor's subagent completion, as its background completion prompt renders it: the lead, the task section with the subagent's
// result as detail, and the acknowledgement query that ends the batch. The acknowledgement is Cursor's subagent query with chat
// links and cloud view links on, which Cursor Desktop sends.
const FINISHED_LEAD = "The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.";
const ACKNOWLEDGEMENT_BASE =
	"Perform any necessary follow-up actions in response to the subagent completion above. If no follow-up work is needed, no further action is required.";
const NAMED_LINK_INSTRUCTION =
	" If you mention an agent or subagent in your response, link it with the `[Name](id)` Don't use generic label such as `[agent]`, `[worker]`, or `[subagent]`.";
const CLOUD_VIEW_LINK_INSTRUCTION =
	" For cloud subagents, when the agent has edited code, link to `[Review](bc-id#changes)`, or, if you know the exact added and deleted line counts, `[Review +A \u2212D](bc-id#changes)`, replacing A and D with those counts. Never write A or D literally. Use `[Try Live](bc-id#desktop)` only when the agent used computer use.";
const ABORTED_INSTRUCTION =
	" A status of `aborted` means the subagent's turn was deliberately stopped (for example, the user pressed stop); treat the stop as intentional, not as a failure or accidental interruption, and do not resume, restart, re-dispatch, or send new instructions to it unless the user explicitly asks you to.";
const ACKNOWLEDGEMENT_SUFFIX = " Don't repeat the same confirmation every time.";
// Cursor's detail for a subagent that the user stopped.
const ABORTED_DETAIL = "Subagent was aborted by the user";

export interface SubagentCompletion {
	agentId: string;
	toolCallId: string | undefined;
	title: string;
	outcome: ChildOutcome;
}

// The notice for a background subagent that ended. Its task id is the agent id, so a later notice for the same agent replaces one
// that has not been sent yet.
export function subagentFinishedNotice(completion: SubagentCompletion): BackgroundNotice {
	const { agentId, toolCallId, title, outcome } = completion;
	const status = outcome.status === "success" ? "success" : outcome.status === "error" ? "error" : "aborted";
	const detail = outcome.status === "success" ? outcome.text : outcome.status === "error" ? outcome.error : ABORTED_DETAIL;
	const lines = [
		"kind: subagent",
		`status: ${status}`,
		`task_id: ${escapeXml(agentId)}`,
		`title: ${escapeXml(title)}`,
		...(toolCallId === undefined ? [] : [`tool_call_id: ${escapeXml(toolCallId)}`]),
		`agent_id: ${escapeXml(agentId)}`,
		...(detail === undefined ? [] : [`detail: ${neutralizeCloseTags(detail)}`]),
	];
	const body = `<system_notification>\n${FINISHED_LEAD}\n\n<task>\n${lines.join("\n")}\n</task>\n</system_notification>`;
	return { taskId: agentId, body, acknowledgement: acknowledgement(status === "aborted") };
}

function acknowledgement(aborted: boolean): string {
	const text =
		ACKNOWLEDGEMENT_BASE + NAMED_LINK_INSTRUCTION + CLOUD_VIEW_LINK_INSTRUCTION + (aborted ? ABORTED_INSTRUCTION : "") + ACKNOWLEDGEMENT_SUFFIX;
	return `<user_query>${text}</user_query>`;
}

function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// A detail cannot close the task or notification block early (Cursor's neutralizeBackgroundTaskDetailCloseTags).
function neutralizeCloseTags(detail: string): string {
	return detail.replace(/<\/\s*(task|system_notification)\s*>/gi, "&lt;/$1>").replace(/<(\/?)\s*user_query\s*>/gi, "&lt;$1user_query>");
}
