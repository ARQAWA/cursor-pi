// Logging reverse proxy for Codex CLI -> chatgpt.com/backend-api (ChatGPT login).
// Records every HTTP request/response as JSONL. Credentials are never written:
// sensitive headers are dropped, and any string that equals a value in auth.json is redacted.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import zlib from 'node:zlib';

const PORT = Number(process.env.PROXY_PORT || 18787);
const LOG = process.env.PROXY_LOG || '/private/tmp/codexcompact/run/proxy-log.jsonl';
const UPSTREAM_HOST = 'chatgpt.com';
const SENSITIVE_HEADER = /(authorization|cookie|token|secret|api-key|account|organization|project|jwt|bearer|credential)/i;

// Collect secret strings from auth.json in memory only (never printed).
const secrets = [];
try {
  const j = JSON.parse(fs.readFileSync(process.env.AUTH_JSON || `${process.env.HOME}/.codex/auth.json`, 'utf8'));
  (function walk(o) {
    if (typeof o === 'string') { if (o.length >= 16) secrets.push(o); }
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  })(j);
} catch {}
try {
  const iid = fs.readFileSync(`${process.env.HOME}/.codex/installation_id`, 'utf8').trim();
  if (iid.length >= 16) secrets.push(iid);
} catch {}
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
function redact(s) {
  if (typeof s !== 'string') return s;
  for (const sec of secrets) if (s.includes(sec)) s = s.split(sec).join('[REDACTED-SECRET]');
  return s.replace(JWT, '[REDACTED-JWT]').replace(/(installation_id[\\":\s]+)[0-9a-fA-F-]{36}/g, '$1[REDACTED-INSTALLATION-ID]');
}
function cleanHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = SENSITIVE_HEADER.test(k) ? '[REDACTED]' : redact(Array.isArray(v) ? v.join(', ') : String(v));
  }
  return out;
}
function decode(buf, enc) {
  try {
    if (enc === 'zstd') return zlib.zstdDecompressSync(buf);
    if (enc === 'gzip') return zlib.gunzipSync(buf);
    if (enc === 'br') return zlib.brotliDecompressSync(buf);
    if (enc === 'deflate') return zlib.inflateSync(buf);
  } catch (e) { return Buffer.from(`[decode error ${enc}: ${e.message}]`); }
  return buf;
}

let seq = 0;
function log(entry) { fs.appendFileSync(LOG, JSON.stringify(entry) + '\n'); }

const server = http.createServer((req, res) => {
  const id = ++seq;
  const t0 = Date.now();
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const reqEnc = (req.headers['content-encoding'] || '').toLowerCase();
    const reqText = body.length ? decode(body, reqEnc).toString('utf8') : '';
    const headers = { ...req.headers, host: UPSTREAM_HOST };
    delete headers['connection'];
    delete headers['accept-encoding']; // ask upstream for an identity response so it is loggable
    const up = https.request({ host: UPSTREAM_HOST, path: req.url, method: req.method, headers }, (ur) => {
      const rchunks = [];
      res.writeHead(ur.statusCode, ur.headers);
      ur.on('data', (c) => { rchunks.push(c); res.write(c); });
      ur.on('end', () => {
        res.end();
        const rbuf = Buffer.concat(rchunks);
        const resText = decode(rbuf, (ur.headers['content-encoding'] || '').toLowerCase()).toString('utf8');
        log({
          seq: id, ts: new Date(t0).toISOString(), ms: Date.now() - t0,
          method: req.method, url: req.url,
          request_headers: cleanHeaders(req.headers),
          request_content_encoding: reqEnc || null,
          request_body: redact(reqText),
          status: ur.statusCode,
          response_headers: cleanHeaders(ur.headers),
          response_body: redact(resText),
        });
      });
    });
    up.on('error', (e) => {
      log({ seq: id, ts: new Date(t0).toISOString(), method: req.method, url: req.url, error: String(e) });
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    up.end(body);
  });
});

// Refuse WebSocket upgrades so Codex falls back to the HTTPS Responses transport.
server.on('upgrade', (req, socket) => {
  const id = ++seq;
  log({ seq: id, ts: new Date().toISOString(), method: req.method, url: req.url, note: 'websocket upgrade refused with 426', request_headers: cleanHeaders(req.headers) });
  socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
});

server.listen(PORT, '127.0.0.1', () => console.log(`proxy listening on 127.0.0.1:${PORT}, log ${LOG}`));
