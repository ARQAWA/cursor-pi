import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TSchema } from "typebox";

// One captured tool entry, with the key order Cursor Desktop sent.
export interface CapturedTool {
	type: "function" | "custom";
	name: string;
	description: string;
	parameters?: Record<string, unknown>;
	strict?: boolean;
	format?: { type: string; syntax: string; definition: string };
}

const RESEARCH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "research", "cursor", "reverse");
const MAIN_TOOLSET = join(RESEARCH, "runs-2026-10-16-T4", "tools", "tools-1-4b2bc1b7.json");
// Read only for names the main toolset lacks (UpdateCurrentStep); its other entries differ from the main toolset.
const SUBAGENT_TOOLSET = join(RESEARCH, "runs-2026-10-16", "sol", "tools", "toolset-fae49d045d4e.json");

const DECLARATIONS = new Map<string, CapturedTool>();
for (const file of [MAIN_TOOLSET, SUBAGENT_TOOLSET]) {
	for (const entry of JSON.parse(readFileSync(file, "utf8")) as CapturedTool[]) {
		if (!DECLARATIONS.has(entry.name)) DECLARATIONS.set(entry.name, entry);
	}
}

// The captured entry for a tool name, exactly as Cursor Desktop sent it.
export function declaration(name: string): CapturedTool {
	const entry = DECLARATIONS.get(name);
	if (entry === undefined) throw new Error(`no captured declaration for tool ${name}`);
	return entry;
}

// Cursor's main agent tools, in the order of the captured toolset.
export const MAIN_TOOL_ORDER = ["Shell", "Glob", "rg", "ReadFile", "ApplyPatch", "AskQuestion", "GetDynamicTools", "CallDynamicTool"] as const;

// Pi checks a tool's arguments against the schema registered with the tool before execute runs, and Cursor checks its own
// arguments inside each tool. Tools register this schema, which accepts any object unchanged; the captured schema reaches the
// provider on the wire instead (index.ts).
export const PASSTHROUGH_PARAMETERS = { type: "object", additionalProperties: true } as unknown as TSchema;
