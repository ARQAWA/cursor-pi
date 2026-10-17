import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";
import { parseShellArgs } from "./shell/args.ts";
import { renderShellResult, type ShellRenderInput } from "./shell/format.ts";
import { runShell } from "./shell/run.ts";
import { shellSessionFor } from "./shell/session.ts";

const SHELL = declaration("Shell");

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: SHELL.name,
		label: SHELL.name,
		description: SHELL.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (toolCallId, params, signal, _onUpdate, ctx) => executeShell(params, signal, ctx, toolCallId),
	});
}

export async function executeShell(
	params: unknown,
	signal: AbortSignal | undefined,
	ctx: ExtensionToolContext,
	toolCallId?: string,
): Promise<{ content: { type: "text"; text: string }[]; details: ShellRenderInput; isError?: true }> {
	const parsed = parseShellArgs(params);
	if ("error" in parsed) {
		// Cursor reports an argument failure as a spawn error without a command, and the call is an error result.
		const failure: ShellRenderInput = { result: { case: "spawnError", value: { command: "", error: parsed.error } }, isBackground: false, terminalsFolder: "" };
		return { content: [{ type: "text", text: renderShellResult(failure) }], details: failure, isError: true };
	}
	const details = await runShell(parsed.args, signal, shellSessionFor(ctx.cwd), toolCallId);
	return { content: [{ type: "text", text: renderShellResult(details) }], details };
}
