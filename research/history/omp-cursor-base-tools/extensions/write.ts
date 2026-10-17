import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { type Component, Text } from "@oh-my-pi/pi-tui";
import { type ToolRenderer, toolRenderers } from "@oh-my-pi/pi-tui/tools";

const DESCRIPTION =
	"Message transport for agent:// recipients only: path is agent://<id> or agent://all, and content is the message. " +
	"File creation and editing do not use this tool.";

// The only accepted recipients: an agent id, or all.
const RECIPIENT = /^agent:\/\/[\w-]+$/;

/** The first line of the first text block of a tool result. */
function firstTextLine(result: unknown): string {
	const content =
		typeof result === "object" && result !== null && "content" in result && Array.isArray(result.content)
			? result.content
			: [];
	for (const block of content) {
		if (typeof block === "object" && block !== null && "text" in block && typeof block.text === "string") {
			return block.text.split("\n")[0] ?? "";
		}
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	const z = pi.zod;

	pi.registerTool({
		name: "write",
		label: "write",
		loadMode: "essential",
		concurrency: "shared",
		approval: "write",
		description: DESCRIPTION,
		parameters: z.object({
			path: z.string(),
			content: z.string(),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (!ctx.invokeTool) {
				return {
					content: [{ type: "text" as const, text: "write is not available to this agent." }],
					isError: true,
				};
			}
			if (!RECIPIENT.test(params.path)) {
				return {
					content: [
						{
							type: "text" as const,
							text: `write sends messages only to agent://<id> or agent://all; refused: ${params.path}`,
						},
					],
					isError: true,
				};
			}
			return ctx.invokeTool!({ path: params.path, content: params.content }, { signal, onUpdate });
		},
		renderCall: (...args: Parameters<ToolRenderer["renderCall"]>): Component => {
			const host = toolRenderers["write"];
			return host ? (host.renderCall(...args) as Component) : new Text("write", 0, 0);
		},
		renderResult: (...args: Parameters<ToolRenderer["renderResult"]>): Component => {
			const host = toolRenderers["write"];
			return host ? (host.renderResult(...args) as Component) : new Text(firstTextLine(args[0]), 0, 0);
		},
	});
}
