// Cursor's zod parse of UpdateCurrentStep arguments, in the variant the captured declaration shows (current_step,
// final_summary and completed_subtitle; at least one of them required). Returns the text Cursor renders for bad
// arguments, or undefined when they pass.

const FIELDS = ["current_step", "final_summary", "completed_subtitle"] as const;

// zod's name for a JSON value's type, as in "Expected string, received number".
function receivedType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value;
}

export function currentStepArgsError(input: unknown): string | undefined {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		const message = input === undefined ? "Required" : `Expected object, received ${receivedType(input)}`;
		return `Invalid arguments:\nargument: ${message}`;
	}
	const fields = input as Record<string, unknown>;
	// A present field must be a string. zod skips the at-least-one rule when a field has the wrong type.
	const typeIssues = FIELDS.filter((field) => fields[field] !== undefined && typeof fields[field] !== "string").map(
		(field) => `${field}: Expected string, received ${receivedType(fields[field])}`,
	);
	if (typeIssues.length > 0) return `Invalid arguments:\n${typeIssues.join("\n")}`;
	const hasText = FIELDS.some((field) => typeof fields[field] === "string" && (fields[field] as string).trim() !== "");
	if (!hasText) return `Invalid arguments:\nargument: At least one of ${FIELDS.join(", ")} must be provided.`;
	return undefined;
}
