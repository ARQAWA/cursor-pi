import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The user message that stands for a Codex compaction item until the request payload is built. The payload carries the
// server's encrypted item in its place, so the marker never reaches the wire.
export const CODEX_ITEM_MARKER = "cursor-pi-compaction-item";

// The headers Claude Code sends with its compaction request, and the ones it sends with the first request after it.
export const CLAUDE_COMPACTION_HEADERS: Record<string, string> = {
	"x-claude-code-request-class": "compaction",
	"x-claude-code-compaction": "manual",
	"x-cc-compaction-request": "manual",
};
export const CLAUDE_CONTEXT_COMPACTED_HEADERS: Record<string, string> = {
	"x-claude-code-context-compacted": "manual",
	"x-cc-context-compacted": "manual",
};

// Claude Code's message that replaces the summary in the next request, with the summary and the transcript path filled in.
export function continuationText(summary: string, transcriptPath: string): string {
	return [
		"This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
		"",
		"Summary:",
		summary,
		"",
		`If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcriptPath}`,
		'Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I\'ll continue" or similar. Pick up the last task as if the break never happened.',
		"",
		"The messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.",
	].join("\n");
}

// The summary inside the <summary> block of Claude's reply. Text outside the block is dropped.
export function summaryOf(reply: string): string {
	const match = /<summary>([\s\S]*?)<\/summary>/.exec(reply);
	if (match === null) throw new Error("the reply has no <summary> block");
	return match[1].trim();
}

// The `short` arm of Claude Code's compaction instruction: the text its TUI sent on the captured account.
const INSTRUCTION_FILE = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"research",
	"cursor",
	"reverse",
	"claude-code-prompts",
	"compaction",
	"prompts",
	"arm-short.txt",
);
let instruction: string | undefined;

export function compactionInstruction(): string {
	instruction ??= readFileSync(INSTRUCTION_FILE, "utf8");
	return instruction;
}
