import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { McpCallResult, McpContentBlock } from "../mcp/types.ts";
import { agentToolsDirFor, projectDirFor } from "../tools/shell/paths.ts";
import { type CdpConnection, evaluateInPage } from "./cdp-client.ts";
import { activatePage, closePage, createPage, listPages, pageConnection, type PageTarget } from "./chrome.ts";
import { isDeniedCdpMethod } from "./denied-cdp.ts";
import { normalizeRef } from "./page/refs.ts";
import { pageCall } from "./page/script.ts";
import { type SnapshotNode, snapshotYaml } from "./page/snapshot.ts";

// Limits Cursor uses for the text it returns.
const SCREENSHOT_TIMEOUT_MS = 5000;
const LARGE_SNAPSHOT_BYTES = 25_600;
const SNAPSHOT_PREVIEW_LINES = 50;
const LARGE_CDP_CHARS = 25_000;
const INLINE_DIFF_BYTES = 20_480;
const NAVIGATION_TIMEOUT_MS = 15_000;

type Args = Record<string, any>;
type Handler = (args: Args) => Promise<McpCallResult>;

interface TabMemory {
	snapshot?: string;
	locked: boolean;
}

interface Tab {
	page: PageTarget;
	conn: CdpConnection;
	memory: TabMemory;
}

interface PageReply {
	success: boolean;
	error?: string;
	suggestion?: string;
}

// An action the page refused. The message and suggestion go to the model as Cursor's error text.
class BrowserError extends Error {
	constructor(
		message: string,
		readonly suggestion?: string,
	) {
		super(message);
	}
}

// Per-tab memory (the snapshot a diff compares with, and the lock flag), keyed by target id.
const memories = new Map<string, TabMemory>();
let lastViewId: string | undefined;
// Set by a viewport screenshot and cleared by every other browser tool call, as Cursor does.
let screenshotCache: { viewId: string; width: number; height: number } | undefined;
let workingDir = process.cwd();

export function setWorkingDir(dir: string): void {
	workingDir = dir;
}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

function text(value: string): McpContentBlock {
	return { type: "text", text: value };
}

function finish(blocks: McpContentBlock[], isError = false): McpCallResult {
	const joined = blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
	return { content: blocks, isError, text: joined, structuredContent: undefined };
}

function fail(message: string): McpCallResult {
	return finish([text(message)], true);
}

// Error text as Cursor shows it: the message, then a suggestion and a recovery action for the known failures.
const SUGGESTIONS: Array<[RegExp, string, string]> = [
	[/Element not found/, "Take a new browser_snapshot and use a ref from it.", "browser_snapshot"],
	[/intercepted|outside the viewport/, "Close the element covering the target, or use a different ref.", "browser_snapshot"],
	[/not a text input|read-only/, "Use a ref for an input, textarea, or contenteditable element.", "browser_snapshot"],
	[/not visible|could not be scrolled/, "Scroll the page toward the element, then take a new snapshot.", "browser_scroll"],
	[/is disabled/, "Pick an element that is enabled.", "browser_snapshot"],
	[/Option ".*" not found/, "Use one of the available option values or labels.", "browser_snapshot"],
];

function formatError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const match = SUGGESTIONS.find(([pattern]) => pattern.test(message));
	const suggestion = (error instanceof BrowserError && error.suggestion) || match?.[1];
	const recovery = match?.[2];
	return [`Error: ${message}`, suggestion ? `Suggestion: ${suggestion}` : undefined, recovery ? `Recovery action: ${recovery}` : undefined]
		.filter((line) => line !== undefined)
		.join("\n");
}

function fromPage<T extends PageReply>(reply: T): T {
	if (!reply.success) throw new BrowserError(reply.error ?? "The page action failed.", reply.suggestion);
	return reply;
}

function requireString(args: Args, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value === "") throw new Error(`${key} is required.`);
	return value;
}

function requireText(args: Args, key: string): string {
	const value = args[key];
	if (typeof value !== "string") throw new Error(`${key} is required.`);
	return value;
}

function requireRef(args: Args): string {
	return normalizeRef(requireString(args, "ref")) as string;
}

