import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { CapturedTool } from "../tools/declarations.ts";

// Cursor's reserved namespace for first-party tools. MCP servers never produce it, and this registry accepts no other.
export const FIRST_PARTY_NAMESPACE = "cursor";

export interface DynamicToolResult {
	text: string;
	isError: boolean;
}

// A first-party tool in a dynamic namespace. GetDynamicTools describes it from `declaration`, and CallDynamicTool runs `execute`.
export interface DynamicToolEntry {
	namespace: string;
	declaration: CapturedTool;
	// The line Cursor lists for this tool under the namespace's use instructions; omitted when Cursor lists none.
	conciseInstructions?: string;
	// toolCallId is the id of the CallDynamicTool call that runs the tool, when one does.
	execute(args: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext, toolCallId?: string): Promise<DynamicToolResult>;
}

interface NamespaceState {
	useInstructions: string | undefined;
	tools: Map<string, DynamicToolEntry>;
}

const NAMESPACES = new Map<string, NamespaceState>();

function stateOf(namespace: string): NamespaceState {
	if (namespace !== FIRST_PARTY_NAMESPACE) throw new Error(`only the ${FIRST_PARTY_NAMESPACE} namespace is registered here, got ${namespace}`);
	let state = NAMESPACES.get(namespace);
	if (state === undefined) {
		state = { useInstructions: undefined, tools: new Map() };
		NAMESPACES.set(namespace, state);
	}
	return state;
}

// Sets the namespace's use-instructions header; registering it again replaces the header.
export function registerDynamicNamespace(namespace: string, useInstructions?: string): void {
	stateOf(namespace).useInstructions = useInstructions;
}

export function registerDynamicTool(entry: DynamicToolEntry): void {
	const tools = stateOf(entry.namespace).tools;
	const name = entry.declaration.name;
	if (tools.has(name)) throw new Error(`dynamic tool ${entry.namespace}.${name} is already registered`);
	tools.set(name, entry);
}

export function getDynamicTool(namespace: string, toolName: string): DynamicToolEntry | undefined {
	return NAMESPACES.get(namespace)?.tools.get(toolName);
}

export function getDynamicNamespaceUseInstructions(namespace: string): string | undefined {
	return NAMESPACES.get(namespace)?.useInstructions;
}

// The namespace's tools sorted by name, as Cursor's registry lists them.
export function listDynamicTools(namespace: string): DynamicToolEntry[] {
	const tools = NAMESPACES.get(namespace)?.tools;
	if (tools === undefined) return [];
	return [...tools.values()].sort((a, b) => a.declaration.name.localeCompare(b.declaration.name));
}

export function listDynamicNamespaces(): string[] {
	return [...NAMESPACES.entries()].filter(([, state]) => state.tools.size > 0).map(([name]) => name);
}
