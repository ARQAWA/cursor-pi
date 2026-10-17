#!/usr/bin/env bun
// Captures the request Pi sends for the main toolset and compares its tools with Cursor Desktop's captured main toolset.
// Usage: bun tools/check-toolset.mjs

import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(ROOT, "tools", "capture-request.mjs");
const CAPTURED_MAIN_TOOLS = join(ROOT, "research", "cursor", "reverse", "runs-2026-10-16-T4", "tools", "tools-1-4b2bc1b7.json");
const CODEX = "openai-codex/gpt-5.6-sol";
const ANTHROPIC = "anthropic/claude-opus-5-5";
// Pi's reserved deferred tool for Anthropic native tool changes; it is not a Cursor tool.
const PI_PLACEHOLDER = "__pi_deferred_placeholder__";

function run(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stdout.resume();
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => resolveRun({ code: 1, stderr: error.message }));
    child.on("close", (code) => resolveRun({ code, stderr }));
  });
}

async function captureBody(model) {
  const dir = await mkdtemp(join(tmpdir(), "cursor-pi-toolset-"));
  const out = join(dir, "capture.json");
  const result = await run([CAPTURE, "--model", model, "--out", out]);
  if (result.code !== 0) {
    throw new Error(`capture-request exit ${result.code}: ${result.stderr.trim().split("\n").pop() ?? ""}`);
  }
  return JSON.parse(await readFile(out, "utf8")).body;
}

const captured = JSON.parse(await readFile(CAPTURED_MAIN_TOOLS, "utf8"));
let failed = 0;

try {
  const body = await captureBody(CODEX);
  if (JSON.stringify(body.tools) === JSON.stringify(captured)) {
    console.log(`ok ${CODEX}: tools equal the captured main array (${captured.length} tools)`);
  } else {
    failed++;
    const index = captured.findIndex((entry, i) => JSON.stringify(entry) !== JSON.stringify(body.tools?.[i]));
    const names = Array.isArray(body.tools) ? body.tools.map((tool) => tool?.name) : body.tools;
    console.log(`FAIL ${CODEX}: tools differ from the captured main array (first difference at index ${index}; sent ${JSON.stringify(names)})`);
  }
  console.log(`${CODEX} tool_choice: ${JSON.stringify(body.tool_choice)}`);
  console.log(`${CODEX} parallel_tool_calls: ${JSON.stringify(body.parallel_tool_calls)}`);
} catch (error) {
  failed++;
  console.log(`FAIL ${CODEX}: ${error.message}`);
}

try {
  const body = await captureBody(ANTHROPIC);
  const sent = Array.isArray(body.tools) ? body.tools : [];
  console.log(`${ANTHROPIC} tools: ${sent.map((tool) => tool?.name).join(", ")}`);
  const tools = sent.filter((tool) => tool?.name !== PI_PLACEHOLDER);
  const mismatched = tools
    .filter((tool) => {
      const entry = captured.find((candidate) => candidate.name === tool?.name);
      return entry === undefined || entry.description !== tool.description;
    })
    .map((tool) => tool?.name);
  if (tools.length > 0 && mismatched.length === 0) {
    console.log(`ok ${ANTHROPIC}: every description equals the captured one`);
  } else {
    failed++;
    console.log(`FAIL ${ANTHROPIC}: description differs from the captured one for ${mismatched.join(", ") || "(no tools sent)"}`);
  }
} catch (error) {
  failed++;
  console.log(`FAIL ${ANTHROPIC}: ${error.message}`);
}

process.exit(failed === 0 ? 0 : 1);
