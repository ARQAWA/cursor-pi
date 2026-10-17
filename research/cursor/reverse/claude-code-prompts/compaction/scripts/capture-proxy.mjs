#!/usr/bin/env node
// Capture proxy for Claude Code: records every POST to api.anthropic.com /v1/messages*
// that a Claude Code process sends through HTTPS_PROXY, and forwards it unchanged upstream.
//
// Usage: node capture-proxy.mjs <outDir> <key.pem> <cert.pem> [port]
//
// - CONNECT api.anthropic.com:443 is terminated with the given self-signed certificate
//   (the client must run with NODE_TLS_REJECT_UNAUTHORIZED=0 or NODE_EXTRA_CA_CERTS=<cert.pem>).
// - Every other CONNECT target is tunnelled as raw TCP and not inspected.
// - Request bodies are saved as sent (after content-decoding), request headers are saved with
//   authorization / x-api-key / cookie values replaced by "<REDACTED>". Responses are only logged
//   by status and size; their bodies are not saved.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import zlib from "node:zlib";

const [outDir, keyPath, certPath, portArg] = process.argv.slice(2);
if (!outDir || !keyPath || !certPath) {
	console.error("Usage: node capture-proxy.mjs <outDir> <key.pem> <cert.pem> [port]");
	process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const key = fs.readFileSync(keyPath);
const cert = fs.readFileSync(certPath);
const MITM_HOST = "api.anthropic.com";
const SECRET_HEADERS = new Set(["authorization", "x-api-key", "proxy-authorization", "cookie", "set-cookie"]);
let counter = 0;

function decodeBody(headers, body) {
	const enc = String(headers["content-encoding"] ?? "").toLowerCase().trim();
	try {
		if (enc === "gzip") return zlib.gunzipSync(body);
		if (enc === "br") return zlib.brotliDecompressSync(body);
		if (enc === "deflate") return zlib.inflateSync(body);
		if (enc === "zstd" && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(body);
	} catch {}
	return body;
}

function redactedHeaders(req) {
	const out = [];
	for (let i = 0; i < req.rawHeaders.length; i += 2) {
		const name = req.rawHeaders[i];
		const value = SECRET_HEADERS.has(name.toLowerCase()) ? "<REDACTED>" : req.rawHeaders[i + 1];
		out.push([name, value]);
	}
	return out;
}

const inner = http.createServer((req, res) => {
	const target = req.socket._traceTarget;
	const chunks = [];
	req.on("data", c => chunks.push(c));
	req.on("end", () => {
		const raw = Buffer.concat(chunks);
		const id = ++counter;
		const isMessages = req.method === "POST" && req.url.split("?")[0].startsWith("/v1/messages");
		let tag = null;
		if (isMessages) {
			const body = decodeBody(req.headers, raw);
			tag = `${String(id).padStart(3, "0")}-${req.url.split("?")[0].replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9._-]+/g, "_")}`;
			fs.writeFileSync(path.join(outDir, `${tag}.body.json`), body);
			fs.writeFileSync(
				path.join(outDir, `${tag}.headers.json`),
				`${JSON.stringify({ method: req.method, url: req.url, headers: redactedHeaders(req) }, null, 2)}\n`,
			);
		}
		const headers = { ...req.headers };
		delete headers["proxy-connection"];
		const up = https.request(
			{ host: target.host, port: target.port, method: req.method, path: req.url, headers, servername: target.host },
			ures => {
				let bytes = 0;
				const rchunks = [];
				ures.on("data", c => {
					bytes += c.length;
					if (tag) rchunks.push(c);
				});
				ures.on("end", () => {
					if (tag) {
						const rbody = decodeBody(ures.headers, Buffer.concat(rchunks));
						fs.writeFileSync(path.join(outDir, `${tag}.response.txt`), rbody);
						fs.writeFileSync(
							path.join(outDir, `${tag}.response-headers.json`),
							`${JSON.stringify({ status: ures.statusCode, headers: ures.rawHeaders.reduce((a, v, i, arr) => (i % 2 ? a : [...a, [v, SECRET_HEADERS.has(v.toLowerCase()) ? "<REDACTED>" : arr[i + 1]]]), []) }, null, 2)}\n`,
						);
					}
					fs.appendFileSync(
						path.join(outDir, "index.jsonl"),
						`${JSON.stringify({ id, time: new Date().toISOString(), method: req.method, url: req.url, status: ures.statusCode, responseBytes: bytes, tag })}\n`,
					);
				});
				res.writeHead(ures.statusCode, ures.headers);
				ures.pipe(res);
			},
		);
		up.on("error", err => {
			console.error("upstream error", err.message);
			res.destroy();
		});
		up.end(raw);
	});
	req.on("error", () => {});
});

const server = net.createServer(socket => {
	socket.on("error", () => {});
	let buf = Buffer.alloc(0);
	const onData = chunk => {
		buf = Buffer.concat([buf, chunk]);
		const end = buf.indexOf("\r\n\r\n");
		if (end < 0) return;
		socket.off("data", onData);
		const head = buf.subarray(0, end).toString("latin1");
		const rest = buf.subarray(end + 4);
		const [method, authority] = head.split("\r\n", 1)[0].split(/\s+/);
		if (method !== "CONNECT") {
			socket.end("HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n");
			return;
		}
		const [host, portStr] = authority.split(":");
		const port = Number(portStr || 443);
		if (host !== MITM_HOST) {
			const upstream = net.connect(port, host, () => {
				socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				if (rest.length) upstream.write(rest);
				socket.pipe(upstream);
				upstream.pipe(socket);
			});
			upstream.on("error", () => socket.destroy());
			socket.on("error", () => upstream.destroy());
			return;
		}
		socket.write("HTTP/1.1 200 Connection Established\r\n\r\n", () => {
			const tlsSocket = new tls.TLSSocket(socket, { isServer: true, key, cert, ALPNProtocols: ["http/1.1"] });
			tlsSocket._traceTarget = { host, port };
			tlsSocket.on("error", () => {});
			if (rest.length) tlsSocket.unshift(rest);
			inner.emit("connection", tlsSocket);
		});
	};
	socket.on("data", onData);
});
server.listen(Number(portArg ?? 0), "127.0.0.1", () => {
	console.log(`LISTENING ${server.address().port}`);
});
