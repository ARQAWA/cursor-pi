import { toolWireSchema } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { hasMatch } from "@oh-my-pi/pi-natives";

/** The only namespace: operational tools that are not in the model's direct tool list. */
const NAMESPACE = "harness";
/** Direct base tools by internal registered name; edit reaches provider requests as apply_patch. get_tools and eval are the two harness entry points. */
const ENABLED_BASE = ["bash", "glob", "grep", "read", "edit", "get_tools", "eval"];
/** Operational tools enabled for the session and reached only through eval. write is the agent-message transport. */
const HIDDEN_BACKENDS = ["task", "wait", "todo", "goal", "write"];
/** Operational tools listed by get_tools. write is listed only through send_message. */
const CATALOG_BACKENDS = ["task", "wait", "todo", "goal"];
const CHILD_YIELD = "yield";
/** Public names a provider request may carry: the base tools except the internal edit name, the public apply_patch name of edit, and the child yield. */
const MODEL_FACING = new Set([...ENABLED_BASE.filter(name => name !== "edit"), "apply_patch", CHILD_YIELD]);
const SEND_MESSAGE = "send_message";
const DESCRIPTION_LIMIT = 200;
const TRUNCATION = "... [truncated]";
const PATTERN_LIMIT = 256;
/** Marks an eval result whose nested tool result was already counted by results.ts. */
const NESTED_BUDGET_KEY = "nestedBudgeted";
const AGENT_ID = /^[\w-]+$/;

const GET_TOOLS_DESCRIPTION = [
	"Discover and inspect the tools in the harness namespace. These operational tools run through eval: task, wait, todo, goal and send_message.",
	'1. {"namespace":"harness"}: returns full input schemas and full descriptions for every tool in that namespace.',
	'2. {"namespace":"harness","toolName":"<name>"}: returns the full schema and full description for one tool.',
	'3. {"pattern":"<regex>"}: searches namespace and tool names with a regular expression.',
	'4. {"namespace":"harness","pattern":"<regex>"}: searches tool names within that namespace.',
	"5. No arguments: returns the full catalog. Prefer a namespace or pattern when possible.",
	'Pattern-search and catalog results shorten long descriptions to 200 characters, ending with "... [truncated]". Namespace and single-tool lookups always return the complete description and input schema, so fetch a tool directly when you need the full text.',
	"Call this tool before calling a tool with eval. eval accepts only tools whose full schema was returned in this session.",
].join("\n");

const EVAL_DESCRIPTION = [
	'Run one tool from the harness namespace: {"namespace":"harness","toolName":"<name>","arguments":{...}}. eval accepts a tool only after get_tools returned its full schema in this session.',
	'send_message takes arguments {"agent":"<id>","content":"<text>"} and delivers content to agent://<id>. Use agent "all" to deliver to every agent.',
].join("\n");

const SEND_MESSAGE_DESCRIPTION = "Send content to another agent's inbox at agent://<id>. agent is an agent id, or all for every agent.";
const SEND_MESSAGE_PARAMETERS = {
	type: "object",
	properties: {
		agent: { type: "string", description: "Agent id, or all." },
		content: { type: "string" },
	},
	required: ["agent", "content"],
};

