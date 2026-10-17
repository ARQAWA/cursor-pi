import { monitorEventLoopDelay, performance } from "node:perf_hooks";

// Cursor's shell output suppression (shell-exec/dist/runtime-env/output-suppression.js and event-loop-pressure.js). Output that
// comes too fast is cut off from the run: once the gate closes, the rest of the output is dropped and one notice stands in for it.
// The gate stays closed for the rest of the run.

const WINDOW_MS = 60_000;
const BUCKET_MS = 1000;
// Output that must be in the window before the gate can close.
const MIN_CHARS = 256 * 1024;
// A rate that closes the gate on its own, and the lower rate that closes it while the event loop is under pressure.
const RATE_WITHOUT_PRESSURE = 2 * 1024 * 1024;
const RATE_WITH_PRESSURE = 64 * 1024;
// The event loop is under pressure at a p95 delay of 50 ms or a utilization of 70%, sampled every 250 ms.
const PRESSURE_DELAY_P95_MS = 50;
const PRESSURE_UTILIZATION = 0.7;
const SAMPLE_INTERVAL_MS = 250;
const EVENT_LOOP_RESOLUTION_MS = 20;

// Cursor's notice, sent once in place of the output the gate drops.
export const SHELL_OUTPUT_SUPPRESSED_NOTICE = "\n[This shell is producing too much output to stream. The command will still run.]\n";

// One tracker serves every shell, as Cursor's shared tracker does.
class EventLoopPressureTracker {
	private readonly monitor = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
	private lastUtilization = performance.eventLoopUtilization();
	private delayP95Ms = 0;
	private utilization = 0;

	constructor() {
		this.monitor.enable();
		this.sample();
		setInterval(() => this.sample(), SAMPLE_INTERVAL_MS).unref();
	}

	isUnderPressure(): boolean {
		return this.delayP95Ms >= PRESSURE_DELAY_P95_MS || this.utilization >= PRESSURE_UTILIZATION;
	}

	private sample(): void {
		const p95Ns = this.monitor.percentile(95);
		this.monitor.reset();
		this.delayP95Ms = Number.isFinite(p95Ns) ? Math.max(0, p95Ns / 1e6 - EVENT_LOOP_RESOLUTION_MS) : 0;
		const current = performance.eventLoopUtilization();
		const active = current.active - this.lastUtilization.active;
		const total = active + (current.idle - this.lastUtilization.idle);
		this.lastUtilization = current;
		this.utilization = Number.isFinite(total) && total > 0 ? active / total : 0;
	}
}

let sharedTracker: EventLoopPressureTracker | undefined;

export interface GateDecision {
	shouldForward: boolean;
	noticeJustTriggered: boolean;
}

// Counts output in one-second buckets over the window, and decides when the gate closes.
export class OutputSuppressionController {
	private readonly bucketChars = new Uint32Array(Math.ceil(WINDOW_MS / BUCKET_MS) + 1);
	private readonly bucketStarts = new Float64Array(Math.ceil(WINDOW_MS / BUCKET_MS) + 1);
	private totalChars = 0;
	private suppressed = false;
	private noticeSent = false;

	// Counts a chunk of output at time now (in milliseconds). shouldForward is false once the gate has closed.
	record(chars: number, now: number = Date.now()): GateDecision {
		this.recordChars(chars, now);
		sharedTracker ??= new EventLoopPressureTracker();
		const underPressure = sharedTracker.isUnderPressure();
		const charsInWindow = this.getCharsInWindow(now);
		const charsPerSecond = this.getAverageCharsPerSecond(now);
		const withoutPressureRate = Math.max(charsPerSecond, this.getPeakBucketCharsPerSecond(now));
		const meetsMinVolume = charsInWindow >= MIN_CHARS;
		const closesWithoutPressure = meetsMinVolume && withoutPressureRate >= RATE_WITHOUT_PRESSURE;
		const closesWithPressure = meetsMinVolume && underPressure && charsPerSecond >= RATE_WITH_PRESSURE;
		if (!this.suppressed && (closesWithoutPressure || closesWithPressure)) this.suppressed = true;
		const noticeJustTriggered = this.suppressed && !this.noticeSent;
		if (noticeJustTriggered) this.noticeSent = true;
		return { shouldForward: !this.suppressed, noticeJustTriggered };
	}

	private recordChars(chars: number, now: number): void {
		this.prune(now);
		if (chars <= 0) return;
		const bucketStart = Math.floor(now / BUCKET_MS) * BUCKET_MS;
		const index = Math.floor(bucketStart / BUCKET_MS) % this.bucketChars.length;
		if (this.bucketStarts[index] !== bucketStart) {
			this.totalChars -= this.bucketChars[index];
			this.bucketStarts[index] = bucketStart;
			this.bucketChars[index] = 0;
		}
		this.bucketChars[index] += chars;
		this.totalChars += chars;
	}

	private getAverageCharsPerSecond(now: number): number {
		this.prune(now);
		if (this.totalChars === 0) return 0;
		const cutoff = now - WINDOW_MS;
		let oldest = now;
		for (let i = 0; i < this.bucketStarts.length; i++) {
			if (this.bucketChars[i] > 0 && this.bucketStarts[i] >= cutoff) oldest = Math.min(oldest, this.bucketStarts[i]);
		}
		const elapsedMs = Math.max(BUCKET_MS, Math.min(WINDOW_MS, now - oldest + BUCKET_MS));
		return this.totalChars / (elapsedMs / 1000);
	}

	private getPeakBucketCharsPerSecond(now: number): number {
		this.prune(now);
		const cutoff = now - WINDOW_MS;
		let peak = 0;
		for (let i = 0; i < this.bucketChars.length; i++) {
			if (this.bucketStarts[i] >= cutoff) peak = Math.max(peak, this.bucketChars[i]);
		}
		return peak / (BUCKET_MS / 1000);
	}

	private getCharsInWindow(now: number): number {
		this.prune(now);
		return this.totalChars;
	}

	private prune(now: number): void {
		const cutoff = now - WINDOW_MS;
		for (let i = 0; i < this.bucketStarts.length; i++) {
			if (this.bucketStarts[i] !== 0 && this.bucketStarts[i] < cutoff) {
				this.totalChars -= this.bucketChars[i];
				this.bucketStarts[i] = 0;
				this.bucketChars[i] = 0;
			}
		}
	}
}
