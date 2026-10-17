import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const GLOB = declaration("Glob");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: GLOB.name,
		label: GLOB.name,
		description: GLOB.description,
		parameters: GLOB.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeGlob(params, signal, ctx),
	});
}

export async function executeGlob(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("Glob not implemented yet");
}
