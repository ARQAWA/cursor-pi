import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { writeAgentToolsFile } from "../../mcp/spill.ts";
import { type ArgIssue, checkType, invalidArguments, optionalString } from "../cursor-args.ts";
import { declaration, PASSTHROUGH_PARAMETERS } from "../declarations.ts";
import { toolText } from "../rg/format.ts";
import { projectDirFor } from "../shell/paths.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";
import { CHAR_HARD_LIMIT, describeOutputLocation } from "./web-output.ts";
import { ProviderSearchError, type SearchSource, searchWithProvider } from "./web-search-provider.ts";

// Cursor's WebSearch (agent/dist/tools/core/web-search.js), for the cursor namespace.
const NAMESPACE = "cursor";
const WEB_SEARCH = capturedNamespaceDeclaration("WebSearch");
// Cursor's web-search.js: the largest answer it writes to a file, and the title of the answer's reference.
const WEB_SEARCH_MAX_FILE_SIZE = 5 * 1024 * 1024;
const ANSWER_TITLE = "Web search results";
// Cursor's texts: a provider failure that may pass, and the generic failure.
const TEMPORARY_PROVIDER_ERROR = "The web search provider returned an error; this may be temporary. Please try again.";
const GENERIC_ERROR = "An error occurred while searching the web";

export interface WebSearchReference {
	title: string;
	url: string;
	chunk: string;
}

export function register(): void {
	registerDynamicTool({ namespace: NAMESPACE, declaration: WEB_SEARCH, conciseInstructions: capturedConciseInstruction(WEB_SEARCH.name), execute: executeWebSearch });
}

// The WebSearch a subagent calls as a tool of its own, as Cursor's child tool sets carry it (the parent reaches it through CallDynamicTool).
export function registerDirect(pi: ExtensionAPI): void {
	const direct = declaration("WebSearch");
	pi.registerTool({
		name: direct.name,
		label: direct.name,
		description: direct.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const result = await executeWebSearch(params, signal, ctx);
			return toolText(result.text, result.isError);
		},
	});
}

// Argument errors come from Cursor's zod parse before the tool runs, so they are errors; every search outcome is a rendered result.
export async function executeWebSearch(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { text: invalidArguments(issues), isError: true };
	const args = params as Record<string, unknown>;
	// Cursor's schema also takes query or searchTerm when search_term is absent.
	const searchTerm = args.search_term === undefined ? searchTermAlias(args) : args.search_term;
	checkType(searchTerm, "string", ["search_term"], issues);
	optionalString(args.explanation, ["explanation"], issues);
	if (issues.length > 0) return { text: invalidArguments(issues), isError: true };
	try {
		const answer = await searchWithProvider(ctx, searchTerm as string, signal);
		const text = answer.text === "" ? "" : withSources(answer.text, answer.sources);
		const references: WebSearchReference[] = text === "" ? [] : [{ title: ANSWER_TITLE, url: "", chunk: await capAnswer(text, projectDirFor(resolve(ctx.cwd))) }];
		return { text: renderWebSearchReferences(references), isError: false };
	} catch (error) {
		return { text: `Error: ${searchErrorMessage(error)}`, isError: true };
	}
}

function searchTermAlias(args: Record<string, unknown>): unknown {
	if (typeof args.query === "string") return args.query;
	if (typeof args.searchTerm === "string") return args.searchTerm;
	return undefined;
}

// Cursor's references list: Title, URL when there is one, Content and a rule, each followed by a newline between references.
export function renderWebSearchReferences(references: WebSearchReference[]): string {
	return references.map((ref) => `Title: ${ref.title}${ref.url !== "" ? `\nURL: ${ref.url}` : ""}\nContent: ${ref.chunk}\n---\n`).join("\n");
}

// The provider's citations, listed under the answer; Cursor's backend puts its links in the answer text itself.
function withSources(text: string, sources: SearchSource[]): string {
	if (sources.length === 0) return text;
	return [text, "", "Sources:", ...sources.map((source) => (source.title === "" ? `- ${source.url}` : `- ${source.title} (${source.url})`))].join("\n");
}

// Cursor's capAnswer: an answer over the inline cap goes to an agent-tools file when one can be written, and is otherwise cut
// with a note. With no project directory the answer is only cut.
export async function capAnswer(answer: string, projectDir: string | undefined): Promise<string> {
	if (answer.length <= CHAR_HARD_LIMIT) return answer;
	const location = projectDir === undefined ? undefined : await writeAgentToolsFile(projectDir, answer);
	const inline = answer.slice(0, CHAR_HARD_LIMIT);
	if (location === undefined) return `${inline}\n\n[Answer truncated to ${CHAR_HARD_LIMIT} characters; the full answer was ${answer.length} characters.]`;
	const lead = Buffer.byteLength(answer, "utf8") > WEB_SEARCH_MAX_FILE_SIZE ? `First ${WEB_SEARCH_MAX_FILE_SIZE} bytes of the answer` : "Full answer";
	return `${inline}\n\n${describeOutputLocation(location, lead)}`;
}

// Cursor's serializeError: a provider failure with status 429 or 5xx reads as temporary; every other failure is generic.
function searchErrorMessage(error: unknown): string {
	if (error instanceof ProviderSearchError && error.status !== undefined && (error.status === 429 || error.status >= 500)) return TEMPORARY_PROVIDER_ERROR;
	return GENERIC_ERROR;
}
