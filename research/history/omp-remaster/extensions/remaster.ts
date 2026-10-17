/**
 * Remaster: a stock-OMP extension that sends each model its prepared prompt and a Cursor-style
 * user context.
 *
 * At load the extension sets PI_CODEX_WEBSOCKET to "0" and registers five Cursor tools: Shell,
 * CursorGlob (sent as Glob), rg, ReadFile and ApplyPatch. Their implementations are in lib/tools, and
 * their descriptions come from reference/cursor/prompts/tools. At session start only these tools are
 * active. For each request the prepared profile comes from reference/prepared-prompts, chosen by
 * the model id with any "@..." suffix removed; the --remaster-rc flag picks rc1 or rc2 of GPT-6.1
 * Sol. A model with no profile gets no prompt and a warning.
 *
 * Anthropic Messages models get the profile as the system prompt. Their provider payload loses the
 * date and working-directory reminder from user, developer and system messages, and the Claude Code
 * billing fingerprint is recomputed when that removal changes the messages. Other APIs get the
 * profile as the first developer message.
 *
 * Each conversation starts with a `<user_info>` user message, plus a `<git_status>` block inside a
 * git repository. Its text is stored once as a `remaster-context` session entry. Every user message is
 * wrapped in `<timestamp>` and `<user_query>` tags and loses its steering flag. Before a provider
 * request leaves, OpenAI Responses and Codex requests get the Cursor wire format (see toCursorWire);
 * other APIs, Anthropic Messages included, keep OMP's tool definitions.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir, platform, release } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { applyPatchTool } from "../lib/tools/apply-patch.ts";
import { globTool } from "../lib/tools/glob.ts";
import { readFileTool } from "../lib/tools/read-file.ts";
import { rgTool } from "../lib/tools/rg.ts";
import { createShell } from "../lib/tools/shell.ts";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasToolDefinitions(value: unknown): boolean {
	return Array.isArray(value) && value.length > 0;
}

interface ReferenceTool {
	name: string;
	description: string;
	parameters?: unknown;
	format?: { definition: string };
}

const REFERENCE_NAMES = ["Shell", "Glob", "rg", "ReadFile", "ApplyPatch"];
const REFERENCE_TOOLS = (
	JSON.parse(readFileSync(new URL("../reference/cursor/prompts/tools/toolset-bb31022a144f.json", import.meta.url), "utf8")) as ReferenceTool[]
).filter(tool => REFERENCE_NAMES.includes(tool.name));

/** Returns the Cursor reference entry for a tool name; a missing entry is an error. */
function referenceTool(name: string): ReferenceTool {
	const tool = REFERENCE_TOOLS.find(item => item.name === name);
	if (tool === undefined) throw new Error(`${name} is missing from the Cursor toolset`);
	return tool;
}

type ShellParams = Parameters<ReturnType<typeof createShell>["run"]>[0];
type GlobParams = Parameters<typeof globTool>[0];
type RgParams = Parameters<typeof rgTool>[0];
type ReadFileParams = Parameters<typeof readFileTool>[0];

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

