import { capturedCursorUseInstructions } from "./captured-instructions.ts";
import { mcpSource, type McpNamespace, type McpServerStatus } from "./mcp-source.ts";
import { FIRST_PARTY_NAMESPACE, getDynamicNamespaceUseInstructions, listDynamicTools, type DynamicToolEntry } from "./registry.ts";

export interface NamespaceTool {
	name: string;
	description: string | undefined;
	inputSchema: unknown;
}

// A namespace as GetDynamicTools and the catalog read it. `status` and `error` are undefined for the first-party namespace, as in Cursor.
export interface NamespaceSource {
	name: string;
	status: McpServerStatus | undefined;
	error: string | undefined;
	useInstructions: string | undefined;
	firstParty: boolean;
	tools: NamespaceTool[];
}

// The external (MCP) namespaces sorted by name, then the first-party namespace last, as Cursor's catalog lists them.
export async function dynamicNamespaces(cwd: string, signal?: AbortSignal, options: { includeExternal?: boolean } = {}): Promise<NamespaceSource[]> {
	const external = options.includeExternal === false ? [] : await externalNamespaces(cwd, signal);
	const firstParty = firstPartyNamespace();
	return firstParty === undefined ? external : [...external, firstParty];
}

async function externalNamespaces(cwd: string, signal: AbortSignal | undefined): Promise<NamespaceSource[]> {
	const source = mcpSource();
	if (source === undefined) return [];
	const namespaces = await source.listMcpNamespaces(cwd, signal);
	return namespaces.map(fromMcp).sort((a, b) => a.name.localeCompare(b.name));
}

function fromMcp(namespace: McpNamespace): NamespaceSource {
	return {
		name: namespace.name,
		status: namespace.status,
		error: namespace.error,
		useInstructions: namespace.instructions,
		firstParty: false,
		tools: namespace.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
	};
}

function firstPartyNamespace(): NamespaceSource | undefined {
	const entries = listDynamicTools(FIRST_PARTY_NAMESPACE);
	if (entries.length === 0) return undefined;
	const header = getDynamicNamespaceUseInstructions(FIRST_PARTY_NAMESPACE) ?? capturedCursorUseInstructions();
	return {
		name: FIRST_PARTY_NAMESPACE,
		status: undefined,
		error: undefined,
		useInstructions: useInstructionsFor(header, entries),
		firstParty: true,
		tools: entries.map((entry) => ({ name: entry.declaration.name, description: entry.declaration.description, inputSchema: entry.declaration.parameters })),
	};
}

// Cursor's buildBuiltinToolsServerUseInstructions: the header alone, or the header and one line per tool with a concise instruction.
function useInstructionsFor(header: string, entries: DynamicToolEntry[]): string {
	const lines = entries.flatMap((entry) => {
		const concise = entry.conciseInstructions?.trim();
		return concise === undefined || concise === "" ? [] : [`- ${entry.declaration.name}: ${concise}`];
	});
	return lines.length === 0 ? header : [header, "", "Here are some crucial instructions:", ...lines].join("\n");
}
