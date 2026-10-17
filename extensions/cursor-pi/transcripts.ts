import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { projectDirFor, transcriptsDirFor } from "./tools/shell/paths.ts";

// Writes each session's conversation to ~/.cursor-pi/projects/<slug>/agent-transcripts/<id>/<id>.jsonl, in the layout and
// JSONL format that Cursor Desktop writes for its own chats.

type AgentMessage = SessionMessageEntry["message"];
type TurnEnded = { status: "success" } | { status: "error"; error: string };

// Tagged blocks that Cursor removes from user text before a transcript line is written.
const CONTEXT_TAGS_TO_STRIP = [
	"user_info",
	"project_layout",
	"rules",
	"always_applied_workspace_rules",
	"agent_requestable_workspace_rules",
	"user_rules",
	"agent_skills",
	"available_skills",
	"cloud_instructions",
	"cloud_task_instructions",
	"open_and_recently_viewed_files",
	"system_reminder",
	"system-reminder",
	"instructions_update",
	"mcp_instructions",
	"mcp_file_system",
	"mcp_file_system_servers",
	"git_status",
	"agent_transcripts",
	"cursor_rules_context",
	"attached_files",
	"system_notification",
	"task_notification",
	"agent_notification",
];

const MAX_CONVERSATION_ID_LENGTH = 200;

// Number of branch messages that each conversation's transcript file already holds.
const writtenCounts = new Map<string, number>();
// Writes run one at a time, in event order.
let queue: Promise<void> = Promise.resolve();

function stripContextTags(text: string): string {
	let result = text;
	for (const tag of CONTEXT_TAGS_TO_STRIP) {
		result = result.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "gi"), "");
	}
	return result.replace(/\n{3,}/g, "\n\n").trim();
}

function stripHiddenThinkingTags(text: string): string {
	return text
		.replace(/<think>[\s\S]*?<\/think>/gi, "")
		.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function messageLine(role: "user" | "assistant", text: string, toolUses: { name: string; input: unknown }[]): string | undefined {
	const content: unknown[] = [];
	if (text) content.push({ type: "text", text });
	for (const toolUse of toolUses) content.push({ type: "tool_use", name: toolUse.name, input: toolUse.input });
	return content.length > 0 ? JSON.stringify({ role, message: { content } }) : undefined;
}

// One line per message. Tool results write nothing. Cursor also drops a leading user_info message; Pi keeps none.
export function transcriptLine(message: AgentMessage): string | undefined {
	if (message.role === "user") {
		const parts = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
		const texts: string[] = [];
		for (const part of parts) {
			if (part.type === "text") {
				const text = stripContextTags(part.text);
				if (text) texts.push(text);
			} else {
				texts.push("[Image]");
			}
		}
		return messageLine("user", texts.join("\n"), []);
	}
	if (message.role === "assistant") {
		const texts: string[] = [];
		const reasoning: string[] = [];
		const toolUses: { name: string; input: unknown }[] = [];
		for (const part of message.content) {
			if (part.type === "text") {
				const text = stripHiddenThinkingTags(part.text);
				if (text) texts.push(text);
			} else if (part.type === "thinking") {
				if (part.redacted) reasoning.push("[REDACTED]");
				else if (part.thinking.trim()) reasoning.push(part.thinking);
			} else {
				toolUses.push({ name: part.name, input: part.arguments });
			}
		}
		return messageLine("assistant", [texts.join("\n"), reasoning.join("\n")].filter(Boolean).join("\n\n"), toolUses);
	}
	return undefined;
}

// How a finished agent run ends. Cursor records a user stop as an error with this text.
function turnEndedOf(messages: AgentMessage[]): TurnEnded {
	const last = messages.findLast((message) => message.role === "assistant");
	if (last?.role !== "assistant") return { status: "success" };
	if (last.stopReason === "error") return { status: "error", error: last.errorMessage ?? "Error" };
	if (last.stopReason === "aborted") return { status: "error", error: "user_stopped_generation" };
	return { status: "success" };
}

// Cursor's file name for a conversation id: URL-encoded, with % turned into _, and cut to 200 characters.
function conversationFileName(conversationId: string): string {
	return encodeURIComponent(conversationId).replace(/%/g, "_").slice(0, MAX_CONVERSATION_ID_LENGTH);
}

// Writes what the branch gained since the last write, as Cursor's TranscriptStore does: the whole file on the first write
// or when the branch got shorter, otherwise only the new lines appended, followed by any turn_ended line.
async function writeTranscript(ctx: ExtensionContext, turnEnded?: TurnEnded): Promise<void> {
	const conversationId = ctx.sessionManager.getSessionId();
	const messages = ctx.sessionManager.getBranch().flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
	const done = writtenCounts.get(conversationId) ?? 0;
	const terminal = turnEnded ? [JSON.stringify({ type: "turn_ended", ...turnEnded })] : [];
	if (messages.length === done && terminal.length === 0) return;

	const name = conversationFileName(conversationId);
	const dir = join(transcriptsDirFor(projectDirFor(ctx.cwd)), name);
	const append = done > 0 && messages.length >= done;
	const lines = (append ? messages.slice(done) : messages).flatMap((message) => {
		const line = transcriptLine(message);
		return line ? [line] : [];
	});
	lines.push(...terminal);
	if (lines.length > 0) {
		await mkdir(dir, { recursive: true });
		const content = `${lines.join("\n")}\n`;
		if (append) await appendFile(join(dir, `${name}.jsonl`), content);
		else await writeFile(join(dir, `${name}.jsonl`), content);
	}
	writtenCounts.set(conversationId, messages.length);
}

function writeSafely(ctx: ExtensionContext, turnEnded?: TurnEnded): Promise<void> {
	queue = queue.then(async () => {
		try {
			await writeTranscript(ctx, turnEnded);
		} catch (error) {
			ctx.ui.notify(`Cursor Pi could not write the transcript: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	});
	return queue;
}

// The file that holds the session's transcript, as writeTranscript names it.
export function transcriptPathOf(ctx: ExtensionContext): string {
	const name = conversationFileName(ctx.sessionManager.getSessionId());
	return join(transcriptsDirFor(projectDirFor(ctx.cwd)), name, `${name}.jsonl`);
}

// Cursor checkpoints its transcript after each step, and Pi's turn_end comes once a step's messages are in the session.
// Pi's message_end is not used: it would write before Cursor's checkpoint does. agent_end writes what is left, then the
// turn_ended marker, as Cursor does when a turn finishes.
export function register(pi: ExtensionAPI): void {
	pi.on("turn_end", (_event, ctx) => writeSafely(ctx));
	pi.on("agent_end", (event, ctx) => writeSafely(ctx, turnEndedOf(event.messages)));
}