type Content = { type: string; text?: string }[];
type Outcome = { content: Content; details?: unknown; isError?: boolean };
type Capture = { target: string; result?: { content: Content; details: unknown; isError?: boolean } };
type CatalogEntry = { name: string; description: string; parameters: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (message: string): Outcome => ({ content: [{ type: "text", text: message }], isError: true });
const reply = (value: unknown): Outcome => ({
	content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
	details: value,
});

const shorten = (description: string): string =>
	description.length > DESCRIPTION_LIMIT ? `${description.slice(0, DESCRIPTION_LIMIT - TRUNCATION.length)}${TRUNCATION}` : description;

function toolNameOf(tool: unknown): string | undefined {
	if (!isRecord(tool)) return undefined;
	if (typeof tool.name === "string") return tool.name;
	if (isRecord(tool.function) && typeof tool.function.name === "string") return tool.function.name;
	return undefined;
}

/** Maps the internal registered names edit and _edit to the public names apply_patch and _apply_patch; the leading "_" is Claude's OAuth wire prefix. */
const toWireName = (name: string): string => (name === "edit" ? "apply_patch" : name === "_edit" ? "_apply_patch" : name);

/** Renames the internal edit name in a top-level name or OpenAI chat function.name, which covers tool schemas and tool_choice; other values and fields are kept, and the same object is returned when nothing changes. */
function publicName(value: unknown): unknown {
	if (!isRecord(value)) return value;
	let renamed = value;
	if (typeof value.name === "string" && toWireName(value.name) !== value.name) {
		renamed = { ...renamed, name: toWireName(value.name) };
	}
	if (isRecord(value.function) && typeof value.function.name === "string" && toWireName(value.function.name) !== value.function.name) {
		renamed = { ...renamed, function: { ...value.function, name: toWireName(value.function.name) } };
	}
	return renamed;
}

/** Accepts a public name, or exactly one leading "_" before a public name, because Claude's wire names carry that prefix. */
const isModelFacingWireName = (name: string): boolean =>
	MODEL_FACING.has(name) || (name.startsWith("_") && MODEL_FACING.has(name.slice(1)));

/** Renames the internal edit name in tool schemas and tool_choice to apply_patch, then keeps only model-facing tool schemas in a provider request; unnamed and unrecognized tool entries are dropped, and every other payload field passes through. */
function modelFacingPayload(payload: unknown): unknown {
	if (!isRecord(payload) || !Array.isArray(payload.tools)) return undefined;
	const original: unknown[] = payload.tools;
	const tools = original.map(publicName).filter(tool => {
		const name = toolNameOf(tool);
		return name !== undefined && isModelFacingWireName(name);
	});
	const toolChoice = publicName(payload.tool_choice);
	const unchanged = tools.length === original.length && tools.every((tool, index) => tool === original[index]);
	if (unchanged && toolChoice === payload.tool_choice) return undefined;
	return { ...payload, tools, ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }) };
}

