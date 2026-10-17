import { CURSOR_FEATURE_FLAGS } from "./feature-flags.ts";

// The machine's time zone, which Cursor uses for the timestamp of a user turn.
export function resolveTimeZone(): string {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// Cursor's buildTimestampPrefix: the local date, time and UTC offset of the turn, on a line of its own.
export function buildTimestampPrefix(now: Date, timeZone: string): string {
	const formatted = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "long",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).format(now);
	const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
		.formatToParts(now)
		.find((part) => part.type === "timeZoneName");
	return `<timestamp>${formatted} (${(offset?.value ?? "UTC").replace("GMT", "UTC")})</timestamp>\n`;
}

// Cursor's renderUserTurnText for an ordinary user message: no eager editing note, no forked context, no sender.
export function renderUserTurnText(text: string): string {
	return `<user_query>\n${text}\n</user_query>`;
}

// The text Cursor sends for a user turn.
export function wrapUserTurn(text: string, now: Date, timeZone: string): string {
	const prefix = CURSOR_FEATURE_FLAGS.userMessageTimestamps ? buildTimestampPrefix(now, timeZone) : "";
	return `${prefix}${renderUserTurnText(text)}`;
}
