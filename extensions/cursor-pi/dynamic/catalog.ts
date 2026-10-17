// The <dynamic_tool_catalog> section of the context message, rendered as Cursor's McpMetaToolServersSection does for dynamic namespaces.
import { paragraphOf, sectionOf, type PromptElement } from "../rules.ts";
import type { NamespaceSource } from "./namespaces.ts";

const CATALOG_INTRO =
	"These dynamic tool namespaces were available when this conversation started. Availability may have changed, so use `GetDynamicTools` to check current state before calling `CallDynamicTool`.";

// Cursor's buildMcpMetaToolServerEntries with no external catalog: a namespace always lists its tool names, and it has no count budget.
export function namespaceEntries(namespaces: NamespaceSource[]): string {
	return namespaces
		.map((namespace) => {
			const attrs = [`name="${namespace.name}"`];
			if (namespace.tools.length > 0) attrs.push(`tools="${namespace.tools.map((tool) => tool.name).join(", ")}"`);
			if (namespace.useInstructions) attrs.push(`namespaceUseInstructions="${namespace.useInstructions}"`);
			attrs.push(`source="${namespace.firstParty ? "cursor" : "mcp"}"`);
			return `<namespace ${attrs.join(" ")} />`;
		})
		.join("\n");
}

export function dynamicToolCatalogSection(namespaces: NamespaceSource[]): PromptElement | undefined {
	if (namespaces.length === 0) return undefined;
	return sectionOf("dynamic_tool_catalog", {}, [paragraphOf(CATALOG_INTRO), `<dynamic_tool_namespaces>\n${namespaceEntries(namespaces)}\n</dynamic_tool_namespaces>`]);
}
