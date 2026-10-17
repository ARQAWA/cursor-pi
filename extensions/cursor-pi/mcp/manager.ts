// Connections for one workspace. Each listing re-reads the config files, admits the servers that are enabled and approved, and
// connects the ones newly admitted; connected servers stay up until they are removed or disabled. Namespaces are listed in config
// order.
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { homedir } from "node:os";
import { projectDirFor } from "../tools/shell/paths.ts";
import { McpServerClient } from "./client.ts";
import { listMcpDefinitions, type McpDefinition } from "./config.ts";
import { callResult, errorCallResult, fetchErrorResult, fetchedResourceResult, formatCallToolResult } from "./format.ts";
import { authorizeRemoteServer, mcpTokenStore, type McpTokenStore } from "./oauth.ts";
import { spillResourceText, spillToolResult } from "./spill.ts";
import { addMcpServerApproval, isMcpServerApproved, isMcpServerDisabled } from "./state.ts";
import type { McpCallResult, McpHooks, McpNamespace, McpServerStatus, McpToolDefinition } from "./types.ts";

// Cursor's mcpServerUnavailableReason (agent-exec/ls.js): the namespace error for a server that is not ready.
const UNAVAILABLE_REASON: Partial<Record<McpServerStatus, string>> = {
	needsAuth: "This MCP server requires authentication before its tools can be used.",
	error: "This MCP server failed during live tool discovery. Its tools are unavailable until the connection is fixed.",
	loading: "This MCP server is still loading; tools may not be available yet.",
};

// Cursor's virtual mcp_auth tool (get-mcp-tools.js, meta-tool-names.js), listed for a server that needs authentication.
const MCP_AUTH_TOOL_NAME = "mcp_auth";
const MCP_AUTH_TOOL: McpToolDefinition = {
	name: MCP_AUTH_TOOL_NAME,
	description: "Authenticate this MCP server so its tools can be used.",
	inputSchema: { type: "object", properties: {}, additionalProperties: false },
	annotations: undefined,
};

interface Listed {
	name: string;
	client: McpServerClient;
	tools: Tool[];
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function notFound(kind: string, name: string, available: string[]): string {
	return available.length === 0
		? `${kind} "${name}" not found.`
		: `${kind} "${name}" not found. Available ${kind}s: ${available.join(", ")}`;
}

// Cursor's McpManager.getToolSet: a tool is keyed "<server>-<tool>". When different tools share a key, neither is exposed;
// a server that lists the same tool twice exposes its first copy.
function keptTools(listed: Listed[]): Set<Tool> {
	const groups = new Map<string, { server: string; tool: Tool }[]>();
	for (const { name, tools } of listed) {
		for (const tool of tools) {
			const key = `${name}-${tool.name}`;
			groups.set(key, [...(groups.get(key) ?? []), { server: name, tool }]);
		}
	}
	const kept = new Set<Tool>();
	for (const group of groups.values()) {
		const first = group[0] as { server: string; tool: Tool };
		if (group.some((candidate) => candidate.server !== first.server || candidate.tool.name !== first.tool.name)) continue;
		kept.add(first.tool);
	}
	return kept;
}

function toToolDefinition(tool: Tool): McpToolDefinition {
	return {
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema as Record<string, unknown>,
		annotations: tool.annotations as Record<string, unknown> | undefined,
	};
}

export class McpManager {
	private readonly clients = new Map<string, McpServerClient>();
	private readonly failures = new Map<string, string>();
	// Servers the host declined to approve in this manager's life; they are not asked again.
	private readonly declined = new Set<string>();
	private readonly tokens: McpTokenStore;
	private definitions: McpDefinition[] = [];
	private queue: Promise<unknown> = Promise.resolve();

	constructor(
		private readonly workspace: string,
		private readonly stateDir: string,
		private readonly home: string = homedir(),
		private readonly hooks: McpHooks = { approvalPrompt: undefined, openUrl: () => undefined },
	) {
		this.tokens = mcpTokenStore(stateDir);
	}

	// Loads are serialized, so two listings never connect the same server twice.
	load(): Promise<void> {
		const next = this.queue.then(() => this.reload());
		this.queue = next.catch(() => undefined);
		return next;
	}

	private async reload(): Promise<void> {
		this.definitions = await listMcpDefinitions(this.workspace, this.home);
		const wanted = new Set(this.definitions.map((definition) => definition.identifier));
		for (const identifier of [...this.clients.keys()]) {
			if (!wanted.has(identifier)) await this.drop(identifier);
		}
		// Admission may ask the host one server at a time; the admitted servers then connect in parallel.
		const admitted: McpDefinition[] = [];
		for (const definition of this.definitions) {
			if (await this.admit(definition)) admitted.push(definition);
			else await this.drop(definition.identifier);
		}
		await Promise.all(admitted.map((definition) => this.connect(definition)));
	}

	private async connect(definition: McpDefinition): Promise<void> {
		const { identifier } = definition;
		if (this.clients.has(identifier)) return;
		try {
			this.clients.set(identifier, await McpServerClient.connect(identifier, definition.serverConfig, this.tokens));
			this.failures.delete(identifier);
		} catch (error) {
			this.failures.set(identifier, messageOf(error));
		}
	}

