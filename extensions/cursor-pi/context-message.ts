// Text of the context user message that Cursor Pi places before the first user message of each request.
// The message is built from named parts; the rules section is the only part so far.
export interface ContextMessageParts {
	rules?: string;
}

export function buildContextMessageText(parts: ContextMessageParts): string {
	return parts.rules ?? "";
}
