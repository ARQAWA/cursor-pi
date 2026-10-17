// One MCP server connection, made as Cursor's mcp-agent-exec makes it: the client identity "Cursor" 1.0.0, elicitation declined
// (no interactive provider here), stdio with a connect timeout, streamable HTTP with SSE fallback, OAuth through the SDK's auth
// provider, and tool calls queued one at a time per server. Requests use the SDK default timeout of 60 s, since Cursor's
// per-call timeout options are never set in its loader.
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	ElicitRequestSchema,
	type CallToolResult,
	type ReadResourceResult,
	type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Readable } from "node:stream";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { McpRemoteServerConfig, McpServerConfig, McpStdioServerConfig } from "./config.ts";
import { createOAuthProvider, MCP_OAUTH_LOOPBACK_CALLBACK_URL, type McpTokenStore } from "./oauth.ts";

const COMMAND_CONNECT_TIMEOUT_MS = 60_000;
const MAX_COMMAND_CONNECT_TIMEOUT_MS = 5 * 60_000;
const MAX_MCP_LIST_PAGES = 1000;
// Cursor's STDIO_CONNECT_STDERR_CAPTURE_MAX_BYTES and STDERR_FLUSH_TIMEOUT_MS.
const STDERR_CAPTURE_MAX_CHARS = 8192;
const STDERR_FLUSH_TIMEOUT_MS = 250;

type ServerState = { kind: "ready" } | { kind: "requires_authentication" };

export class McpServerClient {
	private toolsPromise: Promise<Tool[]> | undefined;
	private callQueue: Promise<unknown> = Promise.resolve();

	private constructor(
		readonly name: string,
		private readonly client: Client,
		private state: ServerState,
		private readonly transport: Transport | undefined,
	) {}

	static async connect(name: string, config: McpServerConfig, tokens: McpTokenStore): Promise<McpServerClient> {
		return "command" in config ? connectStdio(name, config) : connectRemote(name, config, tokens);
	}

	get status(): "ready" | "needsAuth" {
		return this.state.kind === "ready" ? "ready" : "needsAuth";
	}

	async getTools(): Promise<Tool[]> {
		if (this.state.kind !== "ready") return [];
		this.toolsPromise ??= this.listAllTools().catch((error: unknown) => {
			this.toolsPromise = undefined;
			throw error;
		});
		try {
			return await this.toolsPromise;
		} catch (error) {
			this.noteUnauthorized(error);
			throw error;
		}
	}

	private async listAllTools(): Promise<Tool[]> {
		const tools: Tool[] = [];
		const seen = new Set<string>();
		let cursor: string | undefined;
		for (let page = 1; ; page++) {
			const result = await this.client.listTools({ cursor });
			tools.push(...result.tools);
			const next = result.nextCursor;
			if (!next || seen.has(next)) return tools;
			if (page >= MAX_MCP_LIST_PAGES) {
				throw new Error(`MCP list did not end after ${MAX_MCP_LIST_PAGES} pages; refusing to keep paging`);
			}
			seen.add(next);
			cursor = next;
		}
	}

	callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
		const run = async (): Promise<CallToolResult> => {
			if (this.state.kind !== "ready") throw new UnauthorizedError(`MCP server "${this.name}" requires authentication`);
			try {
				return (await this.client.callTool({ name, arguments: args }, undefined, signal ? { signal } : undefined)) as CallToolResult;
			} catch (error) {
				this.noteUnauthorized(error);
				throw error;
			}
		};
		const next = this.callQueue.then(run, run);
		this.callQueue = next.catch(() => undefined);
		return next;
	}

	async readResource(uri: string, signal?: AbortSignal): Promise<ReadResourceResult> {
		if (this.state.kind !== "ready") return { contents: [] };
		try {
			return await this.client.readResource({ uri }, signal ? { signal } : undefined);
		} catch (error) {
			this.noteUnauthorized(error);
			throw error;
		}
	}

	// Cursor's McpInstructions: the server's instructions, trimmed; empty text counts as none.
	getInstructions(): string | undefined {
		if (this.state.kind !== "ready") return undefined;
		const text = this.client.getInstructions()?.trim();
		return text ? text : undefined;
	}

	async close(): Promise<void> {
		await this.client.close().catch(() => undefined);
		await this.transport?.close().catch(() => undefined);
	}

	// Cursor's runtime_unauthorized: a 401 on a ready server moves it to requires_authentication.
	private noteUnauthorized(error: unknown): void {
		if (error instanceof UnauthorizedError && this.state.kind === "ready") {
			this.state = { kind: "requires_authentication" };
		}
	}
}

