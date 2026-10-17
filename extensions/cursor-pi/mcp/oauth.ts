// MCP OAuth as Cursor's mcp-agent-exec runs it: the token file mcp-auth.json, the provider that the SDK drives (state, client
// registration, PKCE verifier, tokens), the loopback callback on localhost:8787 with Cursor's fallback ports, and the browser
// step. Discovery, registration, PKCE and the code exchange are the SDK's auth().
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationFull,
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { McpRemoteServerConfig } from "./config.ts";

// Cursor's constants (constants/dist/mcp.js).
export const MCP_OAUTH_CLIENT_LOGO_URI =
	"https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/uploads/cursorlogomcpv3.svg";
export const MCP_OAUTH_LOOPBACK_CALLBACK_URL = "http://localhost:8787/callback";
const MCP_OAUTH_PORTAL_CALLBACK_URL = "https://www.cursor.com/agents/mcp/oauth/callback";
const MCP_OAUTH_LOOPBACK_FALLBACK_PORTS = [18787, 28787, 31787];
const OAUTH_GRANT_TYPES = ["authorization_code", "refresh_token"];
const OAUTH_RESPONSE_TYPES = ["code"];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

// Cursor's FileBasedTokenStore: one JSON object keyed by server identifier, written with two-space indentation.
interface AuthEntry {
	tokens?: OAuthTokens;
	clientInfo?: OAuthClientInformationMixed;
}
type AuthFile = Record<string, AuthEntry>;

async function readAuthFile(path: string): Promise<AuthFile> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	if (!isRecord(parsed)) return {};
	const entries = Object.entries(parsed);
	// A file holding bare token objects (the older layout) is read as tokens for each server.
	const direct = entries.some(
		([, value]) =>
			isRecord(value) && ("access_token" in value || "refresh_token" in value) && !("tokens" in value) && !("clientInfo" in value),
	);
	if (direct) return Object.fromEntries(entries.map(([key, value]) => [key, { tokens: value as OAuthTokens }]));
	const file: AuthFile = {};
	for (const [key, value] of entries) {
		if (isRecord(value)) {
			file[key] = {
				tokens: value.tokens as OAuthTokens | undefined,
				clientInfo: value.clientInfo as OAuthClientInformationMixed | undefined,
			};
		}
	}
	return file;
}

export class McpTokenStore {
	private file: Promise<AuthFile> | undefined;
	private lock: Promise<void> = Promise.resolve();

	constructor(private readonly path: string) {}

	private load(): Promise<AuthFile> {
		if (this.file === undefined) {
			const file = readAuthFile(this.path);
			this.file = file;
			file.catch(() => {
				if (this.file === file) this.file = undefined;
			});
		}
		return this.file;
	}

	async loadTokens(identifier: string): Promise<OAuthTokens | undefined> {
		return (await this.load())[identifier]?.tokens;
	}

	async loadClientInformation(identifier: string): Promise<OAuthClientInformationMixed | undefined> {
		return (await this.load())[identifier]?.clientInfo;
	}

	saveTokens(identifier: string, tokens: OAuthTokens): Promise<void> {
		return this.update(identifier, (entry) => {
			entry.tokens = tokens;
		});
	}

	saveClientInformation(identifier: string, info: OAuthClientInformationMixed): Promise<void> {
		return this.update(identifier, (entry) => {
			entry.clientInfo = info;
		});
	}

	// Writes are serialized, so two saves never interleave in the file.
	private update(identifier: string, change: (entry: AuthEntry) => void): Promise<void> {
		const run = this.lock.then(async () => {
			const file = await this.load();
			const entry = (file[identifier] ??= {});
			change(entry);
			await mkdir(dirname(this.path), { recursive: true });
			await writeFile(this.path, JSON.stringify(file, null, 2));
		});
		this.lock = run.catch(() => undefined);
		return run;
	}
}

const stores = new Map<string, McpTokenStore>();