	// Disabled servers are skipped. An unapproved server runs only when the host's prompt approves it; without a prompt it is
	// skipped silently, as Cursor skips it.
	private async admit(definition: McpDefinition): Promise<boolean> {
		const name = definition.identifier;
		if (await isMcpServerDisabled(this.stateDir, name)) return false;
		if (await isMcpServerApproved(this.stateDir, name, definition.serverConfig, definition.approvalRoot)) return true;
		if (this.hooks.approvalPrompt === undefined || this.declined.has(name)) return false;
		const approved = await this.hooks.approvalPrompt({
			name,
			configPath: definition.configPath,
			server: definition.serverConfig,
		});
		if (!approved) {
			this.declined.add(name);
			return false;
		}
		await addMcpServerApproval(this.stateDir, name, definition.serverConfig, definition.approvalRoot);
		return true;
	}

	private async drop(identifier: string): Promise<void> {
		const client = this.clients.get(identifier);
		this.clients.delete(identifier);
		await client?.close();
	}

	private async listing(): Promise<{ namespaces: Listed[]; kept: Set<Tool> }> {
		const entries = this.definitions.flatMap((definition) => {
			const client = this.clients.get(definition.identifier);
			return client ? [{ name: definition.identifier, client }] : [];
		});
		// No listing deadline: Cursor's headless lease passes none, so the first listing waits for every server.
		const namespaces = await Promise.all(
			entries.map(async (entry) => ({ ...entry, tools: await entry.client.getTools().catch(() => []) })),
		);
		return { namespaces, kept: keptTools(namespaces) };
	}

	async namespaces(): Promise<McpNamespace[]> {
		const { namespaces, kept } = await this.listing();
		return namespaces.map(({ name, client, tools }) => {
			const status = client.status;
			return {
				name,
				status,
				error: status === "ready" ? undefined : UNAVAILABLE_REASON[status],
				instructions: client.getInstructions(),
				// A server that needs authentication lists only mcp_auth, which is how Cursor's needsAuth status reads back.
				tools:
					status === "needsAuth" ? [MCP_AUTH_TOOL] : tools.filter((tool) => kept.has(tool)).map(toToolDefinition),
			};
		});
	}

	async callTool(namespace: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
		const { namespaces, kept } = await this.listing();
		const entry = namespaces.find((candidate) => candidate.name === namespace);
		if (!entry) throw new Error(notFound("namespace", namespace, namespaces.map((candidate) => candidate.name)));
		if (entry.client.status === "needsAuth") {
			if (toolName !== MCP_AUTH_TOOL_NAME) throw new Error(`Tool ${toolName} not found, available tools: ${MCP_AUTH_TOOL_NAME}`);
			return this.authenticate(namespace, signal);
		}
		const listed = entry.tools.filter((tool) => kept.has(tool));
		if (!listed.some((tool) => tool.name === toolName)) {
			throw new Error(`Tool ${toolName} not found, available tools: ${listed.map((tool) => tool.name).join(", ")}`);
		}
		let result: McpCallResult;
		try {
			result = await formatCallToolResult(await entry.client.callTool(toolName, args, signal));
		} catch (error) {
			return errorCallResult(messageOf(error));
		}
		return spillToolResult(result, this.projectDir());
	}

	// Cursor's mcp_auth: sign in through the browser, then connect again with the stored tokens.
	private async authenticate(name: string, signal?: AbortSignal): Promise<McpCallResult> {
		const definition = this.definitions.find((candidate) => candidate.identifier === name);
		if (definition === undefined || !("url" in definition.serverConfig)) {
			return errorCallResult(`MCP server "${name}" does not support sign-in`);
		}
		try {
			await authorizeRemoteServer({
				identifier: name,
				config: definition.serverConfig,
				store: this.tokens,
				openUrl: this.hooks.openUrl,
				signal,
			});
		} catch (error) {
			return errorCallResult(messageOf(error));
		}
		await this.drop(name);
		await this.connect(definition);
		if (this.clients.get(name)?.status !== "ready") return errorCallResult(`MCP server "${name}" requires authentication`);
		return callResult(
			[{ type: "text", text: `Successfully authenticated MCP server: ${name}. The server's tools should now be available.` }],
			false,
			undefined,
		);
	}

	// Cursor's LocalReadMcpResourceExecutor and FetchMcpResource render, for the first content item of the resource.
	async readResource(server: string, uri: string, signal?: AbortSignal): Promise<McpCallResult> {
		const client = this.clients.get(server);
		if (!client) return fetchErrorResult(`Server "${server}" not found`);
		if (client.status !== "ready") return fetchErrorResult(`Server "${server}" is not ready`);
		try {
			const { contents } = await client.readResource(uri, signal);
			if (contents.length === 0) return fetchErrorResult(`MCP resource not found: ${uri}`);
			const item = contents[0] as { uri?: string; name?: string; description?: string; mimeType?: string; text?: string; blob?: string };
			const base = { uri, name: item.name, description: item.description, mimeType: item.mimeType };
			if (item.text) {
				const content = await spillResourceText(item.text, this.projectDir());
				return fetchedResourceResult({ ...base, content });
			}
			if (item.blob) {
				const bytes = Buffer.from(item.blob, "base64").length;
				return fetchedResourceResult({ ...base, content: `[Binary content: ${bytes} bytes]` });
			}
			return fetchErrorResult("Failed to read resource");
		} catch (error) {
			return fetchErrorResult(`Failed to read MCP resource: ${messageOf(error)}`);
		}
	}

	loadFailures(): { identifier: string; message: string }[] {
		return [...this.failures].map(([identifier, message]) => ({ identifier, message }));
	}

	async close(): Promise<void> {
		await Promise.all([...this.clients.keys()].map((identifier) => this.drop(identifier)));
	}

	private projectDir(): string {
		return projectDirFor(this.workspace);
	}
}
