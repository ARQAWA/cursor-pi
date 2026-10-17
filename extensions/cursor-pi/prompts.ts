import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Each supported model id has its prompt in <id>.md under PROMPT_DIR.
export const SUPPORTED_MODELS = [
	"gpt-6.1-sol",
	"gpt-6-sol",
	"gpt-6-luna",
	"gpt-5.6-sol",
	"gpt-5.6-luna",
	"gpt-5.6-terra",
	"claude-opus-5-5",
	"claude-sonnet-5-5",
	"claude-haiku-5-5",
];

const PROMPT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "research", "cursor", "remaster", "prompts");

// The prompt files name the product OMP; the name is replaced in memory only.
const NAME_SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
	["You operate in OMP.", "You operate in Cursor Pi."],
	["You are a coding agent in OMP that", "You are a coding agent in Cursor Pi that"],
	["styled by OMP.", "styled by Cursor Pi."],
];

type Prompt = { file: string; text: string };

const cache = new Map<string, Prompt>();

function loadPrompt(file: string): Prompt {
	let text = readFileSync(join(PROMPT_DIR, file), "utf8");
	for (const [from, to] of NAME_SUBSTITUTIONS) {
		if (text.split(from).length !== 2) throw new Error(`prompt ${file}: expected one ${from}`);
		text = text.replace(from, to);
	}
	if (text.includes("OMP")) throw new Error(`prompt ${file}: OMP remains after substitution`);
	return { file, text };
}

export function promptForModel(modelId: string): { file: string; text: string } | undefined {
	const segment = modelId.slice(modelId.lastIndexOf("/") + 1).toLowerCase();
	const id = segment.startsWith("claude-") ? segment.replaceAll(".", "-") : segment;
	if (!SUPPORTED_MODELS.includes(id)) return undefined;
	const file = `${id}.md`;
	let prompt = cache.get(file);
	if (!prompt) {
		prompt = loadPrompt(file);
		cache.set(file, prompt);
	}
	return prompt;
}
