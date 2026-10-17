import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_FEATURE_FLAGS } from "../../feature-flags.ts";
import { buildTimestampPrefix, resolveTimeZone } from "../../user-turn.ts";
import { type ShellJobInfo, onShellJobCompletion } from "./background.ts";

// Cursor's end-of-turn notice for a finished background shell: the completion goes out as a system_notification user message
// (formatBackgroundCompletionsBody), and the last notice of a batch ends with the shell acknowledgement query.
const NOTICE_TYPE = "cursor-pi-background-completion";
const SHELL_ACKNOWLEDGEMENT = "<user_query>Briefly inform the user about the task result and perform any follow-up actions (if needed).</user_query>";

// Finished shells waiting for a notice, by shell id, in the order they finished.
const pending = new Map<string, ShellJobInfo>();
// Shells an AwaitShell call has returned as finished: they get no notice (Cursor's markAwaitedCompletion).
const observed = new Set<string>();
// Whether an agent run is in progress; a completion during a run waits for the run to settle.
let runActive = false;

// Sends a notice for each finished shell as soon as the session is idle, and at the end of a run otherwise.
export function registerShellNotices(pi: ExtensionAPI): void {
	onShellJobCompletion((job) => {
		const id = String(job.id);
		if (observed.has(id)) return;
		pending.set(id, job);
		if (!runActive) flush(pi);
	});
	pi.on("agent_start", () => {
		runActive = true;
	});
	pi.on("agent_settled", () => {
		runActive = false;
		flush(pi);
	});
}

// Called by AwaitShell when it returns a finished shell, so the notice for that shell is skipped.
export function observeShellExit(taskId: string): void {
	observed.add(taskId);
	pending.delete(taskId);
}

function flush(pi: ExtensionAPI): void {
	if (pending.size === 0) return;
	const jobs = [...pending.values()];
	pending.clear();
	void send(pi, jobs);
}

// One message per notice, as Cursor appends them. Only the last one starts the turn that carries them all.
async function send(pi: ExtensionAPI, jobs: ShellJobInfo[]): Promise<void> {
	for (const [index, job] of jobs.entries()) {
		const last = index === jobs.length - 1;
		await pi.sendMessage({ customType: NOTICE_TYPE, content: noticeText(job, last ? SHELL_ACKNOWLEDGEMENT : undefined), display: true }, { triggerTurn: last });
	}
}

// Cursor's formatBackgroundCompletionsBody for one shell, after the timestamp line that user turns carry.
function noticeText(job: ShellJobInfo, acknowledgement: string | undefined): string {
	const prefix = CURSOR_FEATURE_FLAGS.userMessageTimestamps ? buildTimestampPrefix(new Date(), resolveTimeZone()) : "";
	const task = taskLines(job).join("\n");
	const notice = `<system_notification>\nThe following task has finished. If you were already aware, ignore this notification and do not restate prior responses.\n\n<task>\n${task}\n</task>\n</system_notification>`;
	return `${prefix}${notice}${acknowledgement === undefined ? "" : `\n${acknowledgement}`}`;
}

// The task section's lines in Cursor's order: kind, status, task_id, title, tool_call_id, detail and output_path.
function taskLines(job: ShellJobInfo): string[] {
	const detail = detailOf(job);
	return [
		"kind: shell",
		`status: ${statusOf(job)}`,
		`task_id: ${escapeXml(String(job.id))}`,
		`title: ${escapeXml(job.description || job.command)}`,
		...(job.toolCallId === undefined ? [] : [`tool_call_id: ${escapeXml(job.toolCallId)}`]),
		...(detail === undefined ? [] : [`detail: ${detail}`]),
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
