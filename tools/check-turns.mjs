#!/usr/bin/env bun
// Runs a scripted session through Cursor Pi for openai-codex/gpt-5.6-sol and anthropic/claude-opus-5-5: three tool rounds
// (Glob, rg and ReadFile in one turn; Shell; ApplyPatch) and a final answer. For each request that follows a tool round it
// checks the calls and outputs Pi sent against the texts that each tool's execute returns when called directly, the item
// shapes against Cursor's captured items, and that the context and user messages stay unchanged.
// Usage: bun tools/check-turns.mjs    Exits non-zero on any FAIL.

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runScriptedSession } from "./capture-session.mjs";
import { executeApplyPatch } from "../extensions/cursor-pi/tools/apply-patch.ts";
import { executeGlob } from "../extensions/cursor-pi/tools/glob.ts";
import { executeRg } from "../extensions/cursor-pi/tools/rg.ts";
import { executeReadFile } from "../extensions/cursor-pi/tools/read-file.ts";
import { executeShell } from "../extensions/cursor-pi/tools/shell.ts";
import { projectDirFor } from "../extensions/cursor-pi/tools/shell/paths.ts";

const CODEX = "openai-codex/gpt-5.6-sol";
const ANTHROPIC = "anthropic/claude-opus-5-5";
const PROMPT = "Find the TypeScript files, read the README, run a shell check, then add a note file.";
const REASONING = "Find the TypeScript files, search for exports, read the README, then run the shell check.";
const NOTE = "NOTES_NEW.md";
const NOTE_TEXT = "hello from the scripted session";
const FILES = {
  "README.md": "# Demo\n\nA workspace for the turn capture check.\n",
  "notes.txt": "first note\n",
  "src/app.ts": "export function main() {\n  return 1;\n}\n",
  "src/util.ts": "export const add = (a: number, b: number) => a + b;\n",
};
const EXECUTORS = { Glob: executeGlob, rg: executeRg, ReadFile: executeReadFile, Shell: executeShell, ApplyPatch: executeApplyPatch };
const REASONING_TEXT = "fake-encrypted-reasoning-turn0";

// Field sets of Cursor's captured items: research/cursor/reverse/runs-2026-10-16-T4 items and calls, runs-2026-10-16-T3 call 009,
// and the upstream requests in the T4 proxy log. The logs sort every object's keys, so only the sets are compared.
const CURSOR_FIELDS = {
  function_call: ["arguments", "call_id", "name", "type"],
  custom_tool_call: ["call_id", "input", "name", "type"],
  function_call_output: ["call_id", "output", "type"],
  custom_tool_call_output: ["call_id", "output", "type"],
  user_message: ["content", "role", "type"],
};
// Fields Pi adds on purpose; see the known differences printed at the end.
const KNOWN_EXTRA = { function_call: ["id"], custom_tool_call: ["id"] };
const OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);
const CALL_TYPES = new Set(["function_call", "custom_tool_call"]);

let failures = 0;
let checks = 0;
const knownSeen = new Set();

function report(name, ok, detail = "") {
  checks += 1;
  if (ok) {
    console.log(`ok ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}`);
  if (detail) console.log(detail);
}

function diffText(expected, actual) {
  let i = 0;
  while (i < expected.length && expected[i] === actual[i]) i += 1;
  const around = (text) => JSON.stringify(text.slice(Math.max(0, i - 40), i + 80));
  return `  expected: ${around(expected)}\n  actual:   ${around(actual)}\n  first difference at character ${i}`;
}

function same(name, actual, expected) {
  report(name, actual === expected, diffText(String(expected), String(actual)));
}

function known(description) {
  if (knownSeen.has(description)) return;
  knownSeen.add(description);
  console.log(`known ${description}`);
}

// Cursor's Shell text carries the command's duration, which differs between runs.
const normalize = (text) => text.replace(/(Command (?:completed in|aborted after)) \d+ ms\./g, "$1 N ms.");
const stripCache = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === "cache_control" ? undefined : v)));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function textOf(result) {
  const parts = result.content ?? [];
  if (parts.length !== 1 || parts[0].type !== "text") throw new Error(`expected one text part, got ${JSON.stringify(parts.map((p) => p.type))}`);
  return parts[0].text;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

async function createWorkspace() {
  const ws = await realpath(await mkdtemp(path.join(os.tmpdir(), "cursor-pi-turns-")));
  for (const [file, text] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(ws, file)), { recursive: true });
    await writeFile(path.join(ws, file), text);
  }
  git(ws, ["init", "-q"]);
  git(ws, ["add", "-A"]);
  git(ws, ["-c", "user.name=capture", "-c", "user.email=capture@example.invalid", "commit", "-q", "-m", "init"]);
  return ws;
}

