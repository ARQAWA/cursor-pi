// A Subagent child: a Pi session of its own, in this process, that runs one subagent type. Its context is Cursor's child
// user_info and reminders, its tools are the type's tool set, and its transcript goes to <parent>/subagents/<child>.jsonl.
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, platform, release } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	type AgentSession,
	type ExtensionAPI,
	type ExtensionFactory,
	type ExtensionToolContext,
	type ModelRuntime,
	type SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { ensureAgentStores } from "../agent-stores.ts";
import { promptForModel } from "../prompts.ts";
import { discoverCursorRules } from "../rules.ts";
import { discoverAgentSkills } from "../skills.ts";
import { register as registerGlob } from "../tools/glob.ts";
import { register as registerRead } from "../tools/read-file.ts";
import { register as registerRg } from "../tools/rg.ts";
import { register as registerApplyPatch } from "../tools/apply-patch.ts";
import { register as registerCallDynamicTool } from "../tools/call-dynamic-tool.ts";
import { register as registerGetDynamicTools } from "../tools/get-dynamic-tools.ts";
import { register as registerShell } from "../tools/shell.ts";
import { register as registerStrReplace } from "../tools/str-replace.ts";
import { register as registerWrite } from "../tools/write.ts";
import { registerDirect as registerWebFetchDirect } from "../tools/namespace/web-fetch.ts";
import { registerDirect as registerWebSearchDirect } from "../tools/namespace/web-search.ts";
import { projectDirFor, terminalsDirFor, transcriptsDirFor } from "../tools/shell/paths.ts";
import { registerCapturedToolPayload } from "../tools/index.ts";
import { register as registerUpdateCurrentStep } from "../tools/update-current-step.ts";
import { transcriptLine } from "../transcripts.ts";
import { friendlyDate, renderUserInfo } from "../user-info.ts";
import { resolveTimeZone, wrapUserTurn } from "../user-turn.ts";
import { askModeReminder, DEFAULT_SUBAGENT_REMINDER, EDIT_TOOL_SET, type SubagentConfig, type SubagentTypeName } from "./config.ts";

const REGISTER: Record<string, (pi: ExtensionAPI) => void> = {
	Glob: registerGlob,
	rg: registerRg,
	ReadFile: registerRead,
	UpdateCurrentStep: registerUpdateCurrentStep,
	Shell: registerShell,
	ApplyPatch: registerApplyPatch,
	StrReplace: registerStrReplace,
	Write: registerWrite,
	GetDynamicTools: registerGetDynamicTools,
	CallDynamicTool: registerCallDynamicTool,
	WebSearch: registerWebSearchDirect,
	WebFetch: registerWebFetchDirect,
};

export interface ChildAgent {
	agentId: string;
	parentId: string;
	subagentType: SubagentTypeName;
	config: SubagentConfig;
	modelId: string;
	session: AgentSession;
	transcriptPath: string;
	running: boolean;
	// True until the first run, which carries the reminder that shares the query's message.
	fresh: boolean;
	contextTexts: string[];
}

export type ChildOutcome =
	| { status: "success"; text: string | undefined }
	| { status: "error"; error: string }
	| { status: "aborted" };

const agents = new Map<string, ChildAgent>();

export function findChild(agentId: string): ChildAgent | undefined {
	return agents.get(agentId);
}

function reminderBlock(parts: string[]): string {
	return `<system_reminder>\n${[DEFAULT_SUBAGENT_REMINDER, ...parts].join("\n\n")}\n</system_reminder>`;
}

function textMessage(text: string) {
	return { role: "user" as const, content: [{ type: "text" as const, text }], timestamp: Date.now() };
}

// The tool names a child gets. EditTools is the edit tool the model gets: StrReplace and Write for Anthropic models, ApplyPatch for
// the rest, as the parent's edit-tool sync chooses them.
function toolNamesFor(config: SubagentConfig, model: Model<any>): string[] {
	const edit = model.provider === "anthropic" ? ["StrReplace", "Write"] : ["ApplyPatch"];
	return config.tools.flatMap((name) => (name === EDIT_TOOL_SET ? edit : [name]));
}

// Cursor's child user_info: the workspace's rules and skills, with no git status and no catalogs.
async function childUserInfo(cwd: string, sessionId: string, now: Date): Promise<string> {
	const workspacePath = resolve(cwd);
	const projectDir = projectDirFor(workspacePath);
	const [rules, skills, stores] = await Promise.all([
		discoverCursorRules(workspacePath),
		discoverAgentSkills(workspacePath, homedir()),
		ensureAgentStores(sessionId),
	]);
	return renderUserInfo({
		osVersion: `${platform()} ${release()}`,
		// Same rule as context-message.ts: zsh when the login shell is zsh, otherwise bash.
		shell: (process.env.SHELL ?? "").includes("zsh") ? "zsh" : "bash",
		workspacePath,
		isWorkingDirHomeDir: workspacePath === resolve(homedir()),
		gitRepos: [],
		todaysDate: friendlyDate(now, resolveTimeZone()),
		terminalsFolder: terminalsDirFor(projectDir),
		agentTranscriptsFolder: transcriptsDirFor(projectDir),
		stores: [
			{ kind: "self", path: stores.self },
			{ kind: "user", path: stores.user },
		],
		rules,
		skills,
	});
}