function createClient(): Client {
	const client = new Client({ name: "Cursor", version: "1.0.0" }, { capabilities: { elicitation: { form: {} } } });
	client.setRequestHandler(ElicitRequestSchema, async () => ({ action: "decline" as const }));
	return client;
}

function requiresAuthentication(name: string): McpServerClient {
	return new McpServerClient(name, createClient(), { kind: "requires_authentication" }, undefined);
}

// Cursor's expandPath: "~" and "~/" under the home folder, "./" under the base directory.
function expandPath(filePath: string, baseDir?: string): string {
	if (filePath === "~" || filePath.startsWith("~/")) return join(homedir(), filePath.slice(1));
	if (filePath.startsWith("./") || filePath === ".") return resolve(baseDir ?? process.cwd(), filePath);
	return filePath;
}

// Splits a command line when no args array is given: whitespace separates, quotes group, backslash escapes.
function splitCommandLine(line: string): string[] {
	const args: string[] = [];
	let current = "";
	let quote: "\"" | "'" | undefined;
	let started = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i] as string;
		if (quote !== undefined) {
			if (ch === quote) quote = undefined;
			else if (ch === "\\" && quote === "\"" && i + 1 < line.length) current += line[++i];
			else current += ch;
			continue;
		}
		if (ch === "\"" || ch === "'") {
			quote = ch;
			started = true;
		} else if (ch === "\\" && i + 1 < line.length) {
			current += line[++i];
			started = true;
		} else if (/\s/.test(ch)) {
			if (started) args.push(current);
			current = "";
			started = false;
		} else {
			current += ch;
			started = true;
		}
	}
	if (started) args.push(current);
	return args;
}

function stdioCommand(config: McpStdioServerConfig): { command: string; args: string[]; cwd: string | undefined } {
	const cwd = config.cwd ? expandPath(config.cwd) : undefined;
	if (config.args && config.args.length > 0) {
		return {
			command: expandPath(config.command, cwd),
			args: config.args.map((arg) => expandPath(arg, cwd)),
			cwd,
		};
	}
	const [command = "", ...args] = splitCommandLine(config.command);
	return { command: expandPath(command, cwd), args: args.map((arg) => expandPath(arg, cwd)), cwd };
}

function commandConnectTimeoutMs(startupTimeoutSec: number | undefined): number {
	if (startupTimeoutSec !== undefined && Number.isFinite(startupTimeoutSec) && startupTimeoutSec > 0) {
		return Math.min(startupTimeoutSec * 1000, MAX_COMMAND_CONNECT_TIMEOUT_MS);
	}
	return COMMAND_CONNECT_TIMEOUT_MS;
}

