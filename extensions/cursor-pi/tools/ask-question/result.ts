// The text AskQuestion returns to the model. formatAnswers matches Cursor's formatAskQuestionResultAsString for a
// success result; the two reasons below are the rejection texts this tool produces.

export interface AskQuestionAnswer {
	questionId: string;
	selectedOptionIds: string[];
	freeformText: string;
}

// Text for a skipped call: the client sends an empty reason, and Cursor's agent answers with this. No Desktop capture of a skipped AskQuestion exists.
export const SKIPPED_TEXT = "Questions skipped by user";
// Reason for a call the client cannot show to the user.
export const NO_CLIENT_TEXT = "The client could not show this request to the user";

export function formatAnswers(answers: AskQuestionAnswer[]): string {
	const lines = answers.map((answer) => {
		const hasSelected = answer.selectedOptionIds.length > 0;
		const freeform = answer.freeformText.trim();
		const selected = `Selected option(s) ${answer.selectedOptionIds.join(", ")}`;
		if (hasSelected && freeform !== "") return `Question ${answer.questionId}: ${selected}, freeform: ${freeform}`;
		if (freeform !== "") return `Question ${answer.questionId}: ${freeform}`;
		if (hasSelected) return `Question ${answer.questionId}: ${selected}`;
		return `Question ${answer.questionId}: No answer provided`;
	});
	return `User questions responses:\n${lines.join("\n")}`;
}
