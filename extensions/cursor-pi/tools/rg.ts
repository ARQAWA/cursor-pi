import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const RG = declaration("rg");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: RG.name,
		label: RG.name,
		description: RG.description,
		parameters: RG.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeRg(params, signal, ctx),
	});
}

export async function executeRg(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("rg not implemented yet");
}
