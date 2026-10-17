#!/usr/bin/env bun
// Runs Cursor Pi for one prompt against a fake provider that answers every request from a script of turns, and records
// each request body Pi sends. The script is JSON: { "turns": [{ "calls": [{ "name", "arguments" }] }, { "text": "..." }] }.
// Usage: bun tools/capture-session.mjs --model <provider/id> --script <file.json> [--prompt <text>] [--cwd <dir>] [--out <file>]

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fakeCodexKey, startFakeProvider } from "./lib/fake-provider.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURSOR_PI = join(ROOT, "bin", "cursor-pi");
const PROVIDERS = new Set(["openai-codex", "anthropic"]);
const RUN_TIMEOUT_MS = 120_000;

function fail(message) {
  console.error(`capture-session: ${message}`);
  process.exit(1);
}

function usage(message) {
  console.error(`capture-session: ${message}`);
  console.error("usage: bun tools/capture-session.mjs --model <provider/id> --script <file.json> [--prompt <text>] [--cwd <dir>] [--out <file>]");
  process.exit(2);
}

// The provider part of a provider/id model name; only the two providers the fake answers are accepted.
export function providerOf(model) {
  const slash = model.indexOf("/");
  if (slash <= 0 || slash === model.length - 1) throw new Error(`model must be provider/id, got ${model}`);
  const provider = model.slice(0, slash);
  if (!PROVIDERS.has(provider)) throw new Error(`unsupported provider ${provider}; expected openai-codex or anthropic`);
  return provider;
}

function runCursorPi(args, { cwd, agentDir, timeoutMs }) {
  return new Promise((resolveRun) => {
    const child = spawn(CURSOR_PI, args, {
      cwd,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const finish = (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, signal, stdout, stderr });
    };
    child.on("error", (error) => {
      stderr += `${error.message}\n`;
      finish(null, null);
    });
    child.on("close", finish);
  });
}

// Runs one prompt through Cursor Pi with the scripted turns, and returns the requests Pi sent in order.
export async function runScriptedSession({ model, cwd, prompt, turns, timeoutMs = RUN_TIMEOUT_MS }) {
  const provider = providerOf(model);
  const fake = await startFakeProvider({ provider, turns });
  try {
    const agentDir = await mkdtemp(join(tmpdir(), "cursor-pi-agent-"));
    // transport "sse" replaces the deprecated websockets setting, so Codex posts to the fake provider over HTTP.
    const settings = { compaction: { enabled: false }, retry: { enabled: false }, transport: "sse" };
    const models = {
      providers: {
        "openai-codex": { baseUrl: fake.baseUrl, apiKey: fakeCodexKey() },
        anthropic: { baseUrl: fake.baseUrl },
      },
    };
    await writeFile(join(agentDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
    await writeFile(join(agentDir, "models.json"), `${JSON.stringify(models, null, 2)}\n`);
    const args = ["-p", "--no-session", "--model", model];
    if (provider === "anthropic") args.push("--api-key", "sk-ant-api03-capture");
    args.push(prompt);
    const run = await runCursorPi(args, { cwd, agentDir, timeoutMs });
    return { ...run, requests: fake.requests, errors: fake.errors.map((error) => error.message) };
  } finally {
    fake.close();
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string" },
      script: { type: "string" },
      prompt: { type: "string", default: "hello" },
      cwd: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.model) usage("--model is required");
  if (!values.script) usage("--script is required");
  let provider;
  try {
    provider = providerOf(values.model);
  } catch (error) {
    usage(error.message);
  }
  const script = JSON.parse(await readFile(resolve(values.script), "utf8"));
  if (!Array.isArray(script.turns) || script.turns.length === 0) fail(`${values.script} needs a non-empty turns array`);
  const cwd = values.cwd ? await realpath(resolve(values.cwd)) : await realpath(await mkdtemp(join(tmpdir(), "cursor-pi-cwd-")));
  const result = await runScriptedSession({ model: values.model, cwd, prompt: values.prompt, turns: script.turns });
  const id = values.model.slice(values.model.indexOf("/") + 1);
  const out = resolve(values.out ?? join(tmpdir(), "cursor-pi-session", `${provider}-${id}.json`));
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`session: ${out} (${result.requests.length} requests, exit ${result.code})`);
  for (const error of result.errors) console.error(`capture-session: ${error}`);
  process.exit(result.code === 0 && result.errors.length === 0 ? 0 : 1);
}

if (import.meta.main) main().catch((error) => fail(error.stack ?? String(error)));
