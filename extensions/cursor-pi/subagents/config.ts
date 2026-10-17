// Cursor's subagent types as the cursor namespace's Subagent tool offers them. The catalog sections and the role and reminder
// texts are read from the captures that record Cursor's own output; the readonly, tool and reminder settings follow the
// configs in Cursor's agent/dist/tools/core/subagent modules.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_MODELS } from "../prompts.ts";

const REVERSE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "research", "cursor", "reverse");
const PARENT_USER_INFO = join(REVERSE, "runs-2026-10-16-T3", "items", "002-S1-user-f2fc311e.txt");
const EXPLORE_CAPTURE = join(REVERSE, "prompts", "items", "subagent-task-33666c41b589.md");
const ASK_MODE_REMINDER = join(REVERSE, "runs-2026-10-16-T3", "roles", "07-ask-mode-reminder-seen-in-bugbot.txt");
const BUGBOT_PROMPT = join(REVERSE, "runs-2026-10-16-T3", "roles", "03-bugbot-developer-prompt.txt");
const SECURITY_PROMPT = join(REVERSE, "runs-2026-10-16-T3", "roles", "04-security-review-developer-prompt.txt");
const CURSOR_GUIDE_ROLE = join(REVERSE, "runs-2026-10-16", "sol", "roles", "cursor-guide.md");
const CI_INVESTIGATOR_ROLE = join(REVERSE, "runs-2026-10-16", "sol", "roles", "ci-investigator.md");

// Cursor's DEFAULT_SUBAGENT_SYSTEM_REMINDER (subagent-config.js): every subagent is told it is one.
export const DEFAULT_SUBAGENT_REMINDER =
	"You are running as a subagent under a parent agent. Do not spawn additional subagents unless requested by the user or by your instructions. Do not create Cursor Canvas files unless requested by the user or by your instructions.";

// Cursor's subagent types in catalog order.
export const SUBAGENT_TYPE_ORDER = [
	"generalPurpose",
	"explore",
	"browser-use",
	"cursor-guide",
	"ci-investigator",
	"bugbot",
	"security-review",
	"best-of-n-runner",
] as const;
export type SubagentTypeName = (typeof SUBAGENT_TYPE_ORDER)[number];

export interface SubagentConfig {
	// Cursor's READONLY permission: the child runs in ask mode, after Cursor's ask-mode reminder.
	readonly: boolean;
	// Cursor's forceDefaultModel: the child keeps its default model whatever the model argument says.
	forceDefaultModel: boolean;
	// The child's tools, by the names the cursor-pi tools register under (Cursor's toolsOverride).
	tools: readonly string[];
	// Cursor's systemPromptOverride: the developer prompt that replaces the model's system prompt.
	rolePrompt?: () => string;
	// The parts of the subagent reminder that follow DEFAULT_SUBAGENT_REMINDER, in order.
	reminderParts: () => string[];
	// Explore's reminder shares the query's user message; the other types send the reminder as a message of its own.
	reminderWithQuery: boolean;
}

function read(path: string): string {
	return readFileSync(path, "utf8");
}

// The explore capture holds the explore prompt and the progress reporting block, in that order.
function exploreCapture(): { prompt: string; progress: string } {
	const text = read(EXPLORE_CAPTURE);
	const progressOpen = "<progress_reporting_instructions>";
	const progressClose = "</progress_reporting_instructions>";
	const promptStart = text.indexOf("You are a file search specialist");
	const progressStart = text.indexOf(progressOpen);
	const progressEnd = text.indexOf(progressClose);
	if (promptStart < 0 || progressStart < 0 || progressEnd < 0) throw new Error(`explore capture is incomplete: ${EXPLORE_CAPTURE}`);
	return {
		prompt: text.slice(promptStart, progressStart).trim(),
		progress: text.slice(progressStart, progressEnd + progressClose.length),
	};
}

const PROGRESS = () => exploreCapture().progress;
const CHILD_TOOLS = ["Glob", "rg", "ReadFile"];
const CHILD_TOOLS_WITH_PROGRESS = [...CHILD_TOOLS, "UpdateCurrentStep"];
// Cursor's toolsOverride for the edit tool: child.ts gives each model its own, StrReplace and Write for Anthropic models and ApplyPatch for the rest.
export const EDIT_TOOL_SET = "EditTools";
// The full caller tool set of Cursor's configs without an override, which the parent's tools stand for in a child.
const FULL_TOOL_SET = ["Shell", "Glob", "rg", "ReadFile", EDIT_TOOL_SET, "GetDynamicTools", "CallDynamicTool"];

