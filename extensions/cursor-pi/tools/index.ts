import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { register as registerApplyPatch } from "./apply-patch.ts";
import { register as registerAskQuestion } from "./ask-question.ts";
import { register as registerCallDynamicTool } from "./call-dynamic-tool.ts";
import { declaration, MAIN_TOOL_ORDER } from "./declarations.ts";
import { register as registerGetDynamicTools } from "./get-dynamic-tools.ts";
import { register as registerGlob } from "./glob.ts";
import { register as registerReadFile } from "./read-file.ts";
import { register as registerRg } from "./rg.ts";
import { register as registerShell } from "./shell.ts";
import { register as registerUpdateCurrentStep } from "./update-current-step.ts";

const REGISTER_MAIN: Record<(typeof MAIN_TOOL_ORDER)[number], (pi: ExtensionAPI) => void> = {
	Shell: registerShell,
	Glob: registerGlob,
	rg: registerRg,
	ReadFile: registerReadFile,
	ApplyPatch: registerApplyPatch,
	AskQuestion: registerAskQuestion,
	GetDynamicTools: registerGetDynamicTools,
	CallDynamicTool: registerCallDynamicTool,
};

// Registers the eight main tools in Cursor's order; they are active on registration. UpdateCurrentStep is registered inactive.
export function registerAllTools(pi: ExtensionAPI): void {
	for (const name of MAIN_TOOL_ORDER) REGISTER_MAIN[name](pi);
	registerUpdateCurrentStep(pi);
}

// Pi serializes Responses tools its own way (strict null, grammar keys in another order). The request carries Cursor's
// captured entry for each active tool instead, in active order.
export function registerCapturedToolPayload(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		const api = ctx.model?.api;
		if (api !== "openai-codex-responses" && api !== "openai-responses") return undefined;
		const payload = event.payload as { tools?: { name: string }[] };
		if (!Array.isArray(payload.tools)) return undefined;
		return { ...payload, tools: payload.tools.map((tool) => declaration(tool.name)) };
	});
}
