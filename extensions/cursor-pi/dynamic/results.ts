// Tool results for the dynamic tools. Errors the executors raise themselves carry Cursor's "Error: " prefix; text an
// executor returns with isError is passed through as it is.
export type DynamicContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface DynamicToolReturn {
	content: DynamicContentBlock[];
	details: undefined;
	isError?: true;
}

export function textResult(text: string): DynamicToolReturn {
	return { content: [{ type: "text", text }], details: undefined };
}

export function errorResult(message: string): DynamicToolReturn {
	return { content: [{ type: "text", text: `Error: ${message}` }], details: undefined, isError: true };
}

export function rawErrorResult(text: string): DynamicToolReturn {
	return { content: [{ type: "text", text }], details: undefined, isError: true };
}
