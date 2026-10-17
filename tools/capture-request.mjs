#!/usr/bin/env bun
// Captures the exact HTTP request body that Pi sends for one model, by running bin/cursor-pi against a local server.
// Usage: bun tools/capture-request.mjs --model <provider/id> [--cwd <dir>] [--prompt <text>] [--out <file>]

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fakeCodexKey, recordRequest } from "./lib/fake-provider.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURSOR_PI = join(ROOT, "bin", "cursor-pi");
const PROVIDERS = new Set(["openai-codex", "anthropic"]);
const RUN_TIMEOUT_MS = 60_000;

function fail(message) {
  console.error(`capture-request: ${message}`);
  process.exit(1);
}

function usage(message) {
  console.error(`capture-request: ${message}`);
  console.error("usage: bun tools/capture-request.mjs --model <provider/id> [--cwd <dir>] [--prompt <text>] [--out <file>]");
  process.exit(2);
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string" },
      cwd: { type: "string" },
      prompt: { type: "string", default: "hello" },
      out: { type: "string" },
    },
  });
  if (!values.model) usage("--model is required");
  const slash = values.model.indexOf("/");
  if (slash <= 0 || slash === values.model.length - 1) usage(`--model must be provider/id, got ${values.model}`);
  const provider = values.model.slice(0, slash);
  const id = values.model.slice(slash + 1);
  if (!PROVIDERS.has(provider)) usage(`unsupported provider ${provider}; expected openai-codex or anthropic`);

  const out = resolve(values.out ?? join(tmpdir(), "cursor-pi-capture", `${provider}-${id}.json`));
  const cwd = values.cwd ? resolve(values.cwd) : await mkdtemp(join(tmpdir(), "cursor-pi-cwd-"));
  const agentDir = await mkdtemp(join(tmpdir(), "cursor-pi-agent-"));
  // The child runs with its own HOME, so its ~/.cursor-pi writes stay out of the real home.
  const homeDir = await mkdtemp(join(tmpdir(), "cursor-pi-home-"));

  let captured;
  let captureError;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!captured && !captureError) {
        try {
          captured = recordRequest(req, Buffer.concat(chunks));
        } catch (error) {
          captureError = error;
        }
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "captured" } }));
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // transport "sse" replaces the deprecated websockets setting, so Codex posts to the capture server over HTTP.
  const settings = { compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" };
  const models = { providers: { "openai-codex": { baseUrl, apiKey: fakeCodexKey() }, anthropic: { baseUrl } } };
  await writeFile(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify(models, null, 2)}\n`);

  const args = ["-p", "--no-session", "--model", values.model];
  if (provider === "anthropic") args.push("--api-key", "sk-ant-api03-capture");
  args.push(values.prompt);
  const child = spawn(CURSOR_PI, args, {
    cwd,
    env: { ...process.env, HOME: homeDir, PI_CODING_AGENT_DIR: agentDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stdout.resume();
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), RUN_TIMEOUT_MS);
  await new Promise((resolveExit) => {
    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      resolveExit();
    });
    child.on("close", resolveExit);
  });
  clearTimeout(timer);
  server.closeAllConnections();
  server.close();

  if (captureError) fail(`could not decode the captured request: ${captureError.message}`);
  if (!captured) {
    process.stderr.write(stderr);
    fail("no request reached the capture server");
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(captured, null, 2)}\n`);
  console.log(`captured: ${out}`);
  process.exit(0);
}

main().catch((error) => fail(error.stack ?? String(error)));