// Pi 1.3.0 keeps the session's ModelRuntime in ModelRegistry's private `runtime` field and offers no accessor. The child uses
// that runtime, so it sees the same credentials as the parent, including a --api-key given on the command line.
export function parentModelRuntime(registry: ExtensionToolContext["modelRegistry"]): ModelRuntime {
	return (registry as unknown as { runtime: ModelRuntime }).runtime;
}

export async function createChild(args: {
	agentId: string;
	parentId: string;
	cwd: string;
	subagentType: SubagentTypeName;
	config: SubagentConfig;
	model: Model<any>;
	modelRuntime: ModelRuntime;
	// The messages the child starts from: a self-fork's copy of the parent's, or none.
	history: SessionMessageEntry["message"][];
}): Promise<ChildAgent> {
	const { agentId, parentId, cwd, config, model } = args;
	const contextTexts = [await childUserInfo(cwd, parentId, new Date())];
	if (config.readonly) contextTexts.push(askModeReminder());
	if (!config.reminderWithQuery) contextTexts.push(reminderBlock(config.reminderParts()));
	const systemPrompt = config.rolePrompt?.() ?? promptForModel(model.id)?.text;
	const extension: ExtensionFactory = (pi) => {
		pi.on("before_agent_start", () => (systemPrompt === undefined ? undefined : { systemPrompt }));
		pi.on("context", (event) => ({ messages: [...contextTexts.map(textMessage), ...event.messages] }));
		// The same request rewrite as the parent: captured tool shapes, and no Pi placeholder or inline-tools beta on the wire.
		registerCapturedToolPayload(pi);
		for (const name of toolNamesFor(config, model)) REGISTER[name]?.(pi);
	};
	// noExtensions keeps cursor-pi from loading itself a second time; the child gets only the extension above.
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		noExtensions: true,
		noSkills: true,
		noContextFiles: true,
		extensionFactories: [extension],
	});
	await loader.reload();
	const sessionManager = SessionManager.inMemory(cwd);
	for (const message of args.history) sessionManager.appendMessage(message as Parameters<SessionManager["appendMessage"]>[0]);
	const { session } = await createAgentSession({
		cwd,
		model,
		modelRuntime: args.modelRuntime,
		resourceLoader: loader,
		sessionManager,
		tools: toolNamesFor(config, model),
	});
	const agent: ChildAgent = {
		agentId,
		parentId,
		subagentType: args.subagentType,
		config,
		modelId: model.id,
		session,
		transcriptPath: join(transcriptsDirFor(projectDirFor(resolve(cwd))), parentId, "subagents", `${agentId}.jsonl`),
		running: false,
		fresh: true,
		contextTexts,
	};
	agents.set(agentId, agent);
	return agent;
}

function assistantText(message: { content: unknown }): string | undefined {
	const parts = (message.content as { type: string; text?: string }[]).flatMap((part) =>
		part.type === "text" && part.text !== undefined ? [part.text] : [],
	);
	return parts.length > 0 ? parts.join("") : undefined;
}

async function writeTranscript(agent: ChildAgent, outcome: ChildOutcome): Promise<void> {
	const lines = agent.session.messages.flatMap((message) => {
		const line = transcriptLine(message);
		return line ? [line] : [];
	});
	// Cursor records a user stop as an error with this text (transcripts.ts).
	const ended =
		outcome.status === "success"
			? { status: "success" }
			: { status: "error", error: outcome.status === "aborted" ? "user_stopped_generation" : outcome.error };
	lines.push(JSON.stringify({ type: "turn_ended", ...ended }));
	await mkdir(dirname(agent.transcriptPath), { recursive: true });
	await writeFile(agent.transcriptPath, `${lines.join("\n")}\n`);
}

// Sends the prompt to the child and waits for the run to end. The first run carries the reminder of the explore-style types
// in the same message as the query, as Cursor's child does.
export async function runChild(agent: ChildAgent, prompt: string, signal: AbortSignal | undefined): Promise<ChildOutcome> {
	const reminder = agent.fresh && agent.config.reminderWithQuery ? `${reminderBlock(agent.config.reminderParts())}\n` : "";
	const text = `${reminder}${wrapUserTurn(prompt, new Date(), resolveTimeZone())}`;
	agent.fresh = false;
	agent.running = true;
	const abort = () => void agent.session.abort();
	if (signal?.aborted) abort();
	else signal?.addEventListener("abort", abort, { once: true });
	let failure: string | undefined;
	try {
		await agent.session.prompt(text);
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error);
	} finally {
		signal?.removeEventListener("abort", abort);
		agent.running = false;
	}
	const last = agent.session.messages.findLast((message) => message.role === "assistant");
	let outcome: ChildOutcome;
	if (signal?.aborted) outcome = { status: "aborted" };
	else if (failure !== undefined) outcome = { status: "error", error: failure };
	else if (last?.role === "assistant" && last.stopReason === "error") outcome = { status: "error", error: last.errorMessage ?? "Error" };
	else outcome = { status: "success", text: last?.role === "assistant" ? assistantText(last) : undefined };
	await writeTranscript(agent, outcome);
	return outcome;
}
