// Result formatting that follows Cursor: the content mapping of local-exec/mcp.js, extractTextFromNonTextContent
// (mcp-agent-exec/cache.js), the error text of renderMcpTool (agent/.../mcp-review-gate.js) and FetchMcpResource's render
// (agent/.../fetch-mcp-resource.js).
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { prepareImageForModel } from "../tools/read-file/image.ts";
import type { McpCallResult, McpContentBlock } from "./types.ts";

type Item = Record<string, unknown>;

export function extractTextFromNonTextContent(item: Item): string {
	const resource = item.resource as Item | undefined;
	if (resource && typeof resource === "object") {
		if (typeof resource.text === "string") return resource.text;
		if (typeof resource.blob === "string") {
			return Buffer.from(resource.blob, "base64").toString("utf8");
		}
		return `Resource: ${resource.uri ?? "unknown"}${resource.name ? ` (${resource.name})` : ""}`;
	}
	if (item.uri) return `Resource: ${item.uri}${item.name ? ` (${item.name})` : ""}`;
	return `Unsupported content type "${item.type}": ${JSON.stringify(item)}`;
}

function describeImageMimeType(mimeType: unknown): string {
	return typeof mimeType === "string" && /^image\/[\w.+-]{1,40}$/.test(mimeType) ? mimeType : "image";
}

async function formatImage(item: Item): Promise<McpContentBlock> {
	const bytes = typeof item.data === "string" ? Buffer.from(item.data, "base64") : Buffer.alloc(0);
	try {
		const prepared = await prepareImageForModel(bytes);
		if (prepared.kind === "image") {
			return { type: "image", data: prepared.image.data.toString("base64"), mimeType: prepared.image.mimeType };
		}
	} catch {
		// Cursor omits an image it cannot resize and says so in its place.
	}
	return {
		type: "text",
		text: `[Image omitted: the tool returned ${describeImageMimeType(item.mimeType)} data (${bytes.byteLength} bytes) that could not be decoded.]`,
	};
}

async function formatContentItem(item: Item): Promise<McpContentBlock> {
	if (item.type === "text") return { type: "text", text: item.text as string };
	if (item.type === "image") return formatImage(item);
	return { type: "text", text: extractTextFromNonTextContent(item) };
}

export function callResult(
	content: McpContentBlock[],
	isError: boolean,
	structuredContent: Record<string, unknown> | undefined,
): McpCallResult {
	const text = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
	return { content, isError, text, structuredContent };
}

// Cursor's renderMcpTool for a tool that failed with an exception rather than a result.
export function errorCallResult(message: string): McpCallResult {
	return callResult([{ type: "text", text: `Error: Tool execution error. ${message}` }], true, undefined);
}

export async function formatCallToolResult(result: CallToolResult): Promise<McpCallResult> {
	const content: McpContentBlock[] = [];
	for (const item of result.content as Item[]) content.push(await formatContentItem(item));
	const structured = result.structuredContent;
	const structuredContent =
		typeof structured === "object" && structured !== null && !Array.isArray(structured)
			? (structured as Record<string, unknown>)
			: undefined;
	return callResult(content, result.isError === true, structuredContent);
}

// FetchMcpResource's success text: "Resource: <name> - <description> (<mime>)", a blank line, then the content.
export function fetchedResourceResult(input: {
	uri: string;
	name: string | undefined;
	description: string | undefined;
	mimeType: string | undefined;
	content: string;
}): McpCallResult {
	const name = input.name || input.uri;
	const description = input.description ? ` - ${input.description}` : "";
	const mimeType = input.mimeType ? ` (${input.mimeType})` : "";
	return callResult([{ type: "text", text: `Resource: ${name}${description}${mimeType}\n\n${input.content}` }], false, undefined);
}

export function fetchErrorResult(message: string): McpCallResult {
	return callResult([{ type: "text", text: `Error reading MCP resource: ${message}` }], true, undefined);
}
