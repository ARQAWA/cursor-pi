import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const ASK_QUESTION = declaration("AskQuestion");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_QUESTION.name,
		label: ASK_QUESTION.name,
		description: ASK_QUESTION.description,
		parameters: ASK_QUESTION.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeAskQuestion(params, signal, ctx),
	});
}

export async function executeAskQuestion(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("AskQuestion not implemented yet");
}
