import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { parseAskQuestionArgs, type AskQuestionItem } from "./ask-question/args.ts";
import { type AskQuestionAnswer, formatAnswers, NO_CLIENT_TEXT, SKIPPED_TEXT } from "./ask-question/result.ts";
import { declaration, PASSTHROUGH_PARAMETERS } from "./declarations.ts";

const ASK_QUESTION = declaration("AskQuestion");
// The row that lets the user type an answer; Cursor's form offers it on every question.
const OTHER_LABEL = "Other";
const DONE_LABEL = "Done";
const TYPE_PLACEHOLDER = "Type your answer";

export function register(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_QUESTION.name,
		label: ASK_QUESTION.name,
		description: ASK_QUESTION.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: (_toolCallId, params, signal, _onUpdate, ctx) => executeAskQuestion(params, signal, ctx),
	});
}

type TextResult = { content: { type: "text"; text: string }[]; details: undefined; isError?: true };

function textResult(text: string): TextResult {
	return { content: [{ type: "text", text }], details: undefined };
}

// Asks the questions one after another. Escape on any dialog skips the whole call, which the model sees as a rejection.
export async function executeAskQuestion(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<TextResult> {
	const parsed = parseAskQuestionArgs(params);
	if ("error" in parsed) return { ...textResult(`Error: ${parsed.error}`), isError: true };
	if (!ctx.hasUI) return textResult(NO_CLIENT_TEXT);
	const { title, questions } = parsed.args;
	const answers: AskQuestionAnswer[] = [];
	for (const question of questions) {
		const heading = title === undefined ? question.prompt : `${title}\n\n${question.prompt}`;
		const answer =
			question.allow_multiple === true
				? await askMultiple(ctx, signal, heading, question)
				: await askSingle(ctx, signal, heading, question);
		if (answer === undefined) return textResult(SKIPPED_TEXT);
		answers.push(answer);
	}
	return textResult(formatAnswers(answers));
}

async function askSingle(
	ctx: ExtensionToolContext,
	signal: AbortSignal | undefined,
	heading: string,
	question: AskQuestionItem,
): Promise<AskQuestionAnswer | undefined> {
	const labels = uniqueLabels([...question.options.map((option) => option.label), OTHER_LABEL]);
	const choice = await ctx.ui.select(heading, labels, { signal });
	const index = choice === undefined ? -1 : labels.indexOf(choice);
	if (index < 0) return undefined;
	const option = question.options[index];
	if (option !== undefined) return answerOf(question.id, [option.id], "");
	const text = await ctx.ui.input(heading, TYPE_PLACEHOLDER, { signal });
	return text === undefined ? undefined : answerOf(question.id, [], text);
}

// Shows the options with check marks and a Done row. Each pick toggles an option; Other asks for text.
async function askMultiple(
	ctx: ExtensionToolContext,
	signal: AbortSignal | undefined,
	heading: string,
	question: AskQuestionItem,
): Promise<AskQuestionAnswer | undefined> {
	const chosen = new Set<number>();
	let typedText = "";
	for (;;) {
		const rows = [
			...question.options.map((option, index) => `${checkbox(chosen.has(index))} ${option.label}`),
			typedText === "" ? `${checkbox(false)} ${OTHER_LABEL}` : `${checkbox(true)} ${OTHER_LABEL}: ${typedText}`,
			DONE_LABEL,
		];
		const labels = uniqueLabels(rows);
		const choice = await ctx.ui.select(heading, labels, { signal });
		const index = choice === undefined ? -1 : labels.indexOf(choice);
		if (index < 0) return undefined;
		if (index === rows.length - 1) {
			const ids = question.options.filter((_option, optionIndex) => chosen.has(optionIndex)).map((option) => option.id);
			return answerOf(question.id, ids, typedText);
		}
		if (index === question.options.length) {
			const text = await ctx.ui.input(heading, TYPE_PLACEHOLDER, { signal });
			if (text === undefined) return undefined;
			typedText = text;
		} else if (chosen.has(index)) {
			chosen.delete(index);
		} else {
			chosen.add(index);
		}
	}
}

function answerOf(questionId: string, selectedOptionIds: string[], freeformText: string): AskQuestionAnswer {
	return { questionId, selectedOptionIds, freeformText };
}

function checkbox(checked: boolean): string {
	return checked ? "[x]" : "[ ]";
}

// Select rows are matched by their text, so repeated labels get a number to stay distinct.
function uniqueLabels(labels: string[]): string[] {
	const used = new Set<string>();
	return labels.map((label) => {
		let text = label;
		for (let n = 2; used.has(text); n++) text = `${label} (${n})`;
		used.add(text);
		return text;
	});
}
