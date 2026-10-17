import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";

const READ_FILE = declaration("ReadFile");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: READ_FILE.name,
		label: READ_FILE.name,
		description: READ_FILE.description,
		parameters: READ_FILE.parameters as unknown as TSchema,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeReadFile(params, signal, ctx),
	});
}

export async function executeReadFile(_params: unknown, _signal: AbortSignal | undefined, _ctx: ExtensionToolContext): Promise<never> {
	throw new Error("ReadFile not implemented yet");
}
