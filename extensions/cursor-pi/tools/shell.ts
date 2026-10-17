import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const SHELL = declaration("Shell");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: SHELL.name,
		label: SHELL.name,
		description: SHELL.description,
		parameters: SHELL.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeShell(params, signal, ctx),
	});
}

export async function executeShell(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("Shell not implemented yet");
}
