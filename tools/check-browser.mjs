#!/usr/bin/env bun
// End-to-end check of the cursor-ide-browser namespace: a headless Chrome with a temporary profile, a local test page,
// and each browser tool called through the same McpSource functions the dynamic tools use.
// Usage: bun tools/check-browser.mjs
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configureBrowser, stopBrowser } from "../extensions/cursor-pi/browser/chrome.ts";
import { BROWSER_NAMESPACE, callMcpTool, listMcpNamespaces } from "../extensions/cursor-pi/browser/source.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const declared = JSON.parse(await readFile(join(ROOT, "extensions/cursor-pi/tools/generated/browser-tools.json"), "utf8"));

const checks = [];
function report(ok, label, detail = "") {
	checks.push({ ok, label });
	console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `: ${detail}` : ""}`);
}

const PAGE = `<!doctype html><title>Check page</title><h1>Browser check</h1>
<button id="go" onclick="const c=document.getElementById('count');c.textContent=String(Number(c.textContent)+1)">Increment</button>
<p id="count">0</p>
<label for="name">Name</label><input id="name" type="text">
<select id="pick"><option value="a">Alpha</option><option value="b">Beta</option></select>
<a href="#top">Top link</a>
<div style="height:3000px"></div>`;

const tmp = await mkdtemp(join(tmpdir(), "cursor-pi-browser-check-"));
const server = Bun.serve({ port: 0, fetch: () => new Response(PAGE, { headers: { "content-type": "text/html" } }) });
const url = `http://127.0.0.1:${server.port}/`;

const call = (tool, args = {}) => callMcpTool(BROWSER_NAMESPACE, tool, args);
const evaluate = async (expression) => {
	const reply = await call("browser_cdp", { method: "Runtime.evaluate", params: { expression, returnByValue: true } });
	return reply.isError ? undefined : JSON.parse(reply.text).result.value;
};
const refOf = (id) => evaluate(`document.getElementById('${id}')?.getAttribute('data-cursor-ref')`);