async function resolvePage(viewId: string | undefined): Promise<PageTarget> {
	const pages = await listPages();
	const wanted = viewId ?? lastViewId;
	const found = wanted === undefined ? pages[0] : (pages.find((page) => page.id === wanted) ?? (viewId === undefined ? pages[0] : undefined));
	if (found === undefined) {
		throw new Error(viewId === undefined ? "No browser tab available. Please navigate to a page first." : `No browser tab with viewId ${viewId}.`);
	}
	lastViewId = found.id;
	return found;
}

async function tabFor(viewId: unknown): Promise<Tab> {
	const page = await resolvePage(typeof viewId === "string" ? viewId : undefined);
	const conn = await pageConnection(page);
	let memory = memories.get(page.id);
	if (memory === undefined) {
		memory = { locked: false };
		memories.set(page.id, memory);
	}
	return { page, conn, memory };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function writeAgentFile(name: string, content: string): Promise<string> {
	const dir = agentToolsDirFor(projectDirFor(resolve(workingDir)));
	await mkdir(dir, { recursive: true });
	const file = join(dir, name);
	await writeFile(file, content);
	return file;
}

// Snapshot of the page as YAML, and the counts the snapshot header shows.
interface SnapshotOptions {
	interactive?: boolean;
	maxDepth?: number;
}

async function takeSnapshot(tab: Tab, options: SnapshotOptions): Promise<{ yaml: string; totalRefs: number; interactiveRefs: number }> {
	const result = await evaluateInPage<{
		tree: { children: SnapshotNode[] };
		stats: { totalRefs: number; interactiveRefs: number };
	}>(tab.conn, pageCall("buildPageSnapshot", { interactive: options.interactive === true, maxDepth: options.maxDepth ?? 20 }));
	const yaml = result.tree.children.map((child) => snapshotYaml(child, 0)).join("\n");
	tab.memory.snapshot = yaml;
	return { yaml, totalRefs: result.stats.totalRefs, interactiveRefs: result.stats.interactiveRefs };
}

async function pageState(conn: CdpConnection): Promise<{ url: string; title: string }> {
	return evaluateInPage<{ url: string; title: string }>(conn, "({ url: location.href, title: document.title })");
}

// The snapshot block: inline up to the limit, otherwise a file with a 50-line preview.
async function snapshotDisplay(yaml: string): Promise<string[]> {
	const bytes = Buffer.byteLength(yaml, "utf8");
	const lines = yaml.split("\n");
	if (bytes <= LARGE_SNAPSHOT_BYTES) return ["```yaml", yaml, "```"];
	const file = await writeAgentFile(`snapshot-${Date.now()}-${randomUUID().slice(0, 8)}.log`, yaml);
	return [
		"```yaml",
		...lines.slice(0, SNAPSHOT_PREVIEW_LINES),
		"```",
		`Large snapshot (${bytes} bytes, ${lines.length} lines) written to file`,
		`- Snapshot File: [${file}](file://${file})`,
	];
}

// The text every action returns: the action's details, the tab, the page state and a fresh snapshot.
async function actionText(action: string, details: string[], tab: Tab): Promise<string> {
	const snap = await takeSnapshot(tab, {});
	const state = await pageState(tab.conn);
	return [
		`### Action: ${action}`,
		...details,
		`- Browser View ID: ${tab.page.id}`,
		"### Page state",
		`- Page URL: ${state.url}`,
		`- Page Title: ${state.title}`,
		"- Page Snapshot:",
		...(await snapshotDisplay(snap.yaml)),
	].join("\n");
}

// Cursor's diff is a unified diff; this keeps the changed lines with two lines of context.
function lineDiff(before: string, after: string): string | undefined {
	const a = before.split("\n");
	const b = after.split("\n");
	if (a.length * b.length > 4_000_000) return undefined;
	const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--) {
		for (let j = b.length - 1; j >= 0; j--) {
			table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
		}
	}
	const ops: string[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			ops.push(` ${a[i]}`);
			i++;
			j++;
		} else if (table[i + 1][j] >= table[i][j + 1]) {
			ops.push(`-${a[i]}`);
			i++;
		} else {
			ops.push(`+${b[j]}`);
			j++;
		}
	}
	while (i < a.length) ops.push(`-${a[i++]}`);
	while (j < b.length) ops.push(`+${b[j++]}`);
	const changed = ops.map((op) => !op.startsWith(" "));
	return ops.filter((_, k) => changed.slice(Math.max(0, k - 2), k + 3).some(Boolean)).join("\n");
}

