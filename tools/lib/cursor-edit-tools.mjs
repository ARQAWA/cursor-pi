// Builds the file-editing tools that Cursor's code gives an Anthropic model, through the oracle. The oracle initializes the
// Cursor modules; nothing here copies Cursor code.
import { initModule } from "../cursor-oracle.mjs";

const MODULES = [
	"../agent/dist/configs/tool-set-finalization.js",
	"../agent/dist/tools/core/edit/str-replace.js",
	"../agent/dist/tools/core/edit/write.js",
	"../agent/dist/tools/core/edit/edit-notebook.js",
	"../agent/dist/tools/core/edit/unified-diff-worker.js",
];

// The model facts Cursor's edit-tool generator reads for claude-opus-5-5.
export const MODEL = { vendor: "anthropic", modelName: "claude-opus-5-5", isGemini3: false, isGpt5Family: false, isComposer15: false };

// Line numbers in the default style, which is what Cursor's addLineNumbers uses when neither GPT style flag is set.
export const FORMATTING_OPTIONS = { shouldUseFormatCodeblock: true, gpt5StyleLineNumbers: false, gpt5CodexCatN: false };

export function stateHandler() {
	return { mode: undefined, plans: new Map(), todos: [], recordFileState() {} };
}

// The StrReplace and Write declarations in Cursor's order: name, description and input_schema as Cursor builds them.
export function anthropicEditTools(cursor) {
	for (const marker of MODULES) initModule(cursor, marker);
	const resourceAccessor = { get: () => ({}) };
	const built = cursor.defaultAgentEditToolGenerator({
		resourceAccessor,
		fileOperationLockManager: new cursor.FileOperationLockManager(),
		stateHandler: stateHandler(),
		formattingOptions: FORMATTING_OPTIONS,
		promptVersion: undefined,
		modelInfo: MODEL,
		featureFlags: {},
	});
	const strReplace = built.find((tool) => tool.name === "StrReplace");
	const write = built.find((tool) => tool.name === "Write");
	if (strReplace === undefined || write === undefined) {
		throw new Error(`Cursor built ${built.map((tool) => tool.name).join(", ")} for anthropic; expected StrReplace and Write`);
	}
	const allTools = { STR_REPLACE: strReplace, WRITE: write };
	return [strReplace, write].map((tool) => ({
		name: tool.name,
		description: tool.descriptionGenerator({ allTools }),
		parameters: tool.parameters,
	}));
}