export default function baseTools(pi: ExtensionAPI) {
	const z = pi.zod;
	// Stock xd:// mounting would advertise write as a dynamic device; this override is in memory only.
	lookup("tools.xdev")?.override(pi.pi.settings, false);

	const fetched = new Set<string>();
	let capture: Capture | undefined;

	/** Enables the base and operational tools that the registry holds and the session permits. */
	const applyActive = (permitted: ReadonlySet<string> | undefined, sub: boolean): Promise<void> => {
		const registered = new Set(pi.getAllTools().map(tool => tool.name));
		const candidates = sub
			? [...ENABLED_BASE, ...HIDDEN_BACKENDS, CHILD_YIELD]
			: [...ENABLED_BASE, ...HIDDEN_BACKENDS];
		const next = candidates.filter(name => registered.has(name) && (permitted === undefined || permitted.has(name)));
		return pi.setActiveTools([...new Set(next)]);
	};

	const catalog = (): CatalogEntry[] => {
		const tools = new Map(pi.getAllTools().map(tool => [tool.name, tool] as const));
		const active = new Set(pi.getActiveTools());
		const entries: CatalogEntry[] = [];
		for (const name of CATALOG_BACKENDS) {
			const tool = tools.get(name);
			if (tool && active.has(name)) entries.push({ name, description: tool.description, parameters: toolWireSchema(tool) });
		}
		if (active.has("write")) {
			entries.push({ name: SEND_MESSAGE, description: SEND_MESSAGE_DESCRIPTION, parameters: SEND_MESSAGE_PARAMETERS });
		}
		return entries;
	};

	const view = (entry: CatalogEntry, full: boolean) =>
		full
			? { namespace: NAMESPACE, name: entry.name, description: entry.description, inputSchema: entry.parameters }
			: { namespace: NAMESPACE, name: entry.name, description: shorten(entry.description) };

	pi.registerTool({
		name: "get_tools",
		label: "get_tools",
		loadMode: "essential",
		approval: "read",
		strict: false,
		concurrency: "shared",
		description: GET_TOOLS_DESCRIPTION,
		parameters: z.object({
			namespace: z.string().optional().describe("Tool namespace. The only available namespace is harness."),
			toolName: z.string().optional().describe("Tool name within the namespace. Requires namespace to be set."),
			pattern: z.string().max(PATTERN_LIMIT).optional().describe("Native regular expression matching namespace and tool names; at most 256 characters."),
		}),
		async execute(_toolCallId, params) {
			const namespace = params.namespace === "" ? undefined : params.namespace;
			const toolName = params.toolName === "" ? undefined : params.toolName;
			const pattern = params.pattern === "" ? undefined : params.pattern;
			if (namespace !== undefined && namespace !== NAMESPACE) {
				return fail(`Unknown namespace: ${namespace}. The only namespace is ${NAMESPACE}.`);
			}
			if (toolName !== undefined && namespace === undefined) return fail("toolName needs namespace.");
			if (pattern !== undefined) {
				if (pattern.length > PATTERN_LIMIT) return fail(`pattern is longer than ${PATTERN_LIMIT} characters.`);
				try {
					hasMatch("", pattern);
				} catch (error) {
					return fail(`Invalid pattern: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			const entries = catalog();
			if (toolName !== undefined) {
				const entry = entries.find(candidate => candidate.name === toolName);
				if (!entry) return fail(`Unknown tool ${toolName} in namespace ${NAMESPACE}.`);
				fetched.add(entry.name);
				return reply({ tools: [view(entry, true)] });
			}
			const full = namespace !== undefined && pattern === undefined;
			const selected = entries.filter(
				entry =>
					pattern === undefined ||
					hasMatch(entry.name, pattern) ||
					(namespace === undefined && hasMatch(NAMESPACE, pattern)),
			);
			if (full) for (const entry of selected) fetched.add(entry.name);
			return reply({ tools: selected.map(entry => view(entry, full)) });
		},
	});

	pi.registerTool({
		name: "eval",
		label: "eval",
		loadMode: "essential",
		approval: "exec",
		strict: false,
		concurrency: "exclusive",
		description: EVAL_DESCRIPTION,
		parameters: z.object({
			namespace: z.string().describe("Namespace from the get_tools catalog; must be harness."),
			toolName: z.string().describe("Tool name whose full input schema was returned by get_tools."),
			arguments: z.object({}).passthrough().optional().describe("Arguments object matching the fetched input schema; defaults to an empty object."),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) return fail("eval is not available to this agent.");
			if (params.namespace !== NAMESPACE) {
				return fail(`Unknown namespace: ${params.namespace}. The only namespace is ${NAMESPACE}.`);
			}
			const args: Record<string, unknown> = params.arguments ?? {};
			let target: string;
			let input: Record<string, unknown>;
			if (params.toolName === SEND_MESSAGE && fetched.has(SEND_MESSAGE)) {
				const { agent, content } = args;
				if (typeof agent !== "string" || !AGENT_ID.test(agent)) {
					return fail("send_message needs agent: an agent id, or all.");
				}
				if (typeof content !== "string") return fail("send_message needs content as a string.");
				target = "write";
				input = { path: `agent://${agent}`, content };
			} else if (CATALOG_BACKENDS.includes(params.toolName) && fetched.has(params.toolName)) {
				target = params.toolName;
				input = args;
				// A goal never has a token budget: goal create loses token_budget.
				if (target === "goal" && args.op === "create") {
					const { token_budget: _budget, ...rest } = args;
					input = rest;
				}
			} else {
				return fail(
					`${params.toolName} has no fetched schema. Call get_tools with namespace ${NAMESPACE} and toolName ${params.toolName} first.`,
				);
			}
			if (!pi.getActiveTools().includes(target)) return fail(`${target} is not available in this session.`);

			const slot: Capture = { target };
			capture = slot;
			try {
				const code = `return await tool[${JSON.stringify(target)}](${JSON.stringify(input)});`;
				const native = await ctx.invokeTool({ language: "js", code, timeout: 0 }, { signal, onUpdate });
				const captured = slot.result;
				if (!captured) return native;
				return {
					content: captured.content,
					details: { ...(isRecord(captured.details) ? captured.details : {}), [NESTED_BUDGET_KEY]: true },
					isError: captured.isError,
				};
			} finally {
				if (capture === slot) capture = undefined;
			}
		},
	});

	pi.on("session_start", (_event, ctx) => {
		const sub = ctx.agent.kind === "sub";
		return applyActive(sub ? new Set(pi.getActiveTools()) : undefined, sub);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (ctx.agent.kind !== "main") return;
		const active = pi.getActiveTools();
		const registered = pi.getAllTools().some(tool => tool.name === "goal");
		if (registered && !active.includes("goal")) await pi.setActiveTools([...active, "goal"]);
	});

	pi.on("before_provider_request", event => modelFacingPayload(event.payload));

	pi.on("tool_result", event => {
		if (capture !== undefined && event.toolName === capture.target) {
			capture.result = {
				content: event.content as Content,
				details: event.details,
				isError: event.isError,
			};
		}
	});
}
