import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { capturedConciseInstruction } from "../../dynamic/captured-instructions.ts";
import { registerDynamicTool } from "../../dynamic/registry.ts";
import { writeAgentToolsFile } from "../../mcp/spill.ts";
import { type ArgIssue, checkType, invalidArguments } from "../cursor-args.ts";
import { declaration, PASSTHROUGH_PARAMETERS } from "../declarations.ts";
import { toolText } from "../rg/format.ts";
import { projectDirFor } from "../shell/paths.ts";
import { capturedNamespaceDeclaration } from "./captured.ts";
import type { NamespaceToolResult } from "./todo-write.ts";
import { CHAR_HARD_LIMIT, FILE_WRITE_THRESHOLD_BYTES, describeOutputLocation, truncateContent } from "./web-output.ts";

// Cursor's WebFetch (agent/dist/tools/core/web-fetch/web-fetch.js), for the cursor namespace. The page is fetched from this machine.
const NAMESPACE = "cursor";
const WEB_FETCH = capturedNamespaceDeclaration("WebFetch");
// Limits of this local fetch. Cursor's backend sets its own, and the client does not state them.
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const ACCEPT = "text/html, application/xhtml+xml, text/markdown, text/plain, application/json;q=0.9, */*;q=0.1";
const TEXT_MEDIA_TYPES: Record<string, true> = { "application/json": true, "application/ld+json": true, "application/xml": true, "application/javascript": true };
const HTML_MEDIA_TYPES: Record<string, true> = { "text/html": true, "application/xhtml+xml": true };
// Cursor's texts.
const REJECTED_TEXT = "Web fetch rejected: User rejected the web fetch";
const INVALID_URL_TEXT = "Error: Invalid URL: must include http:// or https://";
const GENERIC_ERROR_TEXT = "Error: An error occurred while fetching the URL";
// Our text for a fetch that ran out of time.
const TIMEOUT_TEXT = `Error: Web fetch timed out after ${FETCH_TIMEOUT_MS / 1000} seconds`;

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });

interface Page {
	media: string | undefined;
	text: string;
}

// A failed fetch; `text` is the model-visible text of the error result.
class FetchFailure extends Error {
	readonly text: string;

	constructor(text: string) {
		super(text);
		this.name = "FetchFailure";
		this.text = text;
	}
}

export function register(): void {
	registerDynamicTool({ namespace: NAMESPACE, declaration: WEB_FETCH, conciseInstructions: capturedConciseInstruction(WEB_FETCH.name), execute: executeWebFetch });
}

// The WebFetch a subagent calls as a tool of its own, as Cursor's cursor-guide child carries it (the parent reaches it through CallDynamicTool).
export function registerDirect(pi: ExtensionAPI): void {
	const direct = declaration("WebFetch");
	pi.registerTool({
		name: direct.name,
		label: direct.name,
		description: direct.description,
		parameters: PASSTHROUGH_PARAMETERS,
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const result = await executeWebFetch(params, signal, ctx);
			return toolText(result.text, result.isError);
		},
	});
}

// Argument errors come from Cursor's zod parse before the tool runs, so they are errors; every fetch outcome is a rendered result.
export async function executeWebFetch(params: unknown, signal: AbortSignal | undefined, ctx: ExtensionToolContext): Promise<NamespaceToolResult> {
	const issues: ArgIssue[] = [];
	if (!checkType(params, "object", [], issues)) return { text: invalidArguments(issues), isError: true };
	const url = (params as Record<string, unknown>).url;
	if (!checkType(url, "string", ["url"], issues)) return { text: invalidArguments(issues), isError: true };
	const target = url as string;
	try {
		const parsed = parseTarget(target);
		if (!shouldSkipApproval(parsed) && !(await approve(ctx, target))) return { text: REJECTED_TEXT, isError: true };
		const page = await fetchPage(target, signal);
		return { text: await renderPage(target, toMarkdown(page), ctx.cwd), isError: false };
	} catch (error) {
		return { text: error instanceof FetchFailure ? error.text : GENERIC_ERROR_TEXT, isError: true };
	}
}

// Cursor's URL checks: the string must parse as an absolute http or https URL.
function parseTarget(target: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw new FetchFailure(INVALID_URL_TEXT);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new FetchFailure(`Error: Invalid URL protocol: ${parsed.protocol} (must be http or https)`);
	}
	return parsed;
}