// The token file of a state folder (mcp-auth.json next to the approvals).
export function mcpTokenStore(stateDir: string): McpTokenStore {
	const path = join(stateDir, "mcp-auth.json");
	let store = stores.get(path);
	if (store === undefined) {
		store = new McpTokenStore(path);
		stores.set(path, store);
	}
	return store;
}

// Cursor's getCanonicalMcpOAuthRedirectUris: the current redirect (unless it is a loopback one), the hosted portal, the
// loopback default, then a loopback current redirect.
export function canonicalRedirectUris(currentRedirectUri: string): string[] {
	const uris = new Set<string>();
	const loopback = isLoopbackHttpUri(currentRedirectUri);
	if (!loopback) uris.add(currentRedirectUri);
	uris.add(MCP_OAUTH_PORTAL_CALLBACK_URL);
	uris.add(MCP_OAUTH_LOOPBACK_CALLBACK_URL);
	if (loopback) uris.add(currentRedirectUri);
	return [...uris];
}

function isLoopbackHttpUri(uri: string): boolean {
	try {
		const url = new URL(uri);
		return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
	} catch {
		return false;
	}
}

// Cursor's resolvedOAuthClientId: a CLIENT_ID that still holds a ${...} placeholder counts as unset.
function resolvedClientId(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (trimmed && /\$\{[^}]*\}/.test(trimmed)) return undefined;
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// Cursor's buildStaticClientInformation: a configured client ID is used without dynamic registration.
function staticClientInformation(
	authConfig: McpRemoteServerConfig["auth"],
	redirectUrl: string,
): OAuthClientInformationFull | undefined {
	const clientId = resolvedClientId(authConfig?.CLIENT_ID);
	if (clientId === undefined) return undefined;
	return {
		client_id: clientId,
		...(authConfig?.CLIENT_SECRET ? { client_secret: authConfig.CLIENT_SECRET } : {}),
		redirect_uris: canonicalRedirectUris(redirectUrl),
		grant_types: [...OAUTH_GRANT_TYPES],
		response_types: [...OAUTH_RESPONSE_TYPES],
		token_endpoint_auth_method: "none",
	};
}

// Cursor's resolveClientInformation: a stored registration for the same client ID keeps its fields where they are set.
function resolveClientInformation(
	stored: OAuthClientInformationMixed | undefined,
	static_: OAuthClientInformationFull | undefined,
): OAuthClientInformationMixed | undefined {
	if (static_ === undefined) return stored;
	const saved = stored as OAuthClientInformationFull | undefined;
	if (saved !== undefined && saved.client_id === static_.client_id) {
		return {
			...static_,
			...saved,
			client_secret: static_.client_secret ?? saved.client_secret,
			redirect_uris: static_.redirect_uris,
			grant_types: saved.grant_types ?? static_.grant_types,
			response_types: saved.response_types ?? static_.response_types,
			token_endpoint_auth_method: saved.token_endpoint_auth_method ?? static_.token_endpoint_auth_method,
		};
	}
	return static_;
}

