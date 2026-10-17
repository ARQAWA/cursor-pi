// A Subagent child: a Pi session of its own, in this process, that runs one subagent type. Its context is Cursor's child
// user_info and reminders, its tools are the type's tool set, and its transcript goes to <parent>/subagents/<child>.jsonl.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, platform, release } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
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
import { dynamicToolCatalogSection } from "../dynamic/catalog.ts";
import { dynamicNamespaces } from "../dynamic/namespaces.ts";
import { listOwnedMcpNamespaces, type McpSource } from "../dynamic/mcp-source.ts";
import { gitRepoPath } from "../git-status.ts";
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
import { askModeReminder, BROWSER_TOOL_SET, DEFAULT_SUBAGENT_REMINDER, EDIT_TOOL_SET, type SubagentConfig, type SubagentTypeName } from "./config.ts";

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
function toolNamesFor(config: SubagentConfig, model: Model<any>, browserNames: string[]): string[] {
	const edit = model.provider === "anthropic" ? ["StrReplace", "Write"] : ["ApplyPatch"];
	return config.tools.flatMap((name) => {
		if (name === EDIT_TOOL_SET) return edit;
		if (name === BROWSER_TOOL_SET) return browserNames;
		return [name];
	});
}

// The cursor-ide-browser tools, from the browser McpSource (registered by get-dynamic-tools), which a browser-use child gets directly.
interface BrowserUseTool {
	name: string;
	description: string | undefined;
	inputSchema: unknown;
	namespace: string;
	source: McpSource;
}

async function browserUseTools(cwd: string): Promise<BrowserUseTool[]> {
	const owned = await listOwnedMcpNamespaces(cwd);
	return owned.flatMap(({ source, namespace }) =>
		source.id === "browser" ? namespace.tools.map((tool) => ({ ...tool, namespace: namespace.name, source })) : [],
	);
}

// Cursor's createWrappedBrowserTool: each call carries the child's own view id, a screenshot after the action, and headless mode.
function registerBrowserUseTool(pi: ExtensionAPI, tool: BrowserUseTool, viewId: string): void {
	pi.registerTool({
		name: tool.name,
		label: tool.name,
		description: tool.description ?? "",
		parameters: tool.inputSchema as Parameters<ExtensionAPI["registerTool"]>[0]["parameters"],
		execute: async (_toolCallId, params, signal) => {
			const args = { ...(params as Record<string, unknown>), viewId, take_screenshot_afterwards: true, headless: true };
			const result = await tool.source.callMcpTool(tool.namespace, tool.name, args, signal);
			if (result.isError) throw new Error(result.text);
			return { content: result.content, details: undefined };
		},
	});
}

// The tools a child's catalog leaves out. A child cannot start another subagent, and Cursor adds CreateGoal, UpdateGoal and
// SearchConversations only when the run has no subagentConfig (tool-config.js), so a child never has them.
const SUBAGENT_TOOL = "Subagent";
const CHILD_OMITTED_TOOLS = [SUBAGENT_TOOL, "CreateGoal", "UpdateGoal", "SearchConversations"];

// Cursor's child user_info: the workspace's rules, skills and git repo line, with no git status. A readonly child runs in ask
// mode, which hides the dynamic catalog. The skill preamble follows the child's model: GPT-5.6 gets the names-a-skill wording.
async function childUserInfo(cwd: string, sessionId: string, config: SubagentConfig, model: Model<any>, now: Date): Promise<string> {
	const workspacePath = resolve(cwd);
	const projectDir = projectDirFor(workspacePath);
	const [rules, skills, repoPath, stores, namespaces] = await Promise.all([
		discoverCursorRules(workspacePath),
		discoverAgentSkills(workspacePath, homedir()),
		gitRepoPath(workspacePath),
		ensureAgentStores(sessionId),
		dynamicNamespaces(workspacePath, undefined, { omitFirstPartyTools: CHILD_OMITTED_TOOLS }),
	]);
	return renderUserInfo({
		osVersion: `${platform()} ${release()}`,
		// Same rule as context-message.ts: zsh when the login shell is zsh, otherwise bash.
		shell: (process.env.SHELL ?? "").includes("zsh") ? "zsh" : "bash",
		workspacePath,
		isWorkingDirHomeDir: workspacePath === resolve(homedir()),
		gitRepos: repoPath === undefined ? [] : [{ path: repoPath }],
		todaysDate: friendlyDate(now, resolveTimeZone()),
		terminalsFolder: terminalsDirFor(projectDir),
		agentTranscriptsFolder: transcriptsDirFor(projectDir),
		stores: [
			{ kind: "self", path: stores.self },
			{ kind: "user", path: stores.user },
		],
		rules,
		skills,
		skillPreamble: model.id.startsWith("gpt-5.6") ? "gpt-5.6" : "default",
		dynamicCatalog: config.readonly ? undefined : dynamicToolCatalogSection(namespaces),
	});
}