try {
	configureBrowser({ profileDir: join(tmp, "profile"), headless: true });

	const listed = (await listMcpNamespaces(tmp)).find((namespace) => namespace.name === BROWSER_NAMESPACE);
	const declaredNames = declared.tools.map((tool) => tool.name);
	report(
		listed?.status === "ready" && JSON.stringify(listed.tools.map((tool) => tool.name)) === JSON.stringify(declaredNames) && listed.instructions === declared.instructions,
		"namespace lists the declared tools and instructions",
		listed ? `${listed.tools.length} tools` : "namespace missing",
	);

	const nav = await call("browser_navigate", { url, newTab: true });
	const viewId = /Browser View ID: (\S+)/.exec(nav.text)?.[1];
	report(!nav.isError && nav.text.includes("### Action: navigate") && viewId !== undefined, "browser_navigate opens the test page", viewId ?? nav.text.slice(0, 160));

	const snap = await call("browser_snapshot");
	report(!snap.isError && /name: Increment/.test(snap.text) && snap.text.includes("Page Title: Check page"), "browser_snapshot lists elements with refs", snap.text.slice(0, 120));
	const goRef = await refOf("go");

	const click = await call("browser_click", { ref: goRef, element: "Increment" });
	const count = await evaluate("document.getElementById('count').textContent");
	report(!click.isError && count === "1", "browser_click increments the counter", String(count));

	const nameRef = await refOf("name");
	const typed = await call("browser_type", { ref: nameRef, text: "Ada", clear: true });
	const typedValue = await evaluate("document.getElementById('name').value");
	report(!typed.isError && typedValue === "Ada" && /Characters typed: 3/.test(typed.text), "browser_type sets the input value", String(typedValue));

	const filled = await call("browser_fill", { ref: nameRef, value: "Grace" });
	const filledValue = await evaluate("document.getElementById('name').value");
	report(!filled.isError && filledValue === "Grace", "browser_fill sets the value", String(filledValue));

	const pickRef = await refOf("pick");
	const picked = await call("browser_select_option", { ref: pickRef, values: ["Beta"] });
	const pickValue = await evaluate("document.getElementById('pick').value");
	report(!picked.isError && pickValue === "b", "browser_select_option selects by label", String(pickValue));

	const badOption = await call("browser_select_option", { ref: pickRef, values: ["Gamma"] });
	report(badOption.isError && badOption.text.includes("Available options"), "browser_select_option names the available options", badOption.text.slice(0, 100));

	await call("browser_fill", { ref: nameRef, value: "Grace" });
	const pressed = await call("browser_press_key", { key: "Tab" });
	const active = await evaluate("document.activeElement.id");
	report(!pressed.isError && active === "pick", "browser_press_key moves focus with Tab", String(active));

	const scrolled = await call("browser_scroll", { direction: "down", amount: 200 });
	report(!scrolled.isError && /Actual scroll: \(/.test(scrolled.text), "browser_scroll reports the scroll it made", scrolled.text.slice(0, 100));

	const box = await call("browser_get_bounding_box", { ref: goRef });
	report(!box.isError && /width=/.test(box.text), "browser_get_bounding_box returns the box", box.text.slice(0, 100));

	const highlight = await call("browser_highlight", { ref: goRef, durationMs: 300 });
	report(!highlight.isError && highlight.text.includes("### Action: highlight"), "browser_highlight marks the element", highlight.text.slice(0, 100));

	const tabList = await call("browser_tabs", { action: "list" });
	report(!tabList.isError && tabList.text.includes(`(viewId: ${viewId})`), "browser_tabs lists the test tab", tabList.text.slice(0, 120));

	const shot = await call("browser_take_screenshot");
	const image = shot.content.find((block) => block.type === "image");
	report(!shot.isError && image?.mimeType === "image/png" && image.data.length > 100, "browser_take_screenshot returns a PNG image block", image ? `${image.data.length} base64 chars` : shot.text);

	await call("browser_tabs", { action: "list" });
	const noShot = await call("browser_mouse_click_xy", { x: 10, y: 10 });
	report(noShot.isError && noShot.text.includes("needs a fresh screenshot"), "browser_mouse_click_xy needs a screenshot taken just before", noShot.text.slice(0, 80));
	await call("browser_take_screenshot");
	const clickXY = await call("browser_mouse_click_xy", { x: 10, y: 10 });
	report(!clickXY.isError && clickXY.text.includes("### Action: mouse_click_xy"), "browser_mouse_click_xy clicks after a screenshot", clickXY.text.slice(0, 80));

	const drag = await call("browser_drag", { sourceRef: goRef, targetX: 200, targetY: 200 });
	report(!drag.isError && drag.text.includes("Drag completed"), "browser_drag completes a drag", drag.text.slice(0, 80));
	const dragMissing = await call("browser_drag", { sourceRef: goRef });
	report(dragMissing.isError && dragMissing.text.includes("Either targetRef or both targetX and targetY"), "browser_drag asks for a target", dragMissing.text.slice(0, 80));

	const cdpDenied = await call("browser_cdp", { method: "Input.dispatchMouseEvent", params: {} });
	report(cdpDenied.isError && cdpDenied.text.includes("denied"), "browser_cdp refuses Input.* methods", cdpDenied.text.slice(0, 80));
	const cdpTitle = await call("browser_cdp", { method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } });
	report(!cdpTitle.isError && cdpTitle.text.includes('"Check page"'), "browser_cdp evaluates a page expression", cdpTitle.text.slice(0, 80));

	const locked = await call("browser_lock", { action: "lock" });
	const unlocked = await call("browser_lock", { action: "unlock" });
	report(locked.text.startsWith("Browser locked.") && unlocked.text.startsWith("Browser unlocked."), "browser_lock locks and unlocks", unlocked.text.slice(0, 40));

	const unknownNamespace = await callMcpTool("nope", "browser_snapshot", {}).then(
		() => false,
		(error) => error.message,
	);
	report(unknownNamespace === 'namespace "nope" not found', "unknown namespace rejects", String(unknownNamespace));
} finally {
	server.stop(true);
	await stopBrowser();
	await rm(tmp, { recursive: true, force: true });
}

const failed = checks.filter((check) => !check.ok).map((check) => check.label);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
	console.log(`failed: ${failed.join("; ")}`);
	process.exitCode = 1;
}