// Cursor's encodeMcpOAuthState: the server identifier, the callback owner and the attempt, as base64url JSON.
export function encodeOAuthState(identifier: string, owner: { workspaceId: string }, attemptId: string): string {
	const payload = { id: identifier, owner, ...(attemptId ? { attemptId } : {}) };
	return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export interface OAuthProviderOptions {
	identifier: string;
	redirectUrl: string;
	scopes: string[] | undefined;
	store: McpTokenStore;
	clientInformation: OAuthClientInformationMixed | undefined;
	tokens: OAuthTokens | undefined;
}

// Cursor's InMemoryOAuthClientProvider: the SDK asks it for the redirect, the client metadata, the state and the verifier,
// and it keeps tokens and registration in the token file.
export class McpOAuthProvider implements OAuthClientProvider {
	private attemptId: string | undefined;
	private verifier: string | undefined;
	private lastRedirect: URL | undefined;
	private clientInfo: OAuthClientInformationMixed | undefined;
	private accessTokens: OAuthTokens | undefined;

	constructor(private readonly options: OAuthProviderOptions) {
		this.clientInfo = options.clientInformation;
		this.accessTokens = options.tokens;
	}

	get redirectUrl(): string {
		return this.options.redirectUrl;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			redirect_uris: canonicalRedirectUris(this.options.redirectUrl),
			token_endpoint_auth_method: "none",
			grant_types: [...OAUTH_GRANT_TYPES],
			response_types: [...OAUTH_RESPONSE_TYPES],
			client_name: "Cursor",
			logo_uri: MCP_OAUTH_CLIENT_LOGO_URI,
		};
	}

	state(): string {
		this.attemptId = randomUUID();
		return encodeOAuthState(this.options.identifier, { workspaceId: this.options.redirectUrl }, this.attemptId);
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return this.clientInfo;
	}

	hasClientInformation(): boolean {
		return this.clientInfo !== undefined;
	}

	async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
		this.clientInfo = info;
		await this.options.store.saveClientInformation(this.options.identifier, info);
	}

	tokens(): OAuthTokens | undefined {
		return this.accessTokens;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		this.accessTokens = tokens;
		await this.options.store.saveTokens(this.options.identifier, tokens);
	}

	// Cursor's redirectToAuthorization: the configured scopes replace the requested ones, and Entra's consent prompt is dropped.
	redirectToAuthorization(url: URL): void {
		if (this.options.scopes && this.options.scopes.length > 0) url.searchParams.set("scope", this.options.scopes.join(" "));
		if (url.hostname === "login.microsoftonline.com") stripConsentPrompt(url);
		this.lastRedirect = url;
	}

	get lastRedirectUrl(): URL | undefined {
		return this.lastRedirect;
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		this.verifier = codeVerifier;
	}

	codeVerifier(): string {
		if (!this.verifier) throw new Error("No code verifier saved");
		return this.verifier;
	}

	async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
		if (scope === "tokens" || scope === "all") this.accessTokens = undefined;
		if (scope === "client" || scope === "all") this.clientInfo = undefined;
		if (scope === "verifier" || scope === "all") {
			this.verifier = undefined;
			this.attemptId = undefined;
		}
		if (scope === "all") this.lastRedirect = undefined;
	}
}

// Cursor's stripConsentPrompt: the consent value leaves the prompt parameter; other values stay.
function stripConsentPrompt(url: URL): void {
	const kept = new Set(
		url.searchParams
			.getAll("prompt")
			.flatMap((value) => value.split(" "))
			.filter((value) => value !== "" && value !== "consent"),
	);
	url.searchParams.delete("prompt");
	if (kept.size > 0) url.searchParams.set("prompt", [...kept].join(" "));
}

// Cursor's createInMemoryOAuthClientProvider: the registration and tokens are loaded from the token file.
export async function createOAuthProvider(input: {
	identifier: string;
	config: McpRemoteServerConfig;
	store: McpTokenStore;
	redirectUrl: string;
}): Promise<McpOAuthProvider> {
	const stored = await input.store.loadClientInformation(input.identifier);
	const clientInformation = resolveClientInformation(
		stored,
		staticClientInformation(input.config.auth, input.redirectUrl),
	);
	return new McpOAuthProvider({
		identifier: input.identifier,
		redirectUrl: input.redirectUrl,
		scopes: input.config.auth?.scopes,
		store: input.store,
		clientInformation,
		tokens: await input.store.loadTokens(input.identifier),
	});
}

export interface LoopbackCallback {
	readonly redirectUrl: string;
	// Resolves with the code of the callback whose state matches; rejects when the callback reports an error.
	waitForCode(state: string, signal?: AbortSignal): Promise<string>;
	close(): Promise<void>;
}

interface PendingCallback {
	state: string;
	resolve(code: string): void;
	reject(error: Error): void;
}

function respond(response: ServerResponse, status: number, body: string): void {
	response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
	response.end(body);
}