/** Returns the result of a tool action, or "Error: <message>" when the action throws. */
async function toolResult(action: () => Promise<string>) {
	try {
		return textResult(await action());
	} catch (error) {
		return textResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

/** Returns a tool definition with the reference description and parameters. The cast matches probeTool. */
function toolDefinition(
	name: string,
	entry: ReferenceTool,
	approval: string,
	execute: ToolDefinition["execute"],
	extra: Record<string, unknown> = {},
): ToolDefinition {
	return {
		name,
		label: name,
		description: entry.description,
		parameters: entry.parameters,
		strict: false,
		loadMode: "essential",
		intent: "omit",
		approval,
		...extra,
		execute,
	} as unknown as ToolDefinition;
}

/** Returns the folder where the Shell tool keeps the terminal files of a working directory. */
function terminalsFolder(cwd: string): string {
	return join(homedir(), ".omp", "remaster", "projects", cwd.replaceAll("/", "-").replace(/^-+/, ""), "terminals");
}

/**
 * Returns a copy of the payload in the Cursor wire format, or undefined when nothing changed.
 * The top-level `tools` array becomes the reference entries of the tools it names, in reference order,
 * and the other tools are dropped. An empty result removes `tools`, `tool_choice` and `parallel_tool_calls`;
 * otherwise `parallel_tool_calls` is set to true. The Codex `additional_tools` item loses its tools, and a
 * string output of a function or custom tool call becomes an `input_text` part.
 */
function toCursorWire(payload: unknown): JsonObject | undefined {
	if (!isJsonObject(payload)) return undefined;

	const next: JsonObject = { ...payload };
	let changed = false;

	if (Array.isArray(payload.tools)) {
		const names = new Set<unknown>();
		for (const tool of payload.tools) {
			const name = isJsonObject(tool) ? tool.name : undefined;
			names.add(name === "CursorGlob" ? "Glob" : name);
		}
		const tools = REFERENCE_TOOLS.filter(entry => names.has(entry.name)).map(entry => structuredClone(entry));
		changed = true;
		if (tools.length === 0) {
			delete next.tools;
			delete next.tool_choice;
			delete next.parallel_tool_calls;
		} else {
			next.tools = tools;
			next.parallel_tool_calls = true;
		}
	}

	if (Array.isArray(payload.input)) {
		next.input = payload.input.map(item => {
			if (isJsonObject(item) && item.type === "additional_tools" && hasToolDefinitions(item.tools)) {
				changed = true;
				return { ...item, tools: [] };
			}
			if (
				isJsonObject(item) &&
				(item.type === "function_call_output" || item.type === "custom_tool_call_output") &&
				typeof item.output === "string"
			) {
				changed = true;
				return { ...item, output: [{ text: item.output, type: "input_text" }] };
			}
			return item;
		});
	}

	return changed ? next : undefined;
}

const PROMPTS_DIR = fileURLToPath(new URL("../reference/prepared-prompts/", import.meta.url));
const CONTEXT_ENTRY = "remaster-context";
const RESPONSES_APIS = new Set(["openai-responses", "openai-codex-responses", "azure-openai-responses"]);
const GPT_PROFILE_IDS = new Set(["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
const CLAUDE_ID = /^claude-(opus|sonnet|haiku)-5[-.]5$/;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const profileTexts = new Map<string, string>();

/** Returns the prepared prompt file for a model id without its "@" suffix, or undefined when the model has none. */
function profileFileName(id: string, rc: string): string | undefined {
	if (id === "gpt-6.1-sol") {
		if (rc === "rc1") return "gpt-6.1-sol-rc.md";
		if (rc === "rc2") return "gpt-6.1-sol-rc2.md";
		return "gpt-6.1-sol.md";
	}
	if (GPT_PROFILE_IDS.has(id)) return `${id}.md`;
	const claude = CLAUDE_ID.exec(id);
	return claude === null ? undefined : `claude-${claude[1]}-5-5.md`;
}

/** Returns the text of a prepared prompt file, read once per file name. */
function readProfile(file: string): string {
	let text = profileTexts.get(file);
	if (text === undefined) {
		text = readFileSync(join(PROMPTS_DIR, file), "utf8");
		profileTexts.set(file, text);
	}
	return text;
}

/** Returns the stdout of a git command, or undefined when it fails. */
function git(args: string[], cwd: string): string | undefined {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return undefined;
	}
}

/** Returns the UTC offset of a date as "UTC+3", "UTC-9:30" or "UTC+0". */
function utcLabel(date: Date): string {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const minutes = Math.abs(offset);
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(rest).padStart(2, "0")}`;
}

/** Returns a message timestamp as "Friday, Oct 16, 2026, 10:04 AM (UTC+3)" in local time. */
function timestampLabel(ms: number): string {
	const date = new Date(ms);
	const hour = date.getHours();
	const minute = String(date.getMinutes()).padStart(2, "0");
	const meridiem = hour < 12 ? "AM" : "PM";
	return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}, ${hour % 12 || 12}:${minute} ${meridiem} (${utcLabel(date)})`;
}

/** Returns a date as "Friday Oct 16, 2026" in local time. */
function dateLabel(date: Date): string {
	return `${DAY_NAMES[date.getDay()]} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** Returns the `<user_info>` text, with a `<git_status>` block inside a git repository. */
function buildContextText(cwd: string): string {
	const root = git(["rev-parse", "--show-toplevel"], cwd)?.trim();
	const lines = [`OS Version: ${platform()} ${release()}`];
	const shell = process.env.SHELL;
	if (shell) lines.push(`Shell: ${basename(shell)}`);
	lines.push(`Workspace Path: ${cwd}`);
	if (root !== undefined) lines.push(`Is directory a git repo: Yes, at ${root}`);
	lines.push(`Today's date: ${dateLabel(new Date())}`);
	lines.push(`Terminals folder: ${terminalsFolder(cwd)}`);
	const text = `<user_info>\n${lines.join("\n\n")}\n</user_info>`;

	if (root === undefined) return text;
	const status = (git(["status", "--porcelain"], cwd) ?? "").trim();
	if (status === "") return text;
	return `${text}\n\n<git_status>\nThis is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.\n\n\nGit repo: ${root}\n\n\`\`\`\n${status}\n\`\`\`\n</git_status>`;
}

/** Returns the `remaster-context` text stored in this session, or undefined when none is stored. */
function storedContextText(ctx: ExtensionContext): string | undefined {
	for (const entry of ctx.sessionManager.getEntries()) {
		const item: unknown = entry;
		if (!isJsonObject(item) || item.type !== "custom" || item.customType !== CONTEXT_ENTRY) continue;
		if (isJsonObject(item.data) && typeof item.data.text === "string") return item.data.text;
	}
	return undefined;
}

function textOf(part: unknown): string | undefined {
	return isJsonObject(part) && part.type === "text" && typeof part.text === "string" ? part.text : undefined;
}

/** Returns a user message with its text wrapped in timestamp and user_query tags; other messages are returned unchanged. */
function wrapUserMessage<T>(input: T): T {
	const message = input as unknown as JsonObject;
	if (!isJsonObject(message) || message.role !== "user") return input;

	const { content } = message;
	let text = "";
	let images: unknown[] = [];
	if (typeof content === "string") {
		text = content;
	} else if (Array.isArray(content)) {
		text = content
			.map(textOf)
			.filter((part): part is string => part !== undefined)
			.join("\n\n");
		images = content.filter(part => isJsonObject(part) && part.type === "image");
	}

	const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();
	const copy: JsonObject = { ...message };
	delete copy.steering;
	const wrapped = `<timestamp>${timestampLabel(timestamp)}</timestamp>\n<user_query>\n${text}\n</user_query>`;
	return { ...copy, content: [{ type: "text", text: wrapped }, ...images] } as unknown as T;
}

const REMINDER_ONLY = /^<system-reminder>\nToday: [^\n]*; current working directory: '[^\n]*'\. Do not repeat this information in your reply\.\n<\/system-reminder>$/;
const REMINDER_PREFIX = /^<system-reminder>\nToday: [^\n]*; current working directory: '[^\n]*'\. Do not repeat this information in your reply\.\n<\/system-reminder>\n\n/;

function isReminderMessage(item: unknown): item is JsonObject {
	return isJsonObject(item) && (item.role === "user" || item.role === "developer" || item.role === "system");
}

/** Returns null when the text is only the reminder, otherwise the text without a leading reminder. */
function stripReminder(text: string): string | null {
	if (REMINDER_ONLY.test(text)) return null;
	return text.replace(REMINDER_PREFIX, "");
}

/**
 * Returns the message without reminder text, null when the message must be dropped,
 * or the message itself when nothing changed.
 */
function withoutReminderText(message: JsonObject): JsonObject | null {
	const { content } = message;

	if (typeof content === "string") {
		const stripped = stripReminder(content);
		if (stripped === null) return null;
		return stripped === content ? message : { ...message, content: stripped };
	}

	if (!Array.isArray(content)) return message;

	let changed = false;
	const parts: unknown[] = [];
	for (const part of content) {
		const text = isJsonObject(part) ? part.text : undefined;
		if (!isJsonObject(part) || typeof text !== "string") {
			parts.push(part);
			continue;
		}
		const stripped = stripReminder(text);
		if (stripped === null) {
			changed = true;
		} else if (stripped === text) {
			parts.push(part);
		} else {
			changed = true;
			parts.push({ ...part, text: stripped });
		}
	}

	if (!changed) return message;
	if (parts.length === 0) return null;
	return { ...message, content: parts };
}

/**
 * Returns a copy of the payload without reminder text in user, developer and system messages
 * of `input` and `messages`, or undefined when there is none. Other items are never changed.
 */
function withoutReminders(payload: unknown): JsonObject | undefined {
	if (!isJsonObject(payload)) return undefined;

	const next: JsonObject = { ...payload };
	let changed = false;

	for (const field of ["input", "messages"]) {
		const items = payload[field];
		if (!Array.isArray(items)) continue;

		const kept: unknown[] = [];
		for (const item of items) {
			if (!isReminderMessage(item)) {
				kept.push(item);
				continue;
			}
			const message = withoutReminderText(item);
			if (message === null) {
				changed = true;
				continue;
			}
			if (message !== item) changed = true;
			kept.push(message);
		}
		next[field] = kept;
	}

	return changed ? next : undefined;
}

const BILLING_HEADER_PREFIX = "x-anthropic-billing-header:";
const BILLING_FINGERPRINT = /cc_version=(.+)\.([0-9a-f]{3});/;
const BILLING_FINGERPRINT_SALT = "59cf53e54c78";

/** Returns true when two message lists hold the same items in the same order. */
function sameMessages(before: unknown, after: unknown): boolean {
	if (!Array.isArray(before) || !Array.isArray(after)) return before === after;
	return before.length === after.length && before.every((item, index) => item === after[index]);
}

/** Returns the first user turn text as OMP defines it, or "" when there is none. */
function firstUserTurnText(messages: unknown): string {
	if (!Array.isArray(messages)) return "";
	for (const item of messages) {
		if (!isJsonObject(item) || item.role !== "user") continue;
		const { content } = item;
		if (typeof content === "string" && content.trim() !== "") return content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (isJsonObject(part) && part.type === "text" && typeof part.text === "string" && part.text.trim() !== "") {
				return part.text;
			}
		}
		if (content.some(part => isJsonObject(part) && part.type === "image")) return "";
	}
	return "";
}

/** Returns the 3-character fingerprint for a Claude Code version and the first user turn text. */
function billingFingerprint(firstUserTurn: string, version: string): string {
	const sampled = [4, 7, 20].map(index => firstUserTurn.charAt(index) || "0").join("");
	const digest = createHash("sha256").update(`${BILLING_FINGERPRINT_SALT}${sampled}${version}`, "utf8").digest("hex");
	return digest.slice(0, 3);
}

/**
 * Returns a copy of the payload whose billing header fingerprint matches the cleaned first user turn,
 * or undefined when the messages did not change or the header is absent or does not match the pattern.
 */
function withRefreshedBillingHeader(before: unknown, after: JsonObject): JsonObject | undefined {
	if (!isJsonObject(before) || sameMessages(before.messages, after.messages)) return undefined;

	const { system } = after;
	if (!Array.isArray(system)) return undefined;
	const [first, ...rest] = system;
	if (!isJsonObject(first) || typeof first.text !== "string") return undefined;
	const header = first.text;
	if (first.type !== "text" || !header.startsWith(BILLING_HEADER_PREFIX)) return undefined;

	const firstUserTurn = firstUserTurnText(after.messages);
	const text = header.replace(
		BILLING_FINGERPRINT,
		(_match, version: string) => `cc_version=${version}.${billingFingerprint(firstUserTurn, version)};`,
	);
	if (text === header) return undefined;
	return { ...after, system: [{ ...first, text }, ...rest] };
}

export default function remaster(pi: ExtensionAPI): void {
	process.env.PI_CODEX_WEBSOCKET = "0";

	pi.registerFlag("remaster-rc", {
		type: "string",
		description: "GPT-6.1 Sol release candidate: rc1 or rc2",
	});

	const notified = new Set<string>();

	const warnOnce = (ctx: ExtensionContext, key: string, message: string): void => {
		if (notified.has(key)) return;
		notified.add(key);
		ctx.ui.notify(message, "warning");
	};

	/** Returns the prepared profile for the current model, or undefined after a warning. */
	const profileFor = (ctx: ExtensionContext): string | undefined => {
		const model = ctx.model;
		const id = model ? model.id.replace(/@.*$/, "") : "";
		const flag = pi.getFlag("remaster-rc");
		const rc = typeof flag === "string" ? flag : "";
		if (id === "gpt-6.1-sol" && rc !== "" && rc !== "rc1" && rc !== "rc2") {
			warnOnce(ctx, `rc:${rc}`, "Unknown --remaster-rc value; the baseline prompt is used.");
		}
		const file = profileFileName(id, rc);
		if (file === undefined) {
			warnOnce(ctx, `none:${id}`, "No prepared prompt for this model; no prompt is sent.");
			return undefined;
		}
		return readProfile(file);
	};

	const contextText = (ctx: ExtensionContext): string => {
		const stored = storedContextText(ctx);
		if (stored !== undefined) return stored;
		const text = buildContextText(ctx.cwd);
		pi.appendEntry(CONTEXT_ENTRY, { text });
		return text;
	};

	const shellEntry = referenceTool("Shell");
	const globEntry = referenceTool("Glob");
	const rgEntry = referenceTool("rg");
	const readFileEntry = referenceTool("ReadFile");
	const applyPatchEntry = referenceTool("ApplyPatch");

	let shell: ReturnType<typeof createShell> | undefined;
	const shellFor = (ctx: ExtensionContext): ReturnType<typeof createShell> => {
		if (shell === undefined) shell = createShell({ terminalsDir: terminalsFolder(ctx.cwd), startCwd: ctx.cwd });
		return shell;
	};

	pi.registerTool(
		toolDefinition("Shell", shellEntry, "exec", async (_toolCallId, params, signal, _onUpdate, ctx) =>
			toolResult(() => shellFor(ctx).run(params as ShellParams, signal)),
		),
	);
	pi.registerTool(
		toolDefinition(
			"CursorGlob",
			globEntry,
			"read",
			async (_toolCallId, params, signal, _onUpdate, ctx) => toolResult(() => globTool(params as GlobParams, ctx.cwd, signal)),
			{ customWireName: "Glob" },
		),
	);
	pi.registerTool(
		toolDefinition("rg", rgEntry, "read", async (_toolCallId, params, signal, _onUpdate, ctx) =>
			toolResult(() => rgTool(params as RgParams, ctx.cwd, signal)),
		),
	);
	pi.registerTool(
		toolDefinition("ReadFile", readFileEntry, "read", async (_toolCallId, params) =>
			toolResult(() => readFileTool(params as ReadFileParams)),
		),
	);
	pi.registerTool(
		toolDefinition(
			"ApplyPatch",
			{ ...applyPatchEntry, parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } },
			"write",
			async (_toolCallId, params) => toolResult(() => applyPatchTool((params as { input: string }).input)),
			{ customFormat: { syntax: "lark", definition: applyPatchEntry.format?.definition }, customWireName: "ApplyPatch" },
		),
	);

	pi.on("session_start", async () => {
		await pi.setActiveTools(["Shell", "CursorGlob", "rg", "ReadFile", "ApplyPatch"]);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		const profile = profileFor(ctx);
		return { systemPrompt: profile !== undefined && ctx.model?.api === "anthropic-messages" ? [profile] : [] };
	});

	pi.on("context", (event, ctx) => {
		const profile = profileFor(ctx);
		const developer =
			profile !== undefined && ctx.model?.api !== "anthropic-messages"
				? [{ role: "developer" as const, content: [{ type: "text" as const, text: profile }], timestamp: Date.now() }]
				: [];
		const contextMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: contextText(ctx) }],
			timestamp: Date.now(),
		};
		return { messages: [...developer, contextMessage, ...event.messages.map(wrapUserMessage)] };
	});

	pi.on("before_provider_request", (event, ctx) => {
		const api = ctx.model?.api;
		if (api !== undefined && RESPONSES_APIS.has(api)) return toCursorWire(event.payload);
		if (api !== "anthropic-messages") return undefined;
		const cleaned = withoutReminders(event.payload);
		if (!cleaned) return undefined;
		return withRefreshedBillingHeader(event.payload, cleaned) ?? cleaned;
	});
}
