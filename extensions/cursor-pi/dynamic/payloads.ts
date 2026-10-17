// Cursor's text rules for what GetDynamicTools returns: description detail levels, namespace and tool payloads, search rows.
import type { McpServerStatus } from "./mcp-source.ts";
import type { NamespaceSource, NamespaceTool } from "./namespaces.ts";

export type DescriptionDetail = "short" | "full" | "fullVerbatim";

const MAX_DESCRIPTION_LENGTH = 200;
export const TRUNCATED_DESCRIPTION_SUFFIX = "... [truncated]";
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

function sanitizeDescription(raw: string | undefined): string | undefined {
	if (raw === undefined) return undefined;
	const sanitized = raw.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim();
	return sanitized === "" ? undefined : sanitized;
}

function sanitizeAndTruncate(raw: string | undefined): string | undefined {
	const sanitized = sanitizeDescription(raw);
	if (sanitized === undefined || sanitized.length <= MAX_DESCRIPTION_LENGTH) return sanitized;
	return `${sanitized.slice(0, MAX_DESCRIPTION_LENGTH - TRUNCATED_DESCRIPTION_SUFFIX.length)}${TRUNCATED_DESCRIPTION_SUFFIX}`;
}

export function describeAt(raw: string | undefined, detail: DescriptionDetail): string | undefined {
	if (detail === "fullVerbatim") return raw?.trim() || undefined;
	if (detail === "full") return sanitizeDescription(raw);
	return sanitizeAndTruncate(raw);
}

export interface ToolPayload {
	tool: string;
	description: string | undefined;
	inputSchema?: unknown;
}

export function toolPayload(tool: NamespaceTool, detail: DescriptionDetail, includeSchema: boolean): ToolPayload {
	const description = describeAt(tool.description, detail);
	return includeSchema && tool.inputSchema !== undefined ? { tool: tool.name, description, inputSchema: tool.inputSchema } : { tool: tool.name, description };
}

export interface ServerPayload {
	server: string;
	serverStatus: McpServerStatus | undefined;
	serverError: string | undefined;
	serverDescription: string | undefined;
	tools: ToolPayload[];
}

// Cursor's descriptorToServerPayload: a lookup (includeSchema) returns full descriptions, verbatim for the first-party namespace.
export function serverPayload(namespace: NamespaceSource, options: { includeSchema?: boolean; toolName?: string } = {}): ServerPayload {
	const lookup = options.includeSchema === true;
	const detail: DescriptionDetail = lookup ? (namespace.firstParty ? "fullVerbatim" : "full") : "short";
	const tools = namespace.tools
		.filter((tool) => options.toolName === undefined || tool.name === options.toolName)
		.map((tool) => toolPayload(tool, detail, lookup))
		.sort((a, b) => a.tool.localeCompare(b.tool));
	return {
		server: namespace.name,
		serverStatus: namespace.status,
		serverError: namespace.error,
		serverDescription: describeAt(namespace.useInstructions, detail),
		tools,
	};
}

// Cursor's toModelFacingServerPayload for dynamic namespaces.
export function namespaceModel(payload: ServerPayload) {
	return {
		namespace: payload.server,
		namespaceStatus: payload.serverStatus,
		namespaceError: payload.serverError,
		namespaceDescription: payload.serverDescription,
		tools: payload.tools,
	};
}

export interface SearchMatch {
	server: string;
	tool?: string;
	description: string | undefined;
	serverStatus?: McpServerStatus;
	serverError?: string;
}

// Cursor's collectSearchMatches: namespace rows when the namespace name matches, tool rows otherwise, sorted by namespace then tool.
export function searchMatches(namespaces: NamespaceSource[], regex: RegExp): SearchMatch[] {
	const matches: SearchMatch[] = [];
	for (const namespace of namespaces) {
		const metadata = serverPayload(namespace);
		const namespaceMatches = regex.test(namespace.name);
		if (namespaceMatches) {
			matches.push({ server: namespace.name, description: metadata.serverDescription, serverStatus: metadata.serverStatus, serverError: metadata.serverError });
		}
		for (const tool of namespace.tools.filter((candidate) => namespaceMatches || regex.test(candidate.name))) {
			const row: SearchMatch = { server: namespace.name, tool: tool.name, description: describeAt(tool.description, "short") };
			if (metadata.serverStatus !== undefined && metadata.serverStatus !== "ready" && !namespaceMatches) {
				row.serverStatus = metadata.serverStatus;
				row.serverError = metadata.serverError;
			}
			matches.push(row);
		}
	}
	return matches.sort((a, b) => (a.server === b.server ? (a.tool ?? "").localeCompare(b.tool ?? "") : a.server.localeCompare(b.server)));
}

export function searchResult(pattern: string, matches: SearchMatch[]) {
	return {
		mode: "search",
		pattern,
		matches: matches.map((match) => ({
			namespace: match.server,
			tool: match.tool,
			description: match.description,
			namespaceStatus: match.serverStatus,
			namespaceError: match.serverError,
		})),
	};
}

// Cursor's catalog mode: every namespace in name order, with short descriptions and no schemas.
export function catalogResult(namespaces: NamespaceSource[]) {
	const payloads = [...namespaces].sort((a, b) => a.name.localeCompare(b.name)).map((namespace) => namespaceModel(serverPayload(namespace)));
	return { mode: "catalog", namespaces: payloads };
}