// The scripted turns. The ApplyPatch input adds one note file in the workspace.
function scriptFor(ws, provider) {
  const patch = `*** Begin Patch\n*** Add File: ${path.join(ws, NOTE)}\n+${NOTE_TEXT}\n*** End Patch\n`;
  const round1 = {
    calls: [
      { name: "Glob", arguments: { glob_pattern: "**/*.ts" } },
      // The path differs per workspace: rg's result cache is keyed by the request, not by the working directory.
      { name: "rg", arguments: { pattern: "export", path: ws, output_mode: "content" } },
      { name: "ReadFile", arguments: { path: path.join(ws, "README.md") } },
    ],
  };
  // Codex sends a reasoning item with the calls; the Anthropic fake has no reasoning turns.
  if (provider === "openai-codex") round1.reasoning = REASONING;
  return [
    round1,
    { calls: [{ name: "Shell", arguments: { command: "echo hi" } }] },
    { calls: [{ name: "ApplyPatch", arguments: { input: patch } }] },
    { text: "Scripted session finished." },
  ];
}

// Each tool's execute, called directly in the workspace in script order. ApplyPatch leaves its file behind, so it is removed
// again and the Pi run starts from the same workspace.
async function expectedTexts(ws, calls) {
  const ctx = { cwd: ws, hasUI: false };
  const expected = {};
  for (const call of calls) {
    const result = await EXECUTORS[call.name](call.arguments, undefined, ctx);
    if (result.isError) throw new Error(`${call.name} failed when called directly: ${textOf(result)}`);
    expected[call.name] = normalize(textOf(result));
  }
  await rm(path.join(ws, NOTE), { force: true });
  return expected;
}

// Field names that are missing from an item, and extra ones that are not known differences.
function fieldProblems(type, item, expectedFields) {
  const keys = Object.keys(item);
  const extraKnown = keys.filter((key) => !expectedFields.includes(key) && (KNOWN_EXTRA[type] ?? []).includes(key));
  const missing = expectedFields.filter((key) => !keys.includes(key));
  const unknown = keys.filter((key) => !expectedFields.includes(key) && !extraKnown.includes(key));
  return { missing, unknown, extraKnown };
}

// The text of a function_call_output or custom_tool_call_output item, whether Pi sent it as a string or as parts.
function outputText(item) {
  return typeof item.output === "string" ? item.output : item.output?.[0]?.text;
}

function outputProblems(item) {
  const out = item.output;
  if (!Array.isArray(out) || out.length !== 1) return `output is not a one-part array: ${JSON.stringify(out).slice(0, 120)}`;
  const part = out[0];
  if (part?.type !== "input_text" || typeof part.text !== "string") return `output part is not input_text: ${JSON.stringify(part).slice(0, 120)}`;
  if (!sameJson(Object.keys(part).sort(), ["text", "type"])) return `output part keys are ${Object.keys(part).join(",")}`;
  return undefined;
}

function checkCodexItems(model, requestNumber, newItems) {
  for (const item of newItems) {
    if (item.type === "reasoning") {
      report(`${model}: request ${requestNumber} replays the reasoning item verbatim before the calls`, item.encrypted_content === REASONING_TEXT && newItems.indexOf(item) === 0, `  item: ${JSON.stringify(item).slice(0, 200)}`);
      known("reasoning: the reasoning item Codex produced comes back as input before the calls of its turn. Cursor's captured requests carry no reasoning items.");
      continue;
    }
    const expectedFields = CURSOR_FIELDS[item.type];
    if (expectedFields === undefined) {
      report(`${model}: request ${requestNumber} item type ${item.type} is one Cursor sends`, false);
      continue;
    }
    const { missing, unknown, extraKnown } = fieldProblems(item.type, item, expectedFields);
    const outputIssue = OUTPUT_TYPES.has(item.type) ? outputProblems(item) : undefined;
    report(
      `${model}: request ${requestNumber} ${item.type} has Cursor's fields`,
      missing.length === 0 && unknown.length === 0 && outputIssue === undefined,
      `  missing: ${missing.join(",") || "-"}; unexpected: ${unknown.join(",") || "-"}${outputIssue ? `; ${outputIssue}` : ""}\n  item: ${JSON.stringify(item).slice(0, 240)}`,
    );
    if (extraKnown.length > 0) {
      known(`${item.type}: Pi keeps the model's ${extraKnown.join(",")} field (fc_/ctc_ id). Cursor's captured items have no id.`);
    }
  }
}

