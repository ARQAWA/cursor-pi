// The cursor namespace's Subagent tool, as Cursor Desktop 3.25.6 defines it: its argument rules, the model each type runs,
// readonly mode, resume by agent id, and the text the parent receives.
import { randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionToolContext, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { queueBackgroundNotice } from "../background/notices.ts";
import { subagentFinishedNotice } from "../background/subagent-notice.ts";
import { capturedConciseInstruction } from "../dynamic/captured-instructions.ts";
import { type DynamicToolResult, registerDynamicTool } from "../dynamic/registry.ts";
import { SUPPORTED_MODELS } from "../prompts.ts";
import { type ArgIssue, booleanLike, checkType, invalidArguments, optionalString } from "../tools/cursor-args.ts";
import { capturedNamespaceDeclaration } from "../tools/namespace/captured.ts";
import { type ChildAgent, type ChildOutcome, createChild, findChild, parentModelRuntime, runChild } from "./child.ts";
import { SUBAGENT_CONFIGS, SUBAGENT_TYPE_ORDER, type SubagentConfig, type SubagentTypeName } from "./config.ts";

const SUBAGENT = capturedNamespaceDeclaration("Subagent");
const DEFAULT_TYPE: SubagentTypeName = "generalPurpose";

// Argument errors that Cursor Pi does not run yet: placement and attachments.
const UNSUPPORTED_PLACEMENT = "Cloud and machine placement are not supported in Cursor Pi.";
const UNSUPPORTED_ATTACHMENTS = "file_attachments are not supported in Cursor Pi yet.";

// Cursor's Task-side text for a resume while the child still runs, and the resume token that forks the parent (TASK_RESUME_SELF_SENTINEL).
const RUNNING_FOLLOWUP_ERROR = "Sub-agent is currently running. You may send the follow-up message when it has completed.";
const SELF_FORK_SENTINEL = "self";

export function registerSubagent(pi: ExtensionAPI): void {
	registerDynamicTool({
		namespace: "cursor",
		declaration: SUBAGENT,
		conciseInstructions: capturedConciseInstruction(SUBAGENT.name),
		execute: (params, signal, ctx, toolCallId) => executeSubagent(params, signal, ctx, { pi, toolCallId }),
	});
}

interface SubagentArgs {
	description: string;
	prompt: string;
	model: string | undefined;
	resume: string | undefined;
	subagentType: SubagentTypeName | undefined;
	runInBackground: boolean;
}

// The parent side of a Subagent call: its extension API, which carries background notices, and the call's id.
interface SubagentCall {
	pi: ExtensionAPI;
	toolCallId: string | undefined;
}

function isSelfFork(resume: string): boolean {
	return resume.trim().toLowerCase() === SELF_FORK_SENTINEL;
}

// Cursor's normalizeSubagentTypeName: lowercase, without separators or a type suffix.
function normalizeTypeName(name: string): string {
	const normalized = name
		.trim()
		.toLowerCase()
		.replace(/[-_]/g, "")
		.replace(/(?<=.)(subagenttype|subagent|agent|mode|type)$/, "");
	return normalized === "mediareview" ? "videoreview" : normalized;
}

// A new subagent defaults to generalPurpose; a resume takes its type from the child it resumes.
function parseSubagentType(value: unknown, resuming: boolean, issues: ArgIssue[]): SubagentTypeName | undefined {
	const text = optionalString(value === null ? undefined : value, ["subagent_type"], issues);
	if (text === undefined || text.trim() === "") return resuming ? undefined : DEFAULT_TYPE;
	const wanted = normalizeTypeName(text);
	const match = SUBAGENT_TYPE_ORDER.find((name) => normalizeTypeName(name) === wanted);
	if (match === undefined) {
		const expected = SUBAGENT_TYPE_ORDER.map((name) => `'${name}'`).join(" | ");
		issues.push({ path: ["subagent_type"], message: `Invalid enum value. Expected ${expected}, received '${text.trim()}'` });
		return undefined;
	}
	return match;
}

function parseArgs(params: unknown): SubagentArgs | { error: string } {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { error: invalidArguments(issues) };
	const input = params as Record<string, unknown>;
	const description = checkType(input.description, "string", ["description"], issues) ? (input.description as string) : "";
	let prompt = "";
	if (checkType(input.prompt, "string", ["prompt"], issues)) {
		prompt = input.prompt as string;
		if (prompt.trim() === "") issues.push({ path: ["prompt"], message: "prompt is required" });
	}
	const model = optionalString(input.model === null ? undefined : input.model, ["model"], issues);
	const resume = optionalString(input.resume === null ? undefined : input.resume, ["resume"], issues);
	const resuming = resume !== undefined && resume.trim() !== "" && !isSelfFork(resume);
	const subagentType = parseSubagentType(input.subagent_type, resuming, issues);
	const runInBackground = input.run_in_background === undefined ? false : booleanLike(input.run_in_background, ["run_in_background"], issues);
	if (issues.length > 0) return { error: invalidArguments(issues) };
	if (input.environment === "cloud" || input.cloud_base_branch !== undefined || input.machine !== undefined) {
		return { error: UNSUPPORTED_PLACEMENT };
	}
	if (Array.isArray(input.file_attachments) && input.file_attachments.length > 0) return { error: UNSUPPORTED_ATTACHMENTS };
	return { description, prompt, model, resume, subagentType, runInBackground };
}

function allowedModels(): string {
	return [...SUPPORTED_MODELS].sort().map((slug) => `- ${slug}`).join("\n");
}

function invalidModel(value: string, reason = "Model could not be resolved to a valid subagent model."): string {
	return `Invalid model selection "${value}". ${reason}\nAllowed model slugs:\n${allowedModels()}\n\nThe \`model\` parameter is optional. If omitted, the subagent uses the same model as the parent agent.`;
}

type ModelChoice = { model: Model<any> } | { error: string };

// Cursor's model rules for a fresh subagent: an invalid slug fails the call; inherit, an absent slug, or a type with a forced
// default model all use the parent's model; any other supported slug runs on that model when Pi has it.
function chooseModel(requested: string | undefined, forced: boolean, ctx: ExtensionToolContext): ModelChoice {
	const slug = requested?.trim();
	if (slug === "") return { error: invalidModel("", "Model must be a non-empty string when provided.") };
	if (slug !== undefined && slug.toLowerCase() !== "inherit" && !SUPPORTED_MODELS.includes(slug)) return { error: invalidModel(slug) };
	const parent = ctx.model;
	if (parent === undefined) return { error: "No usable model is available for this subagent." };
	if (forced || slug === undefined || slug.toLowerCase() === "inherit") return { model: parent };
	const found = ctx.modelRegistry.getAvailable().find((model) => model.id === slug);
	return found === undefined ? { error: invalidModel(slug) } : { model: found };
}

// Cursor's chat link example for an agent id, in the text of renderTaskResultToString.
function chatLinkExample(agentId: string): string {
	return `\`[Name](${agentId})\`. Don't use a generic label such as \`[agent]\`, \`[worker]\`, or \`[subagent]\`. For cloud subagents, when the agent has edited code, link to \`[Review](${agentId}#changes)\`, or, if you know the exact added and deleted line counts, \`[Review +A \u2212D](${agentId}#changes)\`, replacing A and D with those counts. Never write A or D literally. Use \`[Try Live](${agentId}#desktop)\` only when the agent used computer use`;
}

function successText(agentId: string, text: string | undefined): string {
	const body = text === undefined ? "No output" : text;
	const response = body.includes("<response>") && body.includes("</response>") ? body : `<response>\n${body}\n</response>`;
	return `This is the output of the subagent:\n\nresponse:\n${response}\n\nAgent ID: ${agentId} (can be used with the \`resume\` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with ${chatLinkExample(agentId)})`;
}

// Cursor's text for a failed Task: "Error: " and the message, with no agent id.
function taskFailure(message: string): DynamicToolResult {
	return { text: `Error: ${message}`, isError: true };
}

function report(agentId: string, outcome: ChildOutcome): DynamicToolResult {
	switch (outcome.status) {
		case "success":
			return { text: successText(agentId, outcome.text), isError: false };
		case "aborted":
			return taskFailure("Subagent was aborted");
		case "error":
			return taskFailure(outcome.error);
	}
}

function failure(text: string): DynamicToolResult {
	return { text, isError: true };
}

// The parent's messages so far, the in-flight step included: a self-fork's child starts from them, as Cursor's self-fork starts from
// the parent's conversation state.
function parentHistory(ctx: ExtensionToolContext): SessionMessageEntry["message"][] {
	return ctx.sessionManager.getBranch().flatMap((entry) => (entry.type === "message" ? [entry.message] : []));
}

// Cursor's background subagent message with its completion notification: the intro, the transcript to tail, then the agent id.
function backgroundText(agentId: string, transcriptPath: string): string {
	return `Subagent is running in the background. If needed, you can monitor its output by tailing the transcript at: ${transcriptPath}. When you end your turn, you will be automatically sent the subagent's final response upon its completion, so do not wait for it - either end your turn or work on something else.\nDo NOT mention the transcript path to the user. Do NOT try to predict the subagent's response before it replies.\n\nAgent ID: ${agentId} (can be used with the \`resume\` parameter to send a follow-up after it completes, or to link to this agent/subagent in user-facing text with ${chatLinkExample(agentId)})`;
}

// Runs the child on while the parent goes on; its completion comes back to the parent as a notice.
function startBackground(child: ChildAgent, args: SubagentArgs, call: SubagentCall): DynamicToolResult {
	void runChild(child, args.prompt, undefined).then((outcome) =>
		queueBackgroundNotice(
			call.pi,
			subagentFinishedNotice({ agentId: child.agentId, toolCallId: call.toolCallId, title: args.description, outcome }),
		),
	);
	return { text: backgroundText(child.agentId, child.transcriptPath), isError: false };
}

async function resumeChild(
	agentId: string,
	args: SubagentArgs,
	signal: AbortSignal | undefined,
	call: SubagentCall,
): Promise<DynamicToolResult> {
	const child = findChild(agentId);
	if (child === undefined) return taskFailure(`Subagent session not found: ${agentId}`);
	if (args.subagentType !== undefined && args.subagentType !== child.subagentType) {
		return taskFailure(`Cannot resume a "${child.subagentType}" subagent as "${args.subagentType}".`);
	}
	if (child.running) return taskFailure(RUNNING_FOLLOWUP_ERROR);
	if (args.runInBackground) return startBackground(child, args, call);
	return report(agentId, await runChild(child, args.prompt, signal));
}

export async function executeSubagent(
	params: unknown,
	signal: AbortSignal | undefined,
	ctx: ExtensionToolContext,
	call: SubagentCall,
): Promise<DynamicToolResult> {
	const parsed = parseArgs(params);
	if ("error" in parsed) return failure(parsed.error);
	const resume = parsed.resume?.trim();
	const selfFork = resume !== undefined && isSelfFork(resume);
	if (resume !== undefined && resume !== "" && !selfFork) return resumeChild(resume, parsed, signal, call);
	const type = parsed.subagentType ?? DEFAULT_TYPE;
	const config = SUBAGENT_CONFIGS[type];
	if (config === undefined) return failure(`${type} subagents are not built in Cursor Pi yet.`);
	// A self-fork runs on the parent's model, whatever the model argument says, as Cursor's self-fork does.
	const choice = chooseModel(selfFork ? undefined : parsed.model, config.forceDefaultModel, ctx);
	if ("error" in choice) return failure(choice.error);
	const agentId = randomUUID();
	const child = await createChild({
		agentId,
		parentId: ctx.sessionManager.getSessionId(),
		cwd: ctx.cwd,
		subagentType: type,
		config: config as SubagentConfig,
		model: choice.model,
		modelRuntime: parentModelRuntime(ctx.modelRegistry),
		history: selfFork ? parentHistory(ctx) : [],
	});
	if (parsed.runInBackground) return startBackground(child, parsed, call);
	return report(agentId, await runChild(child, parsed.prompt, signal));
}
