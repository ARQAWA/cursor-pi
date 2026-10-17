// An MCP server behind OAuth, for tools/check-mcp.mjs: protected-resource and authorization-server metadata, dynamic client
// registration, the authorization-code grant with PKCE (S256), refresh tokens, and a /mcp endpoint that wants a bearer token.
// /authorize signs the user in at once and redirects back with a code. Loopback redirects may use any port (RFC 8252 7.3).
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createFixtureServer } from "./mcp-fixture-server.mjs";

const clients = new Map();
const codes = new Map();
const accessTokens = new Set();
const refreshTokens = new Map();

function s256(verifier) {
	return createHash("sha256").update(verifier).digest("base64url");
}

function json(res, status, body, headers = {}) {
	res.writeHead(status, { "Content-Type": "application/json", ...headers });
	res.end(JSON.stringify(body));
}

function readBody(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

const LOOPBACK = new Set(["localhost", "127.0.0.1"]);

function redirectAllowed(registered, uri) {
	if (registered.includes(uri)) return true;
	try {
		const wanted = new URL(uri);
		if (wanted.protocol !== "http:" || !LOOPBACK.has(wanted.hostname)) return false;
		return registered.some((entry) => {
			const known = new URL(entry);
			return known.protocol === "http:" && LOOPBACK.has(known.hostname) && known.pathname === wanted.pathname;
		});
	} catch {
		return false;
	}
}

function issueTokens(res, clientId) {
	const accessToken = randomUUID();
	const refreshToken = randomUUID();
	accessTokens.add(accessToken);
	refreshTokens.set(refreshToken, clientId);
	return json(res, 200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken });
}

async function route(req, res, origin) {
	const url = new URL(req.url ?? "/", origin);
	const path = url.pathname;
	if (path.startsWith("/.well-known/oauth-protected-resource")) {
		return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"] });
	}
	if (path === "/.well-known/oauth-authorization-server") {
		return json(res, 200, {
			issuer: origin,
			authorization_endpoint: `${origin}/authorize`,
			token_endpoint: `${origin}/token`,
			registration_endpoint: `${origin}/register`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
		});
	}
	if (path === "/register" && req.method === "POST") {
		const body = JSON.parse(await readBody(req));
		const clientId = randomUUID();
		clients.set(clientId, body.redirect_uris ?? []);
		return json(res, 201, {
			...body,
			client_id: clientId,
			client_id_issued_at: Math.floor(Date.now() / 1000),
			token_endpoint_auth_method: "none",
		});
	}
	if (path === "/authorize") {
		const params = url.searchParams;
		const registered = clients.get(params.get("client_id") ?? "");
		const redirectUri = params.get("redirect_uri") ?? "";
		if (
			registered === undefined ||
			!redirectAllowed(registered, redirectUri) ||
			params.get("response_type") !== "code" ||
			params.get("code_challenge_method") !== "S256" ||
			!params.get("code_challenge")
		) {
			return json(res, 400, { error: "invalid_request" });
		}
		const code = randomUUID();
		codes.set(code, { clientId: params.get("client_id"), challenge: params.get("code_challenge") });
		const target = new URL(redirectUri);
		target.searchParams.set("code", code);
		if (params.get("state")) target.searchParams.set("state", params.get("state"));
		res.writeHead(302, { Location: target.toString() });
		res.end();
		return;
	}
	if (path === "/token" && req.method === "POST") {
		const form = new URLSearchParams(await readBody(req));
		if (form.get("grant_type") === "authorization_code") {
			const code = form.get("code") ?? "";
			const grant = codes.get(code);
			codes.delete(code);
			if (grant === undefined || s256(form.get("code_verifier") ?? "") !== grant.challenge) {
				return json(res, 400, { error: "invalid_grant" });
			}
			return issueTokens(res, grant.clientId);
		}
		if (form.get("grant_type") === "refresh_token") {
			const clientId = refreshTokens.get(form.get("refresh_token") ?? "");
			if (clientId === undefined) return json(res, 400, { error: "invalid_grant" });
			return issueTokens(res, clientId);
		}
		return json(res, 400, { error: "unsupported_grant_type" });
	}
	if (path === "/mcp") {
		const header = req.headers.authorization ?? "";
		const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
		if (!accessTokens.has(token)) {
			return json(res, 401, { error: "unauthorized" }, {
				"WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
			});
		}
		const body = req.method === "POST" ? JSON.parse(await readBody(req)) : undefined;
		const mcp = createFixtureServer();
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on("close", () => {
			transport.close();
			mcp.close();
		});
		await mcp.connect(transport);
		await transport.handleRequest(req, res, body);
		return;
	}
	return json(res, 404, { error: "not_found" });
}

// Starts the server on 127.0.0.1:<port>; resolves with the MCP endpoint URL and a close function.
export async function startOAuthFixture(port) {
	const origin = `http://127.0.0.1:${port}`;
	const server = createServer((req, res) => {
		route(req, res, origin).catch((error) => {
			if (!res.headersSent) json(res, 500, { error: String(error) });
		});
	});
	await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
	return {
		url: `${origin}/mcp`,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