function checkCodex(model, requests, expected, turns) {
  const inputs = requests.map((request) => request.body.input ?? []);
  const promptAt = inputs[0].findIndex((item) => JSON.stringify(item).includes(PROMPT));
  report(`${model}: request 1 holds the prompt message`, promptAt >= 0, `  input types: ${inputs[0].map((item) => item.type ?? item.role).join(",")}`);
  for (let n = 1; n < requests.length; n++) {
    const prev = inputs[n - 1];
    const cur = inputs[n];
    report(`${model}: request ${n + 1} starts with request ${n} unchanged`, sameJson(cur.slice(0, prev.length), prev));
    report(
      `${model}: request ${n + 1} keeps the context and prompt messages unchanged`,
      sameJson(cur.slice(0, promptAt + 1), inputs[0].slice(0, promptAt + 1)),
    );
  }
  // The context and prompt messages are user messages; Cursor's carry type "message", Pi's may not.
  for (const item of inputs[0].slice(0, promptAt + 1)) {
    const { missing, unknown } = fieldProblems("message", item, CURSOR_FIELDS.user_message);
    report(`${model}: request 1 user message has Cursor's fields`, missing.length === 0 && unknown.length === 0, `  missing: ${missing.join(",") || "-"}; unexpected: ${unknown.join(",") || "-"}\n  item: ${JSON.stringify(item).slice(0, 160)}`);
  }
  for (let round = 0; round < turns.length - 1; round++) {
    const cur = inputs[round + 1];
    const prev = inputs[round];
    const prefix = `call_turn${round}_`;
    const calls = cur.filter((item) => CALL_TYPES.has(item.type) && item.call_id.startsWith(prefix));
    const outputs = cur.filter((item) => OUTPUT_TYPES.has(item.type) && item.call_id.startsWith(prefix));
    const scripted = turns[round].calls ?? [];
    const names = calls.map((call) => call.name);
    report(
      `${model}: request ${round + 2} echoes the ${scripted.length} scripted calls in order`,
      sameJson(names, scripted.map((call) => call.name)) && calls.every((call, i) => call.type === (scripted[i].name === "ApplyPatch" ? "custom_tool_call" : "function_call")),
      `  sent: ${names.join(",")}; scripted: ${scripted.map((call) => call.name).join(",")}`,
    );
    calls.forEach((call, i) => {
      const args = scripted[i]?.arguments;
      if (call.type === "custom_tool_call") {
        report(`${model}: request ${round + 2} ${call.name} input is the raw patch`, call.input === args.input, diffText(args.input, call.input));
      } else {
        report(
          `${model}: request ${round + 2} ${call.name} arguments equal the scripted ones`,
          sameJson(JSON.parse(call.arguments), args),
          `  sent: ${call.arguments}`,
        );
      }
    });
    report(
      `${model}: request ${round + 2} has one output per call, in call order`,
      sameJson(outputs.map((item) => item.call_id), calls.map((call) => call.call_id)),
    );
    outputs.forEach((output, i) => {
      const name = calls[i]?.name;
      same(`${model}: request ${round + 2} ${name} output text equals its direct execute`, normalize(outputText(output)), expected[name]);
    });
    checkCodexItems(model, round + 2, cur.slice(prev.length));
  }
  if (inputs[1]) {
    console.log(`request 2, items after the prompt (as Pi sent them):`);
    for (const item of inputs[1].slice(inputs[0].length)) console.log(`  ${JSON.stringify(item).slice(0, 220)}`);
  }
}

