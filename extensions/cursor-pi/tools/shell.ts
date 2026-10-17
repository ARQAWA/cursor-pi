import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { declaration } from "./declarations.ts";
import { renderShellResult, type ShellRenderInput } from "./shell/format.ts";
import { runShell } from "./shell/run.ts";
import { shellSessionFor } from "./shell/session.ts";

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

export async function executeShell(
	params: unknown,
	signal: AbortSignal | undefined,
	ctx: ExtensionToolContext,
): Promise<{ content: { type: "text"; text: string }[]; details: ShellRenderInput }> {
	const details = await runShell(params, signal, shellSessionFor(ctx.cwd));
	return { content: [{ type: "text", text: renderShellResult(details) }], details };
}