// The types Cursor Pi runs. A type missing here is listed in the catalog and answers with an error when called.
export const SUBAGENT_CONFIGS: Partial<Record<SubagentTypeName, SubagentConfig>> = {
	generalPurpose: {
		readonly: false,
		forceDefaultModel: false,
		tools: CHILD_TOOLS_WITH_PROGRESS,
		reminderParts: () => [PROGRESS()],
		reminderWithQuery: true,
	},
	explore: {
		readonly: false,
		forceDefaultModel: false,
		tools: CHILD_TOOLS_WITH_PROGRESS,
		reminderParts: () => {
			const { prompt, progress } = exploreCapture();
			return [prompt, progress];
		},
		reminderWithQuery: true,
	},
	bugbot: {
		readonly: true,
		forceDefaultModel: true,
		tools: [...CHILD_TOOLS, "WebSearch"],
		rolePrompt: () => read(BUGBOT_PROMPT).trim(),
		reminderParts: () => [],
		reminderWithQuery: false,
	},
	"security-review": {
		readonly: true,
		forceDefaultModel: true,
		tools: [...CHILD_TOOLS_WITH_PROGRESS, "WebSearch"],
		rolePrompt: () => read(SECURITY_PROMPT).trim(),
		reminderParts: () => [PROGRESS()],
		reminderWithQuery: false,
	},
	// Cursor's cursor-guide config: readonly, its own tool set, and its captured role reminder, which carries the progress block.
	"cursor-guide": {
		readonly: true,
		forceDefaultModel: false,
		tools: ["ReadFile", "rg", "WebFetch", "WebSearch", "UpdateCurrentStep"],
		reminderParts: () => [capturedReminderBody(CURSOR_GUIDE_ROLE)],
		reminderWithQuery: false,
	},
	// Cursor's ci-investigator config: not readonly, the caller's full tool set, and its captured role reminder.
	"ci-investigator": {
		readonly: false,
		forceDefaultModel: false,
		tools: [...FULL_TOOL_SET, "UpdateCurrentStep"],
		reminderParts: () => [capturedReminderBody(CI_INVESTIGATOR_ROLE)],
		reminderWithQuery: false,
	},
	// Cursor's best-of-n-runner config: the caller's full tool set and only the default reminder. Cursor's worktree command is
	// prepended to the prompt by the Cursor client, not by this config.
	"best-of-n-runner": {
		readonly: false,
		forceDefaultModel: false,
		tools: FULL_TOOL_SET,
		reminderParts: () => [],
		reminderWithQuery: false,
	},
};

// The reminder a captured subagent role carries: its text after Cursor's default reminder, progress block included.
function capturedReminderBody(path: string): string {
	const text = read(path).trim();
	const open = "<system_reminder>\n";
	const close = "\n</system_reminder>";
	const head = `${open}${DEFAULT_SUBAGENT_REMINDER}\n\n`;
	if (!text.startsWith(head) || !text.endsWith(close)) throw new Error(`${path} is not a captured subagent reminder`);
	return text.slice(head.length, text.length - close.length).trim();
}

// Cursor's ask-mode reminder, which a readonly child gets before its subagent reminder.
export function askModeReminder(): string {
	return read(ASK_MODE_REMINDER).trim();
}

function capturedSection(tag: string): string {
	const text = read(PARENT_USER_INFO);
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	const start = text.indexOf(open);
	const end = start < 0 ? -1 : text.indexOf(close, start);
	if (end < 0) throw new Error(`${tag} is missing from ${PARENT_USER_INFO}`);
	return text.slice(start, end + close.length);
}

// Cursor's <available_subagent_types> section, as the parent's user_info captured it.
export function renderAvailableSubagentTypes(): string {
	return capturedSection("available_subagent_types");
}

// Cursor's <available_subagent_models> section with Cursor Pi's models in place of Cursor's server list: inherit, then
// each supported model in sorted order.
export function renderAvailableSubagentModels(): string {
	const section = capturedSection("available_subagent_models");
	const inheritStart = section.indexOf("- inherit (");
	const tailStart = section.indexOf("\n\nIf the user isn't asking");
	if (inheritStart < 0 || tailStart < 0) throw new Error("captured available_subagent_models has an unexpected layout");
	const inheritLine = section.slice(inheritStart, section.indexOf("\n", inheritStart) + 1);
	const slugs = [...SUPPORTED_MODELS].sort().map((slug) => `- ${slug}`);
	return `${section.slice(0, inheritStart)}${inheritLine}${slugs.join("\n")}${section.slice(tailStart)}`;
}

// The catalog sections that the parent's user_info carries between its rules and its skills.
export function renderSubagentCatalog(): string {
	return `${renderAvailableSubagentTypes()}\n\n${renderAvailableSubagentModels()}`;
}
