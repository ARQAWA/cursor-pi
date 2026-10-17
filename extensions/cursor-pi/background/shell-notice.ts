import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { onShellJobCompletion, type ShellJobInfo } from "../tools/shell/background.ts";
import type { OutputNotice } from "../tools/shell/output-notification.ts";
import { type BackgroundNotice, queueBackgroundNotice } from "./notices.ts";

// Cursor's SHELL_NOTIFICATION_ACKNOWLEDGEMENT_USER_QUERY: the query that ends a batch whose last notice is about a shell.
const SHELL_ACKNOWLEDGEMENT = "<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed).</user_query>";
const FINISHED_LEAD = "The following task has finished. If you were already aware, ignore this notification and do not restate prior responses.";
const NOTIFIED_LEAD = "The following task has notified. If you were already aware, ignore this notification and do not restate prior responses.";
// Cursor sends a task-progress completion to the model only when its enableBackgroundTaskProgress flag is on. No captured request
// carries that flag, so the progress notices that notify_on_output raises are recorded and not sent.
const BACKGROUND_TASK_PROGRESS_ENABLED = false;

let extension: ExtensionAPI | undefined;

// Queues a notice when a background shell finishes.
export function registerShellNotices(pi: ExtensionAPI): void {
	extension = pi;
	onShellJobCompletion((job) => queueBackgroundNotice(pi, shellFinishedNotice(job)));
}

// Called by the notify_on_output observer for each progress notice.
export function emitShellProgress(notice: OutputNotice): void {
	if (!BACKGROUND_TASK_PROGRESS_ENABLED || extension === undefined) return;
	queueBackgroundNotice(extension, shellProgressNotice(notice));
}

// Cursor's formatBackgroundCompletionsBody for one finished shell.
export function shellFinishedNotice(job: ShellJobInfo): BackgroundNotice {
	return { taskId: String(job.id), body: notificationBody(FINISHED_LEAD, shellFinishedLines(job)), acknowledgement: SHELL_ACKNOWLEDGEMENT };
}

// Cursor's formatBackgroundCompletionsBody for one task-progress completion of a shell.
export function shellProgressNotice(notice: OutputNotice): BackgroundNotice {
	const lines = [
		"kind: shell",
		"status: success",
		`task_id: ${escapeXml(notice.taskId)}`,
		`title: ${escapeXml(notice.title)}`,
		...(notice.toolCallId === undefined ? [] : [`tool_call_id: ${escapeXml(notice.toolCallId)}`]),
		`detail: ${neutralizeCloseTags(notice.detail)}`,
		`output_path: ${escapeXml(notice.outputPath)}`,
	];
	return { taskId: notice.taskId, body: notificationBody(NOTIFIED_LEAD, lines), acknowledgement: SHELL_ACKNOWLEDGEMENT };
}

function notificationBody(lead: string, lines: string[]): string {
	return `<system_notification>\n${lead}\n\n<task>\n${lines.join("\n")}\n</task>\n</system_notification>`;
}

// The task section's lines in Cursor's order: kind, status, task_id, title, tool_call_id, detail and output_path.
function shellFinishedLines(job: ShellJobInfo): string[] {
	const detail = detailOf(job);
	return [
		"kind: shell",
		`status: ${statusOf(job)}`,
		`task_id: ${escapeXml(String(job.id))}`,
		`title: ${escapeXml(job.description || job.command)}`,
		...(job.toolCallId === undefined ? [] : [`tool_call_id: ${escapeXml(job.toolCallId)}`]),
		...(detail === undefined ? [] : [`detail: ${neutralizeCloseTags(detail)}`]),
		`output_path: ${escapeXml(job.outputPath)}`,
	];
}

function statusOf(job: ShellJobInfo): string {
	return job.status === "succeeded" ? "success" : job.status === "failed" ? "error" : "aborted";
}

// Cursor's shellCompletionDetail: nothing for an aborted shell, its signal when a signal ended it, else a nonzero exit code.
function detailOf(job: ShellJobInfo): string | undefined {
	if (job.status === "aborted") return undefined;
	if (job.signal !== undefined) return `signal=${job.signal}`;
	if (job.exitCode !== null && job.exitCode !== undefined && job.exitCode !== 0) return `exit_code=${job.exitCode}`;
	return undefined;
}

// Cursor's escapePromptXmlText.
function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Cursor's neutralizeBackgroundTaskDetailCloseTags: a detail cannot close the task or notification block early.
function neutralizeCloseTags(detail: string): string {
	return detail.replace(/<\/\s*(task|system_notification)\s*>/gi, "&lt;/$1>").replace(/<(\/?)\s*user_query\s*>/gi, "&lt;$1user_query>");
}
