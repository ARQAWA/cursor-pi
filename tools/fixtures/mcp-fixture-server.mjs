#!/usr/bin/env bun
// Fixture MCP server for tools/check-mcp.mjs, built on the pinned @modelcontextprotocol/sdk.
// Usage: bun tools/fixtures/mcp-fixture-server.mjs [--http <port>]. Without a flag it serves stdio; with it, streamable HTTP
// on /mcp and SSE on /sse (messages posted to /messages).
// Tools: echo (text), get-image (image), get-audio (no Cursor formatter, so Unsupported content type), get-embedded-resource,
// get-blob-resource and get-resource-link (resource contents), fail (isError result), throw (tool exception), structured.
// Resources: fixture://doc/readme (text) and fixture://doc/blob (binary). Server instructions are set on the server.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export const INSTRUCTIONS = "Fixture server instructions: call echo to check that instructions reach Cursor Pi.";
export const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export const BLOB_TEXT = "binary-bytes";
export const README_TEXT = "Fixture readme text.";

export function createFixtureServer() {
	const server = new McpServer({ name: "fixture", version: "1.0.0" }, { instructions: INSTRUCTIONS });
	server.registerTool("echo", { description: "Echoes the message back as text.", inputSchema: { message: z.string() } }, async ({ message }) => ({
		content: [{ type: "text", text: `Echo: ${message}` }],
	}));
	server.registerTool("get-image", { description: "Returns a 1x1 PNG." }, async () => ({
		content: [{ type: "image", data: PNG_1X1, mimeType: "image/png" }],
	}));
	server.registerTool("get-audio", { description: "Returns audio content." }, async () => ({
		content: [{ type: "audio", data: "UklGRg==", mimeType: "audio/wav" }],
	}));
	server.registerTool("get-embedded-resource", { description: "Returns an embedded text resource." }, async () => ({
		content: [{ type: "resource", resource: { uri: "fixture://doc/readme", mimeType: "text/plain", text: "Embedded text." } }],
	}));
	server.registerTool("get-blob-resource", { description: "Returns an embedded binary resource." }, async () => ({
		content: [{ type: "resource", resource: { uri: "fixture://doc/blob", mimeType: "application/octet-stream", blob: Buffer.from(BLOB_TEXT).toString("base64") } }],
	}));
	server.registerTool("get-resource-link", { description: "Returns a resource link." }, async () => ({
		content: [{ type: "resource_link", uri: "fixture://doc/readme", name: "readme", description: "Readme", mimeType: "text/plain" }],
	}));
	server.registerTool("fail", { description: "Returns an error result." }, async () => ({
		content: [{ type: "text", text: "Fixture failure on purpose." }],
		isError: true,
	}));
	server.registerTool("throw", { description: "Throws an exception." }, async () => {
		throw new Error("Fixture exception on purpose.");
	});
	server.registerTool("structured", { description: "Returns structured content.", outputSchema: { total: z.number() } }, async () => ({
		content: [{ type: "text", text: "Total: 3" }],
		structuredContent: { total: 3 },
	}));
	server.registerResource("readme", "fixture://doc/readme", { description: "Fixture readme.", mimeType: "text/plain" }, async (uri) => ({
		contents: [{ uri: uri.href, mimeType: "text/plain", text: README_TEXT }],
	}));
	server.registerResource("blob", "fixture://doc/blob", { description: "Fixture blob.", mimeType: "application/octet-stream" }, async (uri) => ({
		contents: [{ uri: uri.href, mimeType: "application/octet-stream", blob: Buffer.from(BLOB_TEXT).toString("base64") }],
	}));
	server.registerResource("big", "fixture://doc/big", { description: "Fixture large text.", mimeType: "text/plain" }, async (uri) => ({
		contents: [{ uri: uri.href, mimeType: "text/plain", text: "x".repeat(50_000) }],
	}));
	return server;
}

async function readBody(req) {
	let text = "";
	for await (const chunk of req) text += chunk;
	return text ? JSON.parse(text) : undefined;
}

function startHttp(port) {
	const sessions = new Map();
	const httpServer = createServer(async (req, res) => {
		const url = new URL(req.url, "http://127.0.0.1");
		if (url.pathname === "/mcp" && req.method === "POST") {
			const body = await readBody(req);
			const server = createFixtureServer();
			const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
			res.on("close", () => {
				transport.close();
				server.close();
			});
			await server.connect(transport);
			await transport.handleRequest(req, res, body);
		} else if (url.pathname === "/sse" && req.method === "GET") {
			const transport = new SSEServerTransport("/messages", res);
			sessions.set(transport.sessionId, transport);
			res.on("close", () => sessions.delete(transport.sessionId));
			await createFixtureServer().connect(transport);
		} else if (url.pathname === "/messages" && req.method === "POST") {
			const transport = sessions.get(url.searchParams.get("sessionId"));
			if (!transport) {
				res.writeHead(404).end();
				return;
			}
			await transport.handlePostMessage(req, res, await readBody(req));
		} else {
			res.writeHead(404).end();
		}
	});
	httpServer.listen(port, "127.0.0.1", () => {
		process.stderr.write(`mcp fixture listening on http://127.0.0.1:${port}\n`);
	});
}

if (import.meta.main) {
	const flag = process.argv.indexOf("--http");
	if (flag === -1) {
		await createFixtureServer().connect(new StdioServerTransport());
	} else {
		startHttp(Number(process.argv[flag + 1]));
	}
}