function blocksOf(messages, type) {
  return messages.flatMap((message) => (Array.isArray(message.content) ? message.content : [])).filter((block) => block.type === type);
}

function resultText(content) {
  return typeof content === "string" ? content : (content ?? []).map((part) => part.text).join("\n");
}

function checkAnthropic(model, requests, expected, turns) {
  const messages = requests.map((request) => stripCache(request.body.messages ?? []));
  const promptAt = messages[0].findIndex((message) => JSON.stringify(message).includes(PROMPT));
  report(`${model}: request 1 holds the prompt message`, promptAt >= 0);
  for (let n = 1; n < requests.length; n++) {
    report(`${model}: request ${n + 1} starts with request ${n} unchanged (cache_control removed)`, sameJson(messages[n].slice(0, messages[n - 1].length), messages[n - 1]));
    report(`${model}: request ${n + 1} keeps the context and prompt messages unchanged`, sameJson(messages[n].slice(0, promptAt + 1), messages[0].slice(0, promptAt + 1)));
  }
  for (let round = 0; round < turns.length - 1; round++) {
    const cur = messages[round + 1];
    const scripted = turns[round].calls ?? [];
    const uses = blocksOf(cur, "tool_use").filter((block) => block.id.startsWith(`toolu_turn${round}_`));
    const results = blocksOf(cur, "tool_result").filter((block) => block.tool_use_id.startsWith(`toolu_turn${round}_`));
    report(
      `${model}: request ${round + 2} echoes the ${scripted.length} scripted tool_use blocks in order`,
      sameJson(uses.map((block) => block.name), scripted.map((call) => call.name)),
      `  sent: ${uses.map((block) => block.name).join(",")}`,
    );
    uses.forEach((block, i) => {
      report(`${model}: request ${round + 2} ${block.name} input equals the scripted arguments`, sameJson(block.input, scripted[i].arguments));
    });
    report(
      `${model}: request ${round + 2} has one tool_result per tool_use, in order`,
      sameJson(results.map((block) => block.tool_use_id), uses.map((block) => block.id)),
    );
    results.forEach((block, i) => {
      const name = uses[i]?.name;
      same(`${model}: request ${round + 2} ${name} tool_result text equals its direct execute`, normalize(resultText(block.content)), expected[name]);
    });
  }
}

async function runScenario(model, provider, checkRounds) {
  const ws = await createWorkspace();
  try {
    const turns = scriptFor(ws, provider);
    const expected = await expectedTexts(ws, turns.flatMap((turn) => turn.calls ?? []));
    const session = await runScriptedSession({ model, cwd: ws, prompt: PROMPT, turns });
    report(`${model}: Pi exits 0 without extension or provider errors`, session.code === 0 && session.errors.length === 0, `  exit ${session.code}; errors: ${session.errors.join(" | ")}\n${session.stderr.slice(-1500)}`);
    report(`${model}: the script answered 4 requests`, session.requests.length === turns.length, `  requests: ${session.requests.length}`);
    const note = await readFile(path.join(ws, NOTE), "utf8").catch(() => undefined);
    same(`${model}: ApplyPatch added the note file`, note, `${NOTE_TEXT}\n`);
    checkRounds(model, session.requests, expected, turns);
  } finally {
    await rm(ws, { recursive: true, force: true });
    await rm(projectDirFor(ws), { recursive: true, force: true });
  }
}

await runScenario(CODEX, "openai-codex", checkCodex);
await runScenario(ANTHROPIC, "anthropic", checkAnthropic);

console.log("Remaining differences from Cursor's captured requests, not failing the check:");
console.log("- Pi sends instructions (the system prompt) and a top-level tools array. The T4 proxy log has no instructions field; the system prompt is a developer message and the tools sit in an additional_tools input item.");
console.log("- Pi's user messages carry no <timestamp>/<user_query> wrapper, and the context message holds only the rules section, not the <user_info> block.");
console.log("- Field order is not compared. The proxy logs sort every object's keys, including OpenAI's own response events, so they do not show Cursor's order.");
console.log("- Pi sends the full input over SSE on every request. Cursor's upstream requests used websocket with previous_response_id in 34 of 600 requests.");
console.log(`${checks - failures} of ${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