// Cursor's allowlist: its own docs need no approval.
function shouldSkipApproval(url: URL): boolean {
	return url.hostname === "cursor.com" && (url.pathname === "/docs" || url.pathname === "/docs.md" || url.pathname === "/llms.txt" || url.pathname.startsWith("/docs/"));
}

async function approve(ctx: ExtensionToolContext, target: string): Promise<boolean> {
	return ctx.hasUI ? ctx.ui.confirm("Fetch web page", `Allow fetching ${target}?`) : false;
}

async function fetchPage(target: string, signal: AbortSignal | undefined): Promise<Page> {
	const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(target, { redirect: "follow", headers: { accept: ACCEPT }, signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]) });
		if (response.status !== 200) throw new FetchFailure(`Error: Error fetching URL, status code: ${response.status}`);
		const contentType = response.headers.get("content-type");
		const media = mediaTypeOf(contentType);
		if (media !== undefined && !isTextMedia(media)) throw unsupported(target, media);
		const body = await readCapped(response, target);
		if (media === undefined && body.includes(0)) throw unsupported(target, "unknown");
		return { media, text: decodeText(body, contentType) };
	} catch (error) {
		if (error instanceof FetchFailure) throw error;
		throw new FetchFailure(timeout.aborted && !signal?.aborted ? TIMEOUT_TEXT : GENERIC_ERROR_TEXT);
	}
}

function mediaTypeOf(contentType: string | null): string | undefined {
	if (contentType === null) return undefined;
	const media = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
	return media === "" ? undefined : media;
}

function isTextMedia(media: string): boolean {
	return media.startsWith("text/") || TEXT_MEDIA_TYPES[media] === true || media.endsWith("+json") || media.endsWith("+xml");
}

function unsupported(target: string, media: string): FetchFailure {
	return new FetchFailure(`Error fetching URL ${target}: Unsupported content type: ${media}`);
}

function tooLarge(target: string): FetchFailure {
	return new FetchFailure(`Error fetching URL ${target}: Response is larger than ${MAX_RESPONSE_BYTES} bytes`);
}

// Reads the body, stopping once it passes the size limit; a declared length over the limit is refused before the read.
async function readCapped(response: Response, target: string): Promise<Buffer> {
	const declared = Number(response.headers.get("content-length"));
	if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw tooLarge(target);
	const reader = response.body?.getReader();
	if (reader === undefined) return Buffer.alloc(0);
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw tooLarge(target);
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

// The charset from the content type, UTF-8 when it is absent or unknown.
function decodeText(body: Buffer, contentType: string | null): string {
	const charset = /charset=["']?([^;"'\s]+)/i.exec(contentType ?? "")?.[1] ?? "utf-8";
	try {
		return new TextDecoder(charset).decode(body);
	} catch {
		return new TextDecoder("utf-8").decode(body);
	}
}

function toMarkdown(page: Page): string {
	return page.media !== undefined && HTML_MEDIA_TYPES[page.media] === true ? htmlToMarkdown(page.text) : page.text;
}

// The main article when Readability finds one, otherwise the body; then turndown to markdown, with the article's title as a heading.
function htmlToMarkdown(html: string): string {
	const article = new Readability(parseHTML(html).document).parse();
	const body = article?.content ?? parseHTML(html).document.body?.innerHTML ?? html;
	const markdown = turndown.turndown(body).trim();
	const title = article?.title?.trim() ?? "";
	return title === "" ? markdown : `# ${title}\n\n${markdown}`;
}

// Cursor's result for a page: the content, or a file note when the content is over the threshold and the file is written.
async function renderPage(target: string, markdown: string, cwd: string): Promise<string> {
	if (Buffer.byteLength(markdown, "utf8") > FILE_WRITE_THRESHOLD_BYTES) {
		const location = await writeAgentToolsFile(projectDirFor(resolve(cwd)), markdown);
		if (location !== undefined) return `# Content from ${target}\n\n${describeOutputLocation(location, "Content")}`;
	}
	// Cursor cuts the content once when it takes the page and again when it renders it, so the cut is applied on both steps.
	return renderFetchContent(target, truncateContent(markdown, CHAR_HARD_LIMIT));
}

// Cursor's render of a fetched page: its header, then the markdown cut to the content cap.
export function renderFetchContent(url: string, markdown: string): string {
	return `# Content from ${url}\n\n${truncateContent(markdown, CHAR_HARD_LIMIT)}`;
}
