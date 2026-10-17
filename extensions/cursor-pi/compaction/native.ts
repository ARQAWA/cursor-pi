import { convertToLlm, type ExtensionAPI, type ExtensionContext, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import { promptForModel } from "../prompts.ts";
import { rewriteProviderPayload, stripInlineToolsBeta } from "../tools/index.ts";
import type { AgentMessage } from "./entries.ts";

export type LlmMessage = ReturnType<typeof convertToLlm>[number];
type NativeReply = Awaited<ReturnType<ReturnType<ModelRegistry["streamSimple"]>["result"]>>;

// A request that Cursor Pi sends itself, outside the agent loop. It is the session's next request with a compaction's parts
// added: the same prompt, tools and payload rewrite, and the compaction's own payload and headers.
export interface NativeRequest {
	messages: AgentMessage[];
	signal: AbortSignal | undefined;
	headers: Record<string, string>;
	transformLlm?: (messages: LlmMessage[]) => LlmMessage[];
	onPayload: (payload: unknown) => unknown;
	onProviderStreamEvent?: (data: unknown) => void;
}

// Streams the request through Pi's provider path, with the same rewrite that every agent request gets before the request's own.
export async function callNative(pi: ExtensionAPI, ctx: ExtensionContext, request: NativeRequest): Promise<NativeReply> {
	const model = ctx.model;
	const prompt = model === undefined ? undefined : promptForModel(model.id);
	if (model === undefined || prompt === undefined) throw new Error("no model with a Cursor Pi prompt is selected");
	// Pi's system messages hold Pi's own prompt sections. The request's system prompt is Cursor's, so they stay out.
	const llm = convertToLlm(request.messages.filter((message) => message.role !== "system"));
	const active = new Set(pi.getActiveTools());
	const tools = pi
		.getAllTools()
		.filter((tool) => active.has(tool.name))
		.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
	const thinking = ctx.thinkingLevel;
	const stream = ctx.modelRegistry.streamSimple(
		model,
		{ systemPrompt: prompt.text, messages: request.transformLlm ? request.transformLlm(llm) : llm, tools },
		{
			sessionId: ctx.sessionManager.getSessionId(),
			reasoning: thinking === undefined || thinking === "off" ? undefined : thinking,
			transport: pi.getSettings().transport,
			signal: request.signal,
			onPayload: (payload) => request.onPayload(rewriteProviderPayload(model.api, payload)),
			onProviderStreamEvent: (data) => request.onProviderStreamEvent?.(data),
			transformHeaders: (headers) => {
				stripInlineToolsBeta(headers);
				return { ...headers, ...request.headers };
			},
		},
	);
	const message = await stream.result();
	if (message.stopReason === "error" || message.stopReason === "aborted") {
		throw new Error(message.errorMessage ?? `the compaction request ${message.stopReason}`);
	}
	return message;
}
