// Cursor's first-party catalog text for the cursor namespace, read at run time from the captured dynamic block in
// research/cursor/reverse/prompts/tools/cursor-namespace/dynamic-block.txt. The repo carries no Cursor code.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RESEARCH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "research", "cursor", "reverse");
const DYNAMIC_BLOCK = join(RESEARCH, "prompts", "tools", "cursor-namespace", "dynamic-block.txt");
const CRUCIAL_LEAD = "\n\nHere are some crucial instructions:\n";

interface CapturedCursorText {
	header: string;
	concise: Map<string, string>;
}

let captured: CapturedCursorText | undefined;

function loadCaptured(): CapturedCursorText {
	if (captured !== undefined) return captured;
	const block = readFileSync(DYNAMIC_BLOCK, "utf8");
	const match = /<namespace name="cursor"[^\n]*? namespaceUseInstructions="([\s\S]*?)" source="cursor" \/>/.exec(block);
	if (match === null) throw new Error(`no cursor namespace in ${DYNAMIC_BLOCK}`);
	const text = match[1] ?? "";
	const at = text.indexOf(CRUCIAL_LEAD);
	const header = at < 0 ? text : text.slice(0, at);
	const concise = new Map<string, string>();
	if (at >= 0) {
		for (const line of text.slice(at + CRUCIAL_LEAD.length).split("\n")) {
			const entry = /^- ([A-Za-z]+): (.*)$/.exec(line);
			if (entry !== null) concise.set(entry[1] ?? "", entry[2] ?? "");
		}
	}
	captured = { header, concise };
	return captured;
}

// Cursor's header for the cursor namespace's use instructions, without the per-tool lines.
export function capturedCursorUseInstructions(): string {
	return loadCaptured().header;
}

// The concise instruction Cursor lists for one first-party tool, or undefined when the capture lists none.
export function capturedConciseInstruction(toolName: string): string | undefined {
	return loadCaptured().concise.get(toolName);
}