// Cursor's sanitizeErrorMessageForLog: secrets are redacted, then the text is cut to the limit.
function sanitizeForLog(value: string, maxLength: number): string {
	const redacted = value
		.replace(/(authorization[^:=\r\n]{0,32}[:=]\s*["']?)(?:[A-Za-z][\w.~+/-]*[ \t]+)?[^"',\s&}]+/gi, "$1[REDACTED]")
		.replace(
			/((?:access_token|refresh_token|id_token|client_secret|code|password|assertion|token|secret)[^:=\r\n]{0,32}[:=]\s*["']?)([^"',\s&}]+)/gi,
			"$1[REDACTED]",
		)
		.replace(/(\bBearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi, "$1[REDACTED]");
	return redacted.length > maxLength ? `${redacted.slice(0, Math.max(0, maxLength - 3))}...` : redacted;
}

// Cursor's captureStdioStderr: up to 8192 characters of the child's stderr. Reading it after a failed connect first waits up to
// 250 ms for the stream to end.
function captureStderr(stream: Readable | null | undefined): () => Promise<string> {
	let captured = "";
	let ended = stream === null || stream === undefined;
	stream?.on("data", (chunk: Buffer | string) => {
		const room = STDERR_CAPTURE_MAX_CHARS - captured.length;
		if (room > 0) captured += chunk.toString().slice(0, room);
	});
	stream?.once("end", () => {
		ended = true;
	});
	return async () => {
		if (!ended && stream) {
			await new Promise<void>((resolve) => {
				const finish = () => {
					clearTimeout(timer);
					stream.off("end", finish);
					resolve();
				};
				const timer = setTimeout(finish, STDERR_FLUSH_TIMEOUT_MS);
				timer.unref();
				stream.once("end", finish);
			});
		}
		return sanitizeForLog(captured.replace(/\s+/g, " ").trim(), STDERR_CAPTURE_MAX_CHARS);
	};
}

// Cursor's annotateMcpStdioConnectError: a failed connect carries the child's stderr in its message.
function annotateStderr(error: unknown, tail: string): unknown {
	if (tail === "") return error;
	const annotated = error instanceof Error ? error : new Error(String(error));
	annotated.message = `${annotated.message}; stderr: ${tail}`;
	return annotated;
}

async function connectStdio(name: string, config: McpStdioServerConfig): Promise<McpServerClient> {
	const { command, args, cwd } = stdioCommand(config);
	const transport = new StdioClientTransport({ command, args, cwd, env: config.env ?? {}, stderr: "pipe" });
	const client = createClient();
	const timeoutMs = commandConnectTimeoutMs(config.startupTimeoutSec);
	const abort = new AbortController();
	const connection = client.connect(transport, { timeout: timeoutMs, signal: abort.signal });
	const readStderr = captureStderr(transport.stderr);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`MCP server connection timed out after ${timeoutMs}ms: ${name}`)),
			timeoutMs,
		);
	});
	try {
		await Promise.race([connection, timedOut]);
	} catch (error) {
		abort.abort();
		connection.catch(() => undefined);
		await transport.close().catch(() => undefined);
		throw annotateStderr(error, await readStderr());
	} finally {
		clearTimeout(timer);
	}
	return new McpServerClient(name, client, { kind: "ready" }, transport);
}

function httpStatusOf(error: unknown): number | undefined {
	if (typeof error !== "object" || error === null) return undefined;
	const code = (error as { code?: unknown }).code;
	if (typeof code === "number" && code >= 100 && code <= 599) return code;
	if (typeof code === "string" && /^\d{3}$/.test(code) && Number(code) >= 100 && Number(code) <= 599) return Number(code);
	const message = error instanceof Error ? error.message : (error as { message?: unknown }).message;
	const match = typeof message === "string" ? message.match(/\bHTTP\s+(\d{3})\b/i) : null;
	return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

// Cursor's isSseFallbackAppropriate: 400, 404 or 405 from the streamable endpoint, a session-id complaint, or a refused connection.
function sseFallbackAppropriate(error: unknown): boolean {
	const status = httpStatusOf(error);
	if (status !== undefined) return status === 400 || status === 404 || status === 405;
	if (error instanceof Error && error.message.toLowerCase().includes("sessionid must be provided")) return true;
	if (!(error instanceof Error)) return false;
	const withCode = error as Error & { code?: unknown; cause?: { code?: unknown } };
	return withCode.code === "ECONNREFUSED" || withCode.cause?.code === "ECONNREFUSED" || error.message.includes("ECONNREFUSED");
}

function isAuthFailure(error: unknown): boolean {
	return error instanceof UnauthorizedError || httpStatusOf(error) === 401;
}

async function connectRemote(name: string, config: McpRemoteServerConfig, tokens: McpTokenStore): Promise<McpServerClient> {
	const url = new URL(config.url);
	const headers = { "User-Agent": "Cursor/1.0.0", ...(config.headers ?? {}) };
	const authProvider = await createOAuthProvider({
		identifier: name,
		config,
		store: tokens,
		redirectUrl: MCP_OAUTH_LOOPBACK_CALLBACK_URL,
	});
	if (config.type !== "sse") {
		const client = createClient();
		const transport = new StreamableHTTPClientTransport(url, { authProvider, requestInit: { headers } });
		try {
			await client.connect(transport);
			return new McpServerClient(name, client, { kind: "ready" }, transport);
		} catch (error) {
			await transport.close().catch(() => undefined);
			if (isAuthFailure(error)) return requiresAuthentication(name);
			if (!sseFallbackAppropriate(error)) throw error;
		}
	}
	const client = createClient();
	const transport = new SSEClientTransport(url, { authProvider, requestInit: { headers } });
	try {
		await client.connect(transport);
		return new McpServerClient(name, client, { kind: "ready" }, transport);
	} catch (error) {
		await transport.close().catch(() => undefined);
		if (isAuthFailure(error)) return requiresAuthentication(name);
		throw error;
	}
}