async function listenOnFirstFree(server: Server, ports: number[]): Promise<number> {
	for (const port of ports) {
		try {
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, "127.0.0.1", () => {
					server.off("error", reject);
					resolve();
				});
			});
			return port;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
		}
	}
	throw new Error("No free port for the MCP OAuth callback");
}

// Listens on Cursor's loopback callback port, or the first fallback port that is free.
export async function startLoopbackCallback(): Promise<LoopbackCallback> {
	const callbackUrl = new URL(MCP_OAUTH_LOOPBACK_CALLBACK_URL);
	const ports = [Number(callbackUrl.port), ...MCP_OAUTH_LOOPBACK_FALLBACK_PORTS];
	let pending: PendingCallback | undefined;
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");
		if (url.pathname !== callbackUrl.pathname) return respond(response, 404, "Not found.");
		const waiter = pending;
		if (waiter === undefined || url.searchParams.get("state") !== waiter.state) {
			return respond(response, 400, "No MCP sign-in is waiting for this callback.");
		}
		pending = undefined;
		const code = url.searchParams.get("code");
		const error = url.searchParams.get("error");
		if (error !== null || code === null) {
			respond(response, 400, "Sign-in failed. You can close this window.");
			waiter.reject(
				new Error(`Authentication callback failed: ${url.searchParams.get("error_description") ?? error ?? "no authorization code"}`),
			);
			return;
		}
		respond(response, 200, "Signed in to the MCP server. You can close this window.");
		waiter.resolve(code);
	});
	const port = await listenOnFirstFree(server, ports);
	return {
		redirectUrl: `http://localhost:${port}${callbackUrl.pathname}`,
		waitForCode(state, signal) {
			return new Promise<string>((resolve, reject) => {
				const onAbort = () => {
					pending = undefined;
					reject(new Error("MCP sign-in was cancelled"));
				};
				const settle = () => signal?.removeEventListener("abort", onAbort);
				signal?.addEventListener("abort", onAbort, { once: true });
				pending = {
					state,
					resolve: (code) => {
						settle();
						resolve(code);
					},
					reject: (error) => {
						settle();
						reject(error);
					},
				};
			});
		},
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

// Pi's openBrowser (utils/open-browser.ts), which the package does not export: the platform launcher, no shell.
export function openBrowser(target: string): void {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [target]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", target]]
				: ["xdg-open", [target]];
	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => undefined)
		.unref();
}

// Cursor's mcp_auth sign-in: the SDK registers the client and builds the authorization URL; the browser returns the code to the
// loopback callback; the SDK exchanges it for tokens, which land in the token file.
export async function authorizeRemoteServer(input: {
	identifier: string;
	config: McpRemoteServerConfig;
	store: McpTokenStore;
	openUrl: (url: string) => void;
	signal?: AbortSignal;
}): Promise<void> {
	const loopback = await startLoopbackCallback();
	try {
		const provider = await createOAuthProvider({
			identifier: input.identifier,
			config: input.config,
			store: input.store,
			redirectUrl: loopback.redirectUrl,
		});
		const serverUrl = input.config.url;
		if ((await auth(provider, { serverUrl })) === "AUTHORIZED") return;
		const redirect = provider.lastRedirectUrl;
		if (redirect === undefined) throw new Error(`MCP server "${input.identifier}" did not return an authorization URL`);
		const code = loopback.waitForCode(redirect.searchParams.get("state") ?? "", input.signal);
		code.catch(() => undefined);
		input.openUrl(redirect.toString());
		const authorizationCode = await code;
		if (!provider.hasClientInformation()) {
			throw new Error(
				"OAuth client registration has not completed. The MCP server may not support dynamic client registration or the registration failed.",
			);
		}
		try {
			await auth(provider, { serverUrl, authorizationCode });
		} catch (error) {
			throw new Error(`Authentication callback failed: ${messageOf(error)}`);
		}
	} finally {
		await loopback.close();
	}
}
