import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_FEATURE_FLAGS } from "../feature-flags.ts";
import { buildTimestampPrefix, resolveTimeZone } from "../user-turn.ts";

// Background task notices. Each one is sent as a user message whose text is a <system_notification> block (Cursor's
// BackgroundTaskCompletionActionHandler). Shell and subagent notices share this delivery; the caller gives the body and the
// acknowledgement.
const NOTICE_TYPE = "cursor-pi-background-completion";

export interface BackgroundNotice {
	// The task the notice is about. A notice queued later for the same task replaces one that has not been sent yet.
	taskId: string;
	// The <system_notification> block, without the timestamp line that user turns carry.
	body: string;
	// The query that ends the batch. Only the last notice of a batch carries it.
	acknowledgement?: string;
}

interface QueuedNotice {
	taskId: string;
	text: string;
	acknowledgement: string | undefined;
}

// Notices waiting to be sent, by task id, in the order they were queued.
const pending = new Map<string, QueuedNotice>();
// Tasks an await tool has returned as finished: they get no notice (Cursor's markAwaitedCompletion).
const observed = new Set<string>();
// Whether an agent run is in progress; a notice queued during a run waits for the run to settle.
let runActive = false;

export function registerBackgroundNotices(pi: ExtensionAPI): void {
	pi.on("agent_start", () => {
		runActive = true;
	});
	pi.on("agent_settled", () => {
		runActive = false;
		flush(pi);
	});
}

// Queues a notice: sent at once when the session is idle, and at the end of the run otherwise.
export function queueBackgroundNotice(pi: ExtensionAPI, notice: BackgroundNotice): void {
	if (observed.has(notice.taskId)) return;
	const prefix = CURSOR_FEATURE_FLAGS.userMessageTimestamps ? buildTimestampPrefix(new Date(), resolveTimeZone()) : "";
	pending.set(notice.taskId, { taskId: notice.taskId, text: `${prefix}${notice.body}`, acknowledgement: notice.acknowledgement });
	if (!runActive) flush(pi);
}

// Called by an await tool when it returns a finished task, so no notice follows for that task.
export function observeBackgroundTaskExit(taskId: string): void {
	observed.add(taskId);
	pending.delete(taskId);
}

function flush(pi: ExtensionAPI): void {
	if (pending.size === 0) return;
	const notices = [...pending.values()];
	pending.clear();
	void send(pi, notices);
}

// One message per notice, as Cursor appends them. Only the last one starts the turn that carries them all.
async function send(pi: ExtensionAPI, notices: QueuedNotice[]): Promise<void> {
	for (const [index, notice] of notices.entries()) {
		const last = index === notices.length - 1;
		const content = last && notice.acknowledgement !== undefined ? `${notice.text}\n${notice.acknowledgement}` : notice.text;
		await pi.sendMessage({ customType: NOTICE_TYPE, content, display: true }, { triggerTurn: last });
	}
}
