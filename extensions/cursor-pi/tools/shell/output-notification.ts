// Cursor's notify_on_output observer (local-exec/dist/background-shell.js, ShellOutputNotificationObserver). A pattern in a shell's
// output raises progress notices: the first match at once, later matches batched for at least five seconds, and 100 at most. The
// pattern is compiled as a JavaScript regex with the m and g flags; Cursor compiles it as RE2 in multiline mode.

export interface OutputNotificationConfig {
	pattern: string;
	reason: string;
	debounce_ms?: number;
}

// One progress notice, as the observer hands it to the shell notices.
export interface OutputNotice {
	taskId: string;
	toolCallId?: string;
	title: string;
	detail: string;
	outputPath: string;
}

export interface OutputNotifierOptions {
	shellId: number;
	outputPath: string;
	toolCallId?: string;
	config: OutputNotificationConfig;
	emit: (notice: OutputNotice) => void;
}

const NOTIFICATION_LIMIT = 100;
const MIN_DEBOUNCE_MS = 5000;
// Characters kept from the end of the output, so a match that starts before a chunk boundary is still found.
const CARRYOVER_CHARS = 1024;
const MAX_PATTERN_CHARS = 500;
// Longer chunks are scanned in pieces of this size.
const MAX_SCAN_CHARS = 64 * 1024;
const MAX_NOTIFICATION_TEXT_CHARS = 500;
const MAX_MATCHED_TEXT_CHARS = 5000;

interface Batch {
	startOccurrence: number;
	count: number;
	matchedTextDetail: string;
}

export class ShellOutputNotifier {
	private readonly regex: RegExp;
	private carryover = "";
	private matched = 0;
	private emitted = 0;
	private finished = false;
	private pendingBatch: Batch | undefined;
	private flushTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly options: OutputNotifierOptions) {
		if (options.config.pattern.length > MAX_PATTERN_CHARS) {
			throw new Error(`Output notification pattern exceeds ${MAX_PATTERN_CHARS} characters`);
		}
		this.regex = new RegExp(options.config.pattern, "gm");
	}

	// Scans a chunk of output. A match that ends inside the carried-over tail was reported with an earlier chunk.
	observe(data: string): void {
		if (this.finished || this.matched >= NOTIFICATION_LIMIT || data.length === 0) return;
		if (data.length > MAX_SCAN_CHARS) {
			for (let offset = 0; offset < data.length && this.matched < NOTIFICATION_LIMIT; offset += MAX_SCAN_CHARS) {
				this.observe(data.slice(offset, offset + MAX_SCAN_CHARS));
			}
			return;
		}
		const previousLength = this.carryover.length;
		const searchable = `${this.carryover}${data}`;
		this.regex.lastIndex = 0;
		let match = this.regex.exec(searchable);
		while (match !== null && this.matched < NOTIFICATION_LIMIT) {
			if (match[0].length === 0) this.regex.lastIndex += 1;
			if (match.index + match[0].length > previousLength) this.queueMatch(match[0]);
			match = this.regex.exec(searchable);
		}
		this.carryover = searchable.slice(-CARRYOVER_CHARS);
	}

	// Ends the observation: a batch still waiting for its debounce is sent now.
	finish(): void {
		if (this.finished) return;
		this.finished = true;
		this.flushPendingBatch();
		this.clearFlushTimer();
	}

	private queueMatch(text: string): void {
		if (this.matched >= NOTIFICATION_LIMIT) return;
		this.matched += 1;
		const occurrence = this.matched;
		const matchedTextDetail = formatMatchedTextDetail(text, occurrence === 1 ? "Matched text" : "Latest match");
		if (occurrence === 1) {
			this.emitNotification({ startOccurrence: occurrence, count: 1, matchedTextDetail });
			return;
		}
		if (this.pendingBatch === undefined) {
			this.pendingBatch = { startOccurrence: occurrence, count: 1, matchedTextDetail };
		} else {
			this.pendingBatch.count += 1;
			this.pendingBatch.matchedTextDetail = matchedTextDetail;
		}
		if (occurrence === NOTIFICATION_LIMIT) {
			this.flushPendingBatch();
			this.emitLimitReached();
			return;
		}
		this.scheduleFlush();
	}

	private scheduleFlush(): void {
		if (this.flushTimer !== undefined) return;
		const debounceMs = Math.max(this.options.config.debounce_ms ?? MIN_DEBOUNCE_MS, MIN_DEBOUNCE_MS);
		this.flushTimer = setTimeout(() => this.flushPendingBatch(), debounceMs);
	}

	private clearFlushTimer(): void {
		if (this.flushTimer !== undefined) {
			clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
	}

	private flushPendingBatch(): void {
		const batch = this.pendingBatch;
		if (batch === undefined) return;
		this.pendingBatch = undefined;
		this.clearFlushTimer();
		this.emitNotification(batch);
	}

	private emitNotification(batch: Batch): void {
		const { pattern, reason } = this.options.config;
		const matchedTextSentence = ` ${batch.matchedTextDetail}.`;
		const detail =
			batch.count === 1
				? `Shell output has pattern /${pattern}/. This is occurrence number ${batch.startOccurrence}.${matchedTextSentence} The title message is being displayed to the user.`
				: `Shell output matched /${pattern}/ ${batch.count} more times since the previous notification. The title message is being displayed to the user.${matchedTextSentence}`;
		this.send(truncateText(reason.trim() || `Shell output contains /${pattern}/`), detail);
	}

	private emitLimitReached(): void {
		this.send(
			`Notification limit reached (${NOTIFICATION_LIMIT})`,
			`Shell output matched /${this.options.config.pattern}/ ${NOTIFICATION_LIMIT} times and has reached the notification limit. No further notifications will be sent for this pattern. To continue monitoring, read the output file directly at the output path.`,
		);
	}

	private send(title: string, detail: string): void {
		this.emitted += 1;
		this.options.emit({
			taskId: `${this.options.shellId}:task_progress:${this.emitted}`,
			toolCallId: this.options.toolCallId,
			title,
			detail,
			outputPath: this.options.outputPath,
		});
	}
}

// The observer for a shell, or undefined when the pattern is blank or is not a valid regex.
export function createOutputNotifier(options: OutputNotifierOptions): ShellOutputNotifier | undefined {
	if (options.config.pattern.trim().length === 0) return undefined;
	try {
		return new ShellOutputNotifier(options);
	} catch {
		return undefined;
	}
}

// Cursor's formatMatchedTextDetail: the matched text itself, unless it is too long to show.
function formatMatchedTextDetail(matchedText: string, label: string): string {
	if (matchedText.length <= MAX_MATCHED_TEXT_CHARS) return `${label}: ${matchedText}`;
	return `${label} is ${matchedText.length} characters; omitted from notification detail.`;
}

// Cursor's truncateNotificationText.
function truncateText(value: string): string {
	return value.length <= MAX_NOTIFICATION_TEXT_CHARS ? value : `${value.slice(0, MAX_NOTIFICATION_TEXT_CHARS)}...`;
}
