#!/usr/bin/env bun
// Captures the request for every supported model and checks that Pi sends exactly the Cursor Pi prompt.
// Usage: bun tools/check-prompts.mjs

import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promptForModel } from "../extensions/cursor-pi/prompts.ts";

const CAPTURE = join(dirname(fileURLToPath(import.meta.url)), "capture-request.mjs");
const MODELS = [
  ...["gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra"].map((id) => ({
    provider: "openai-codex",
    id,
  })),
  ...["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"].map((id) => ({ provider: "anthropic", id })),
];
// The system prompt is compared byte for byte; these phrases must not appear anywhere else in the request.
const FORBIDDEN = ["operating inside pi", "Pi documentation", "<project_context>", "<skills>", "<cwd>", "AGENTS.md"];

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

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
  return "";
}

function checkBody(provider, body, expectedText) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return ["body is not a JSON object"];
  const failures = [];

  let system;
  if (provider === "openai-codex") {
    system = body.instructions;
  } else if (Array.isArray(body.system) && body.system.every((block) => block?.type === "text")) {
    system = body.system.map((block) => block.text).join("");
  } else {
    failures.push("system is not an array of text blocks");
  }
  if (system !== expectedText) failures.push("system text differs from promptForModel");

  const items = [...(Array.isArray(body.input) ? body.input : []), ...(Array.isArray(body.messages) ? body.messages : [])];
  for (const item of items) {
    if (item?.role !== "system" && item?.role !== "developer") continue;
    const text = textOf(item.content);
    if (text.length > 0 && text !== expectedText) failures.push(`${item.role} item carries text other than the prompt`);
  }

  // The system field is already matched byte for byte above, so the prompt's own text is left out of this scan.
  const { instructions: _instructions, system: _system, ...rest } = body;
  const scanned = JSON.stringify(rest);
  for (const phrase of FORBIDDEN) {
    if (scanned.includes(phrase)) failures.push(`body contains "${phrase}"`);
  }

  if (body.tools !== undefined && !(Array.isArray(body.tools) && body.tools.length === 0)) {
    failures.push("tools are declared");
  }
  return failures;
}

async function checkModel(provider, id) {
  const expected = promptForModel(id);
  if (!expected) return ["no prompt file for this model"];
  const dir = await mkdtemp(join(tmpdir(), "cursor-pi-check-"));
  const out = join(dir, "capture.json");
  const result = await run([CAPTURE, "--model", `${provider}/${id}`, "--out", out]);
  if (result.code !== 0) {
    const lastLine = result.stderr.trim().split("\n").pop() ?? "";
    return [`capture-request exit ${result.code}: ${lastLine}`];
  }
  const record = JSON.parse(await readFile(out, "utf8"));
  return checkBody(provider, record.body, expected.text);
}

let failed = 0;
for (const { provider, id } of MODELS) {
  const label = `${provider}/${id}`;
  let reasons;
  try {
    reasons = await checkModel(provider, id);
  } catch (error) {
    reasons = [String(error?.message ?? error)];
  }
  if (reasons.length === 0) {
    console.log(`ok ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}: ${reasons.join("; ")}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
