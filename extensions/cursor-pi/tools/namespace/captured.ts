import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapturedTool } from "../declarations.ts";

// The captured declarations of the `cursor` namespace tools, one JSON file per tool, as Cursor Desktop listed them.
const NAMESPACE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "research", "cursor", "reverse", "prompts", "tools", "cursor-namespace");

// The captured entry for one namespace tool, in the shape the dynamic registry takes.
export function capturedNamespaceDeclaration(name: string): CapturedTool {
	const captured = JSON.parse(readFileSync(join(NAMESPACE_DIR, `${name}.json`), "utf8")) as { tool: string; description: string; inputSchema: Record<string, unknown> };
	if (captured.tool !== name) throw new Error(`captured declaration ${name} names ${captured.tool}`);
	return { type: "function", name, description: captured.description, parameters: captured.inputSchema };
}
