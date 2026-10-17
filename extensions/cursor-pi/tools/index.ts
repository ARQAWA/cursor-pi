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
// Cursor changes no tool mid-conversation and sends no deferred tool, so Anthropic requests drop Pi's reserved placeholder
// and the inline-tools beta that enables native tool changes.
const PI_PLACEHOLDER = "__pi_deferred_placeholder__";
const INLINE_TOOLS_BETA = "inline-tools-2026-09-15";

interface AnthropicTool {
	name: string;
	defer_loading?: boolean;
	input_schema?: unknown;
}

interface AnthropicBody {
	betas?: string[];
	messages?: { content?: string | { type: string }[] }[];
	tools?: AnthropicTool[];
}

// Anthropic receives each tool's captured parameters as its input_schema, byte for byte. ApplyPatch has no captured parameters
// and keeps the grammar carrier that Pi registered for it.
function withCapturedInputSchema(tool: AnthropicTool): AnthropicTool {
	const { parameters } = declaration(tool.name);
	return parameters === undefined ? tool : { ...tool, input_schema: parameters };
}

// Throws when a deferred tool or a tool change would reach the wire, because Cursor Pi sends neither.
function withoutNativeToolChanges(payload: AnthropicBody): AnthropicBody {
	const next: AnthropicBody = { ...payload };
	if (Array.isArray(payload.tools)) {
		next.tools = payload.tools.filter((tool) => tool.name !== PI_PLACEHOLDER).map(withCapturedInputSchema);
		if (next.tools.some((tool) => tool.defer_loading === true)) {
			throw new Error("Anthropic request declares a deferred tool; Cursor Pi sends none");
		}
	}
	for (const message of payload.messages ?? []) {
		if (typeof message.content === "string") continue;
		if (message.content?.some((block) => block.type === "tool_addition" || block.type === "tool_removal")) {
			throw new Error("Anthropic request carries a tool_addition or tool_removal block; the tool set changed mid-conversation");
		}
	}
	if (payload.betas !== undefined) {
		const betas = payload.betas.filter((beta) => beta !== INLINE_TOOLS_BETA);
		if (betas.length > 0) next.betas = betas;
		else delete next.betas;
	}
	return next;
}

// The Responses input items Pi sends, with only the fields that the captured-shape rewrite reads.
interface ResponsesInputItem {
	type?: string;
	role?: string;
	output?: unknown;
}

interface ResponsesPayload {
	input?: ResponsesInputItem[];
	tools?: { name: string }[];
}

// Cursor's requests carry a tool output as a list of input_text parts, and their messages carry type "message". Pi sends a
// text-only output as a plain string and leaves the type off messages, so both are rewritten to Cursor's form here.
function withCapturedInputShapes(payload: ResponsesPayload): ResponsesPayload {
	if (!Array.isArray(payload.input)) return payload;
	return { ...payload, input: payload.input.map(capturedInputItem) };
}

function capturedInputItem(item: ResponsesInputItem): ResponsesInputItem {
	if ((item.type === "function_call_output" || item.type === "custom_tool_call_output") && typeof item.output === "string") {
		return { ...item, output: [{ text: item.output, type: "input_text" }] };
	}
	if (item.type === undefined && typeof item.role === "string") return { type: "message", ...item };
	return item;
}

export function registerCapturedToolPayload(pi: ExtensionAPI): void {
	// Removes the inline-tools token from an anthropic-beta header; a header left empty is deleted.
	pi.on("before_provider_headers", (event) => {
		for (const name of Object.keys(event.headers)) {
			const value = event.headers[name];
			if (name.toLowerCase() !== "anthropic-beta" || typeof value !== "string" || !value.includes(INLINE_TOOLS_BETA)) continue;
			const betas = value
				.split(",")
				.map((beta) => beta.trim())
				.filter((beta) => beta.length > 0 && beta !== INLINE_TOOLS_BETA);
			event.headers[name] = betas.length > 0 ? betas.join(",") : null;
		}
	});
	pi.on("before_provider_request", (event, ctx) => {
		const api = ctx.model?.api;
		if (api === "anthropic-messages") return withoutNativeToolChanges(event.payload as AnthropicBody);
		if (api !== "openai-codex-responses" && api !== "openai-responses") return undefined;
		const payload = event.payload as ResponsesPayload;
		const shaped = withCapturedInputShapes(payload);
		if (!Array.isArray(payload.tools)) return shaped === payload ? undefined : shaped;
		return { ...shaped, tools: payload.tools.map((tool) => declaration(tool.name)) };
	});
}