// Viewport PNG capture with the 5 s limit. Only viewport captures feed the xy-click cache.
async function captureViewport(tab: Tab, fullPage: boolean, clip?: { x: number; y: number; width: number; height: number; scale: number }) {
	const shot = await withTimeout(
		tab.conn.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage, clip }),
		SCREENSHOT_TIMEOUT_MS,
		"screen shot timed out, please try again",
	);
	const bytes = Buffer.from(shot.data as string, "base64");
	const width = bytes.readUInt32BE(16);
	const height = bytes.readUInt32BE(20);
	if (!fullPage && clip === undefined) screenshotCache = { viewId: tab.page.id, width, height };
	return { data: shot.data as string, width, height };
}

async function screenshotBlock(tab: Tab): Promise<McpContentBlock> {
	const shot = await captureViewport(tab, false);
	return { type: "image", data: shot.data, mimeType: "image/png" };
}

const BUTTON_BITS: Record<string, { name: string; bit: number }> = {
	left: { name: "left", bit: 1 },
	right: { name: "right", bit: 2 },
	middle: { name: "middle", bit: 4 },
};
const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

function modifierName(name: string): string {
	if (name !== "ControlOrMeta") return name;
	return process.platform === "darwin" ? "Meta" : "Control";
}

function modifierMask(names: string[] = []): number {
	return names.reduce((mask, name) => mask | (MODIFIER_BITS[modifierName(name)] ?? 0), 0);
}

interface ClickOptions {
	button?: string;
	modifiers?: string[];
	holdMs?: number;
	clicks: number;
}

// A trusted mouse click: move, press, optional hold, release. Two clicks make a double-click, with clickCount 1 then 2.
async function clickAt(conn: CdpConnection, x: number, y: number, options: ClickOptions): Promise<void> {
	const button = BUTTON_BITS[options.button ?? "left"] ?? BUTTON_BITS.left;
	const modifiers = modifierMask(options.modifiers);
	await conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
	for (let count = 1; count <= options.clicks; count++) {
		await conn.send("Input.dispatchMouseEvent", {
			type: "mousePressed",
			x,
			y,
			button: button.name,
			buttons: button.bit,
			clickCount: count,
			modifiers,
		});
		if (options.holdMs) await sleep(options.holdMs);
		await conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: button.name, clickCount: count, modifiers });
	}
}

const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
	Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
	Tab: { key: "Tab", code: "Tab", keyCode: 9 },
	Escape: { key: "Escape", code: "Escape", keyCode: 27 },
	Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
	Delete: { key: "Delete", code: "Delete", keyCode: 46 },
	Space: { key: " ", code: "Space", keyCode: 32, text: " " },
	ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
	ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
	ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
	ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
	Home: { key: "Home", code: "Home", keyCode: 36 },
	End: { key: "End", code: "End", keyCode: 35 },
	PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
	PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
};

function keyFor(name: string): { key: string; code: string; keyCode: number; text?: string } | undefined {
	const named = NAMED_KEYS[name];
	if (named !== undefined) return named;
	if (name.length !== 1) return undefined;
	const upper = name.toUpperCase();
	const code = /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(name) ? `Digit${name}` : "";
	return { key: name, code, keyCode: upper.charCodeAt(0), text: name };
}

// Presses a key or a combination such as Control+A, and returns the code it sent.
async function pressKey(conn: CdpConnection, combo: string): Promise<string> {
	const parts = combo.split("+");
	const base = parts.pop() ?? "";
	const info = keyFor(base);
	const modifiersValid = parts.every((part) => part in MODIFIER_BITS || part === "ControlOrMeta");
	if (info === undefined || !modifiersValid) throw new Error(`Failed to press key: ${combo}`);
	const modifiers = modifierMask(parts);
	const text = modifiers & (MODIFIER_BITS.Control | MODIFIER_BITS.Meta) ? undefined : info.text;
	const code = info.code || base;
	await conn.send("Input.dispatchKeyEvent", {
		type: text === undefined ? "rawKeyDown" : "keyDown",
		key: info.key,
		code: info.code,
		windowsVirtualKeyCode: info.keyCode,
		modifiers,
		text,
		unmodifiedText: text,
	});
	await conn.send("Input.dispatchKeyEvent", { type: "keyUp", key: info.key, code: info.code, windowsVirtualKeyCode: info.keyCode, modifiers });
	return code;
}

