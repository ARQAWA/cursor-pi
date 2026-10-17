// MCP server definitions as Cursor Desktop reads them. The JSONC parse, the ${...} expansion and the schema follow Cursor's
// mcp-agent-exec/config.js, mcp-core/dist/config/mcp-config-schema.js and mcp-config/dist/index.js. The namespace prefixes
// follow agent-host-exec's headless definition sources: project-<index>-<workspace basename>- and user-.
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

export type McpStdioServerConfig = {
	type?: "stdio";
	command: string;
	args?: string[];
	env?: Record<string, string>;
	envFile?: string;
	cwd?: string;
	enabledTools?: string[];
	startupTimeoutSec?: number;
};

export type McpRemoteServerConfig = {
	type?: "http" | "sse";
	url: string;
	headers?: Record<string, string>;
	auth?: { CLIENT_ID: string; CLIENT_SECRET?: string; scopes?: string[] };
	tls?: { caBundle: string };
	placement?: "server" | "client";
	enabledTools?: string[];
};

export type McpServerConfig = McpStdioServerConfig | McpRemoteServerConfig;

export interface McpConfig {
	mcpServers: Record<string, McpServerConfig>;
}

export interface McpDefinition {
	identifier: string;
	serverConfig: McpServerConfig;
	configPath: string;
	approvalRoot: string;
}

const MAX_CA_BUNDLE_LENGTH = 128 * 1024;
// Cursor's ENV_VAR_PATTERN2: ${env:NAME}, ${NAME} and ${NAME:-default}.
const ENV_VAR_PATTERN = /\$\{(?:env:([A-Za-z_][A-Za-z0-9_]*)|([^:}]+)(?::-([^}]*))?)\}/g;

type Json = Record<string, unknown>;

// A value that does not match one schema arm. The union tries the next arm, and a file fails when no arm matches.
class SchemaMismatch extends Error {}

function fail(): never {
	throw new SchemaMismatch();
}

function objectOf(value: unknown): Json {
	if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
	return value as Json;
}

function requireString(value: unknown): string {
	if (typeof value !== "string") fail();
	return value;
}

function stringArray(value: unknown): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) fail();
	return value as string[];
}

function stringRecord(value: unknown): Record<string, string> {
	const record = objectOf(value);
	for (const item of Object.values(record)) requireString(item);
	return { ...record } as Record<string, string>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
	if (!allowed.includes(value as T)) fail();
	return value as T;
}

// zod's optional: an absent key is undefined, a present one must pass the parser.
function optional<T>(value: unknown, parse: (value: unknown) => T): T | undefined {
	return value === undefined ? undefined : parse(value);
}

// Keys are listed in schema order because approval keys hash the JSON of the parsed server.
function parseStdioServer(raw: unknown): McpStdioServerConfig {
	const o = objectOf(raw);
	const type = optional(o.type, (value) => oneOf(value, ["stdio"] as const));
	const command = requireString(o.command);
	const args = optional(o.args, stringArray);
	const env = optional(o.env, stringRecord);
	const envFile = optional(o.envFile, requireString);
	const cwd = optional(o.cwd, requireString);
	const enabledTools = optional(o.enabledTools, stringArray);
	// Cursor's _catch(optional(positive number), undefined): a bad value is dropped rather than failing the server.
	const startupTimeoutSec =
		typeof o.startupTimeoutSec === "number" && Number.isFinite(o.startupTimeoutSec) && o.startupTimeoutSec > 0
			? o.startupTimeoutSec
			: undefined;
	return { type, command, args, env, envFile, cwd, enabledTools, startupTimeoutSec };
}

function parseRemoteServer(raw: unknown): McpRemoteServerConfig {
	const o = objectOf(raw);
	const type = optional(o.type, (value) => oneOf(value, ["http", "sse"] as const));
	const url = requireString(o.url);
	const headers = optional(o.headers, stringRecord);
	const auth = optional(o.auth, (value) => {
		const a = objectOf(value);
		return {
			CLIENT_ID: requireString(a.CLIENT_ID),
			CLIENT_SECRET: optional(a.CLIENT_SECRET, requireString),
			scopes: optional(a.scopes, stringArray),
		};
	});
	const tls = optional(o.tls, (value) => {
		const t = objectOf(value);
		if (Object.keys(t).some((key) => key !== "caBundle")) fail();
		const caBundle = requireString(t.caBundle).trim();
		if (caBundle.length < 1 || caBundle.length > MAX_CA_BUNDLE_LENGTH) fail();
		return { caBundle };
	});
	const placement = optional(o.placement, (value) => oneOf(value, ["server", "client"] as const));
	const enabledTools = optional(o.enabledTools, stringArray);
	return { type, url, headers, auth, tls, placement, enabledTools };
}

function parseServer(raw: unknown): McpServerConfig {
	try {
		return parseStdioServer(raw);
	} catch (error) {
		if (!(error instanceof SchemaMismatch)) throw error;
	}
	return parseRemoteServer(raw);
}

// Cursor's mcpConfigSchema: one server that matches neither arm makes the whole file invalid.
export function parseMcpConfig(raw: unknown): McpConfig {
	const servers = objectOf(objectOf(raw).mcpServers);
	return { mcpServers: Object.fromEntries(Object.entries(servers).map(([name, value]) => [name, parseServer(value)])) };
}

function expandString(value: string, env: NodeJS.ProcessEnv): string {
	return value.replace(ENV_VAR_PATTERN, (match: string, envName?: string, plainName?: string, defaultValue?: string) => {
		if (envName !== undefined) return env[envName] ?? match;
		const found = env[plainName as string];
		if (found !== undefined) return found;
		return defaultValue ?? match;
	});
}

export function expandEnvVars(value: unknown, env: NodeJS.ProcessEnv): unknown {
	if (typeof value === "string") return expandString(value, env);
	if (Array.isArray(value)) return value.map((item) => expandEnvVars(item, env));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnvVars(item, env)]));
	}
	return value;
}

// Cursor's getMcpConfig: a missing, unreadable or invalid file contributes no servers.
export async function readMcpConfigFile(path: string, env: NodeJS.ProcessEnv = process.env): Promise<McpConfig> {
	try {
		const text = await readFile(path, "utf8");
		return parseMcpConfig(expandEnvVars(parseJsonc(text), env));
	} catch {
		return { mcpServers: {} };
	}
}

function definitionsOf(config: McpConfig, prefix: string, configPath: string, approvalRoot: string): McpDefinition[] {
	return Object.entries(config.mcpServers).map(([name, serverConfig]) => ({
		identifier: `${prefix}${name}`,
		serverConfig,
		configPath,
		approvalRoot,
	}));
}

// Project servers first, then user servers, as Cursor's headless lease orders its definition sources.
export async function listMcpDefinitions(workspace: string, home: string): Promise<McpDefinition[]> {
	const root = resolve(workspace);
	const projectPath = join(root, ".cursor", "mcp.json");
	const userPath = join(home, ".cursor", "mcp.json");
	const project = await readMcpConfigFile(projectPath);
	const user = await readMcpConfigFile(userPath);
	return [
		...definitionsOf(project, `project-0-${basename(root)}-`, projectPath, root),
		...definitionsOf(user, "user-", userPath, home),
	];
}