// Pi 1.3.0 keeps the session's ModelRuntime in ModelRegistry's private `runtime` field and offers no accessor. The child uses
// that runtime, so it sees the same credentials as the parent, including a --api-key given on the command line.
export function parentModelRuntime(registry: ExtensionToolContext["modelRegistry"]): ModelRuntime {
	return (registry as unknown as { runtime: ModelRuntime }).runtime;
}

const execFileAsync = promisify(execFile);

// Cursor's best-of-n-runner worktree: a new branch at HEAD, checked out under <home>/.cursor-pi/worktrees/<workspace>/<id>. Cursor
// names the branch cursor/<date>-<id>-<hash>; the hash here is the start of the agent id.
async function createWorktree(repo: string, agentId: string): Promise<string> {
	const now = new Date();
	const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	const id = Math.random().toString(36).substring(2, 6);
	const path = join(homedir(), ".cursor-pi", "worktrees", basename(repo).replace(/[^a-zA-Z0-9._-]/g, "_"), id);
	await mkdir(dirname(path), { recursive: true });
	await execFileAsync("git", ["worktree", "add", "-b", `cursor/${date}-${id}-${agentId.slice(0, 5)}`, path, "HEAD"], { cwd: repo });
	return path;
}

// Cursor's _prependRequiredGlobalCommandPrompt: the worktree command comes before the query, in a <cursor_commands> block. Cursor
// reads the command from the user's global commands; here it is ~/.cursor-pi/commands/worktree.md, and the prompt is unchanged when
// that file is missing or empty.
function withWorktreeCommand(prompt: string): string {
	const file = join(homedir(), ".cursor-pi", "commands", "worktree.md");
	const content = existsSync(file) ? readFileSync(file, "utf8") : "";
	if (content === "") return prompt;
	return `<cursor_commands>\n--- Cursor Command: worktree ---\n${content}\n--- End Command ---\n</cursor_commands>\n\n${prompt}`;
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
	const { agentId, parentId, config, model } = args;
	// The child's workspace: its own worktree for best-of-n-runner, otherwise the parent's directory.
	const cwd = config.worktree ? await createWorktree(args.cwd, agentId) : args.cwd;
	const browserTools = config.tools.includes(BROWSER_TOOL_SET) ? await browserUseTools(cwd) : [];
	const toolNames = toolNamesFor(config, model, browserTools.map((tool) => tool.name));
	const contextTexts = [await childUserInfo(cwd, parentId, config, model, new Date())];
	if (config.readonly) contextTexts.push(askModeReminder());
	if (!config.reminderWithQuery) contextTexts.push(reminderBlock(config.reminderParts()));
	const systemPrompt = config.rolePrompt?.() ?? promptForModel(model.id)?.text;
	const extension: ExtensionFactory = (pi) => {
		pi.on("before_agent_start", () => (systemPrompt === undefined ? undefined : { systemPrompt }));
		pi.on("context", (event) => ({ messages: [...contextTexts.map(textMessage), ...event.messages] }));
		// The same request rewrite as the parent: captured tool shapes, and no Pi placeholder or inline-tools beta on the wire.
		registerCapturedToolPayload(pi);
		for (const name of toolNames) REGISTER[name]?.(pi);
		for (const tool of browserTools) registerBrowserUseTool(pi, tool, agentId);
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
		tools: toolNames,
	});
	const agent: ChildAgent = {
		agentId,
		parentId,
		subagentType: args.subagentType,
		config,
		modelId: model.id,
		session,
		transcriptPath: join(transcriptsDirFor(projectDirFor(resolve(args.cwd))), parentId, "subagents", `${agentId}.jsonl`),
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
	const query = agent.config.worktree ? withWorktreeCommand(prompt) : prompt;
	const text = `${reminder}${wrapUserTurn(query, new Date(), resolveTimeZone())}`;
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