async function navigate(args: Args): Promise<McpCallResult> {
	const url = requireString(args, "url");
	let page: PageTarget;
	if (args.newTab === true || (await listPages()).length === 0) {
		page = await createPage("about:blank");
		lastViewId = page.id;
	} else {
		page = await resolvePage(typeof args.viewId === "string" ? args.viewId : undefined);
	}
	const conn = await pageConnection(page);
	if (args.position === "active") await activatePage(page.id);
	const loaded = conn.waitFor("Page.loadEventFired", NAVIGATION_TIMEOUT_MS).catch(() => undefined);
	const reply = await conn.send("Page.navigate", { url });
	if (reply.errorText) throw new Error(`Navigation failed: ${reply.errorText}`);
	await loaded;
	let memory = memories.get(page.id);
	if (memory === undefined) {
		memory = { locked: false };
		memories.set(page.id, memory);
	}
	const tab: Tab = { page, conn, memory };
	const blocks = [text(await actionText("navigate", [`- Navigated to: ${url}`], tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function snapshot(args: Args): Promise<McpCallResult> {
	const tab = await tabFor(args.viewId);
	const previous = tab.memory.snapshot;
	const options = {
		interactive: args.interactive === true,
		maxDepth: typeof args.maxDepth === "number" ? args.maxDepth : 20,
	};
	const snap = await takeSnapshot(tab, options);
	const details = [`- Total refs: ${snap.totalRefs}`, `- Interactive refs: ${snap.interactiveRefs}`];
	if (options.interactive) details.push("- Filter: interactive only");
	if (args.compact === true) details.push("- Filter: compact mode");
	if (typeof args.selector === "string") details.push(`- Selector: ${args.selector}`);
	if (args.includeDiff === true && previous === undefined) details.push("- Diff: no previous snapshot for this tab");
	const parts = [await actionText("snapshot", details, tab)];
	if (args.includeDiff === true && previous !== undefined) {
		const diff = lineDiff(previous, snap.yaml);
		if (diff === undefined || Buffer.byteLength(diff, "utf8") > INLINE_DIFF_BYTES) {
			parts.push("- Diff: too large to inline, see the snapshot above");
		} else {
			parts.push(`### Snapshot diff\n\`\`\`diff\n${diff}\n\`\`\``);
		}
	}
	const blocks = [text(parts.join("\n"))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function click(args: Args): Promise<McpCallResult> {
	const ref = requireRef(args);
	const tab = await tabFor(args.viewId);
	const target = fromPage(await evaluateInPage<PageReply & { x: number; y: number; scrollAttempts: number }>(tab.conn, pageCall("clickAction", { ref, offsetX: args.offsetX, offsetY: args.offsetY })));
	const doubleClick = args.doubleClick === true;
	const button = typeof args.button === "string" ? args.button : "left";
	const holdMs = typeof args.holdDurationMs === "number" ? args.holdDurationMs : undefined;
	await clickAt(tab.conn, target.x, target.y, { button, modifiers: args.modifiers, holdMs, clicks: doubleClick ? 2 : 1 });
	const details = [`- Click type: ${doubleClick ? "double-click" : "single-click"}`, `- Button: ${button}`, `- Scroll attempts: ${target.scrollAttempts}`];
	if (args.offsetX !== undefined || args.offsetY !== undefined) details.push(`- Position: offset (${args.offsetX ?? 0}, ${args.offsetY ?? 0})`);
	if (holdMs !== undefined) details.push(`- Hold duration: ${holdMs}ms`);
	const blocks = [text(await actionText("click", details, tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function clickXY(args: Args): Promise<McpCallResult> {
	const { x, y } = args;
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return fail("Error: x and y must be finite numbers.\n\nUse coordinates from a fresh viewport screenshot.");
	}
	const tab = await tabFor(args.viewId);
	const cache = screenshotCache;
	if (cache === undefined || cache.viewId !== tab.page.id) {
		return fail("Error: browser_mouse_click_xy needs a fresh screenshot for this tab.\n\nTake a screenshot right before this call. Other browser tool calls clear the cache.");
	}
	// The screenshot is the native PNG; its pixels map back to CSS pixels of the viewport.
	const viewport = await evaluateInPage<{ w: number; h: number }>(tab.conn, "({ w: innerWidth, h: innerHeight })");
	const mappedX = Math.round((x * viewport.w) / cache.width);
	const mappedY = Math.round((y * viewport.h) / cache.height);
	const button = typeof args.button === "string" ? args.button : "left";
	await clickAt(tab.conn, mappedX, mappedY, { button, clicks: 1 });
	const blocks = [text(await actionText("mouse_click_xy", [`- Click position: (${mappedX}, ${mappedY})`, `- Screenshot position: (${x}, ${y})`, `- Button: ${button}`], tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function type(args: Args): Promise<McpCallResult> {
	const ref = requireRef(args);
	const value = requireText(args, "text");
	const tab = await tabFor(args.viewId);
	const slowly = args.slowly === true;
	const prepared = fromPage(
		await evaluateInPage<PageReply & { expected: string; cleared: boolean }>(tab.conn, pageCall("typeAction", { ref, text: value, clear: args.clear === true, slowly })),
	);
	if (slowly) {
		for (const character of value) await tab.conn.send("Input.insertText", { text: character });
	}
	const after = await evaluateInPage<{ value: string }>(tab.conn, pageCall("valueAction", { ref }));
	const details = [`- Characters typed: ${value.length}`, `- Typing mode: ${slowly ? "slow (character-by-character)" : "fast"}`];
	if (prepared.cleared) details.push("- Cleared existing content: yes");
	if (after.value !== prepared.expected) details.push("- WARNING: Value did not change after typing");
	if (args.submit === true) {
		await pressKey(tab.conn, "Enter");
		details.push("- Form submitted: yes (Enter key pressed)");
	}
	const blocks = [text(await actionText("type", details, tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function fill(args: Args): Promise<McpCallResult> {
	const ref = requireRef(args);
	const value = requireText(args, "value");
	const tab = await tabFor(args.viewId);
	fromPage(await evaluateInPage<PageReply>(tab.conn, pageCall("fillAction", { ref, value })));
	const shown = value.length > 50 ? `${value.slice(0, 50)}...` : value;
	const blocks = [text(await actionText("fill", [`- Filled with value: "${shown}"`], tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function selectOption(args: Args): Promise<McpCallResult> {
	const ref = requireRef(args);
	const values = Array.isArray(args.values) ? args.values.filter((item: unknown) => typeof item === "string") : [];
	if (values.length === 0) throw new Error("values is required.");
	const tab = await tabFor(args.viewId);
	const result = fromPage(
		await evaluateInPage<PageReply & { multiple: boolean; selected: Array<{ value: string; label: string; how: string }> }>(
			tab.conn,
			pageCall("selectAction", { ref, values }),
		),
	);
	let details: string[];
	if (result.selected.length === 0) details = ["- Selected values: (none)"];
	else if (result.multiple) details = [`- Selected values: ${result.selected.map((item) => item.value).join(", ")}`];
	else details = [`- Selected: ${result.selected[0].value} (matched by ${result.selected[0].how})`];
	const blocks = [text(await actionText("select_option", details, tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function pressKeyTool(args: Args): Promise<McpCallResult> {
	const key = requireString(args, "key");
	const tab = await tabFor(args.viewId);
	const code = await pressKey(tab.conn, key);
	const blocks = [text(await actionText("press_key", [`- Successfully pressed key: ${key} (code: ${code})`], tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function scroll(args: Args): Promise<McpCallResult> {
	const tab = await tabFor(args.viewId);
	const result = fromPage(
		await evaluateInPage<PageReply & { message: string; actual: { dx: number; dy: number }; boundary: boolean }>(
			tab.conn,
			pageCall("scrollAction", {
				ref: typeof args.ref === "string" ? normalizeRef(args.ref) : undefined,
				direction: args.direction,
				amount: args.amount,
				deltaX: args.deltaX,
				deltaY: args.deltaY,
				scrollIntoView: args.scrollIntoView === true,
			}),
		),
	);
	const details = [`- ${result.message}`, `- Actual scroll: (${result.actual.dx} px, ${result.actual.dy} px)`];
	if (result.boundary) details.push("- Warning: Page may have reached scroll boundary");
	const blocks = [text(await actionText("scroll", details, tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function drag(args: Args): Promise<McpCallResult> {
	const sourceRef = normalizeRef(requireString(args, "sourceRef")) as string;
	const tab = await tabFor(args.viewId);
	const plan = fromPage(
		await evaluateInPage<PageReply & { from: { x: number; y: number }; to: { x: number; y: number }; sourceDescription: string; targetDescription: string }>(
			tab.conn,
			pageCall("dragAction", {
				sourceRef,
				targetRef: typeof args.targetRef === "string" ? normalizeRef(args.targetRef) : undefined,
				targetX: args.targetX,
				targetY: args.targetY,
			}),
		),
	);
	const { from, to } = plan;
	await tab.conn.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
	await tab.conn.send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", buttons: 1, clickCount: 1 });
	const steps = 10;
	for (let step = 1; step <= steps; step++) {
		await tab.conn.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: Math.round(from.x + ((to.x - from.x) * step) / steps),
			y: Math.round(from.y + ((to.y - from.y) * step) / steps),
			button: "left",
			buttons: 1,
		});
	}
	await tab.conn.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0, clickCount: 1 });
	const details = [
		`- Drag completed from ${plan.sourceDescription} to ${plan.targetDescription}`,
		`- Source: (${from.x}, ${from.y})`,
		`- Target: (${to.x}, ${to.y})`,
	];
	const blocks = [text(await actionText("drag", details, tab))];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function boundingBox(args: Args): Promise<McpCallResult> {
	const ref = requireRef(args);
	const tab = await tabFor(args.viewId);
	const result = fromPage(
		await evaluateInPage<PageReply & { box: { x: number; y: number; width: number; height: number } }>(tab.conn, pageCall("boundingBoxAction", { ref })),
	);
	const { x, y, width, height } = result.box;
	return finish([text(await actionText("get_bounding_box", [`- Bounding box: x=${x}, y=${y}, width=${width}, height=${height}`], tab))]);
}

async function highlight(args: Args): Promise<McpCallResult> {
	const ref = requireRef(args);
	const tab = await tabFor(args.viewId);
	const duration = typeof args.durationMs === "number" ? args.durationMs : 2000;
	const result = fromPage(await evaluateInPage<PageReply & { description: string }>(tab.conn, pageCall("highlightAction", { ref, durationMs: duration })));
	return finish([text(await actionText("highlight", [`- Highlighted: ${result.description}`, `- Duration: ${duration}ms`], tab))]);
}

async function tabs(args: Args): Promise<McpCallResult> {
	const action = requireString(args, "action");
	const pages = await listPages();
	if (action === "list") {
		const rows = pages.map((page, index) => `[${index}] "${page.title || "New Tab"}" - ${page.url || "about:blank"} (viewId: ${page.id})`);
		return finish([text(rows.length === 0 ? "Open tabs:\n(none)" : ["Open tabs:", ...rows].join("\n"))]);
	}
	if (action === "new") {
		const page = await createPage("about:blank");
		lastViewId = page.id;
		if (args.position === "active" || args.position === "side") await activatePage(page.id);
		const tab = await tabFor(page.id);
		const created = args.position === "side" ? "Created new tab on the side" : "Created new tab";
		return finish([text(await actionText("new", [created], tab))]);
	}
	if (action === "close") {
		const index = typeof args.index === "number" ? args.index : undefined;
		const target = index === undefined ? await resolvePage(undefined) : pages[index];
		if (target === undefined) throw new Error(`Tab ${index} not found`);
		await closePage(target.id);
		memories.delete(target.id);
		if (lastViewId === target.id) lastViewId = undefined;
		const remaining = await listPages();
		if (remaining.length === 0) return finish([text("Tab closed. No remaining tabs.")]);
		const next = await tabFor(remaining[0].id);
		return finish([text(await actionText("tabs", ["Tab closed."], next))]);
	}
	if (action === "select") {
		if (typeof args.index !== "number") throw new Error("Tab index is required");
		const page = pages[args.index];
		if (page === undefined) throw new Error(`Tab ${args.index} not found`);
		await activatePage(page.id);
		const tab = await tabFor(page.id);
		return finish([text(await actionText("tabs", [`Selected tab ${args.index}`], tab))]);
	}
	throw new Error(`Unknown tab action: ${action}`);
}

async function cdp(args: Args): Promise<McpCallResult> {
	const method = requireString(args, "method");
	if (isDeniedCdpMethod(method)) {
		throw new BrowserError(
			`CDP method ${method} is denied.`,
			method.startsWith("Input.") ? "Use browser_click, browser_type, browser_press_key, browser_scroll, or browser_drag instead." : "Use a page-scoped CDP method or a dedicated browser tool.",
		);
	}
	const tab = await tabFor(args.viewId);
	const params = args.params && typeof args.params === "object" ? args.params : {};
	const response = await tab.conn.send(method, params);
	const pretty = JSON.stringify(response, null, 2);
	let body = pretty;
	if (method === "Profiler.stop" || pretty.length > LARGE_CDP_CHARS) {
		const file = await writeAgentFile(`cdp-response-${method}-${Date.now()}.json`, pretty);
		body =
			method === "Profiler.stop"
				? `Profile saved to a file.\nFile: ${file}`
				: `CDP response exceeded ${LARGE_CDP_CHARS} characters, so it was saved to a file instead of being inlined.\nFile: ${file}`;
	}
	const blocks = [text(body)];
	if (args.take_screenshot_afterwards === true) blocks.push(await screenshotBlock(tab));
	return finish(blocks);
}

async function takeScreenshot(args: Args): Promise<McpCallResult> {
	const tab = await tabFor(args.viewId);
	const fullPage = args.fullPage === true;
	let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
	if (typeof args.ref === "string") {
		if (fullPage) throw new Error("fullPage cannot be used with element screenshots.");
		const box = fromPage(
			await evaluateInPage<PageReply & { box: { x: number; y: number; width: number; height: number } }>(
				tab.conn,
				pageCall("boundingBoxAction", { ref: normalizeRef(args.ref), scroll: true }),
			),
		).box;
		clip = { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 };
	}
	let shot: Awaited<ReturnType<typeof captureViewport>>;
	try {
		shot = await captureViewport(tab, fullPage, clip);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("timed out")) throw error;
		throw new Error(`Screenshot failed: ${message}`);
	}
	return finish([
		text(`Screenshot captured successfully\n- Browser View ID: ${tab.page.id}`),
		{ type: "image", data: shot.data, mimeType: "image/png" },
	]);
}

async function lock(args: Args): Promise<McpCallResult> {
	const action = requireString(args, "action");
	if (action !== "lock" && action !== "unlock") throw new Error("action must be lock or unlock.");
	const tab = await tabFor(args.viewId);
	tab.memory.locked = action === "lock";
	const state = await pageState(tab.conn);
	return finish([
		text(tab.memory.locked ? "Browser locked." : "Browser unlocked."),
		text(`- Browser View ID: ${tab.page.id}\n- Page URL: ${state.url}\n- Page Title: ${state.title}\n- Locked: ${tab.memory.locked ? "yes" : "no"}`),
	]);
}

const HANDLERS: Record<string, Handler> = {
	browser_navigate: navigate,
	browser_snapshot: snapshot,
	browser_click: click,
	browser_mouse_click_xy: clickXY,
	browser_type: type,
	browser_fill: fill,
	browser_select_option: selectOption,
	browser_press_key: pressKeyTool,
	browser_scroll: scroll,
	browser_drag: drag,
	browser_get_bounding_box: boundingBox,
	browser_highlight: highlight,
	browser_tabs: tabs,
	browser_cdp: cdp,
	browser_take_screenshot: takeScreenshot,
	browser_lock: lock,
};

// Runs one browser tool. Errors come back as isError text, the way the MCP path returns them.
export async function callBrowserTool(name: string, args: unknown): Promise<McpCallResult> {
	const handler = HANDLERS[name];
	if (handler === undefined) return fail(`Unknown browser tool: ${name}`);
	if (name !== "browser_take_screenshot" && name !== "browser_mouse_click_xy") screenshotCache = undefined;
	try {
		return await handler((args ?? {}) as Args);
	} catch (error) {
		return fail(formatError(error));
	}
}
