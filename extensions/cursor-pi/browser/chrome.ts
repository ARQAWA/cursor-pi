import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CdpConnection } from "./cdp-client.ts";

export const CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export interface BrowserSettings {
	profileDir: string;
	headless: boolean;
}

// Normal use keeps a visible Chrome with its profile in ~/.cursor-pi/browser. The checks replace both settings.
const settings: BrowserSettings = { profileDir: join(homedir(), ".cursor-pi", "browser"), headless: false };

export function configureBrowser(next: Partial<BrowserSettings>): void {
	Object.assign(settings, next);
}

export interface PageTarget {
	id: string;
	title: string;
	url: string;
	webSocketDebuggerUrl: string;
}

let port: number | undefined;
let pendingPort: Promise<number> | undefined;
const connections = new Map<string, Promise<CdpConnection>>();

async function readActivePort(): Promise<number | undefined> {
	const file = join(settings.profileDir, "DevToolsActivePort");
	if (!existsSync(file)) return undefined;
	const value = Number((await readFile(file, "utf8")).split("\n")[0]?.trim());
	return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function reachable(candidate: number): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${candidate}/json/version`, { signal: AbortSignal.timeout(1000) });
		return response.ok;
	} catch {
		return false;
	}
}

async function launch(): Promise<number> {
	await mkdir(settings.profileDir, { recursive: true });
	const args = ["--remote-debugging-port=0", `--user-data-dir=${settings.profileDir}`, "--no-first-run", "--no-default-browser-check"];
	if (settings.headless) args.push("--headless=new");
	const child = spawn(CHROME_EXECUTABLE, args, { detached: true, stdio: "ignore" });
	child.unref();
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const found = await readActivePort();
		if (found !== undefined && (await reachable(found))) return found;
	}
	throw new Error(`Chrome did not open a DevTools port for the profile ${settings.profileDir}.`);
}

async function resolvePort(): Promise<number> {
	if (port !== undefined && (await reachable(port))) return port;
	const existing = await readActivePort();
	port = existing !== undefined && (await reachable(existing)) ? existing : await launch();
	return port;
}

// The DevTools port of the browser for this profile: the running one, or a new Chrome.
export function browserPort(): Promise<number> {
	pendingPort ??= resolvePort().finally(() => {
		pendingPort = undefined;
	});
	return pendingPort;
}

async function fetchPages(): Promise<PageTarget[]> {
	const response = await fetch(`http://127.0.0.1:${await browserPort()}/json/list`);
	const targets = (await response.json()) as Array<{ id: string; type: string; title: string; url: string; webSocketDebuggerUrl?: string }>;
	return targets
		.filter((target) => target.type === "page" && target.webSocketDebuggerUrl !== undefined)
		.map((target) => ({ id: target.id, title: target.title, url: target.url, webSocketDebuggerUrl: target.webSocketDebuggerUrl as string }));
}

// The page tabs in the order Chrome lists them.
export async function listPages(): Promise<PageTarget[]> {
	return fetchPages();
}

export async function createPage(url: string): Promise<PageTarget> {
	const response = await fetch(`http://127.0.0.1:${await browserPort()}/json/new?${url}`, { method: "PUT" });
	const target = (await response.json()) as { id: string; title: string; url: string; webSocketDebuggerUrl: string };
	return { id: target.id, title: target.title, url: target.url, webSocketDebuggerUrl: target.webSocketDebuggerUrl };
}

export async function closePage(id: string): Promise<void> {
	await fetch(`http://127.0.0.1:${await browserPort()}/json/close/${id}`);
	connections.delete(id);
}

export async function activatePage(id: string): Promise<void> {
	await fetch(`http://127.0.0.1:${await browserPort()}/json/activate/${id}`);
}

function openConnection(page: PageTarget): Promise<CdpConnection> {
	const promise = CdpConnection.connect(page.webSocketDebuggerUrl).then(async (conn) => {
		await conn.send("Page.enable");
		return conn;
	});
	connections.set(page.id, promise);
	promise.catch(() => connections.delete(page.id));
	return promise;
}

// One connection per tab, reopened when the socket has closed.
export function pageConnection(page: PageTarget): Promise<CdpConnection> {
	const existing = connections.get(page.id);
	if (existing === undefined) return openConnection(page);
	return existing.then((conn) => (conn.isOpen ? conn : openConnection(page)), () => openConnection(page));
}

// Asks the browser to close, for the checks to remove their temporary profile.
export async function stopBrowser(): Promise<void> {
	if (port === undefined) return;
	const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
	const conn = await CdpConnection.connect(version.webSocketDebuggerUrl);
	await conn.send("Browser.close").catch(() => undefined);
	conn.close();
	connections.clear();
	port = undefined;
}
