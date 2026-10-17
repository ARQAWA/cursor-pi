import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const usage = 'Usage: node tools/ab-eval.mjs --codex <session-id|rollout.jsonl> --cursor <composer-id> [--cursor-db <state.vscdb>]';

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--codex', '--cursor', '--cursor-db'].includes(key) || process.argv[i + 1] === undefined) fail(usage, 2);
  args[key.slice(2)] = process.argv[i + 1];
}
if (!args.codex || !args.cursor) fail(usage, 2);

function findRollout(value) {
  if (existsSync(value) && statSync(value).isFile()) return value;
  const dir = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'sessions');
  let entries = [];
  try {
    entries = readdirSync(dir, { recursive: true });
  } catch {
    // A missing sessions directory is reported as a missing rollout below.
  }
  const hit = entries.find((entry) => String(entry).endsWith(`-${value}.jsonl`));
  if (hit === undefined) fail(`Codex rollout not found: ${value}`);
  return path.join(dir, String(hit));
}

// Root thread only: subagents write their own rollout files.
function codexMetrics(file) {
  const inputTypes = new Set(['function_call_output', 'custom_tool_call_output', 'agent_message']);
  let wall = 0;
  let segmentStart = null;
  let lastTs = null;
  let lastInput = null;
  let acc = 0;
  let gen = 0;
  let out = 0;
  let visTok = 0;
  let visChars = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(record?.timestamp);
    if (!Number.isFinite(ts)) continue;
    lastTs = ts;
    const payload = record.payload ?? {};
    if (record.type === 'event_msg') {
      if (payload.type === 'task_started') {
        segmentStart ??= ts;
        lastInput = ts;
      } else if (payload.type === 'task_complete' && segmentStart !== null) {
        wall += ts - segmentStart;
        segmentStart = null;
      }
    } else if (record.type === 'response_item') {
      if (inputTypes.has(payload.type) || (payload.type === 'message' && payload.role === 'user')) lastInput = ts;
      if (payload.type === 'custom_tool_call') acc += String(payload.input ?? '').length;
      else if (payload.type === 'function_call') acc += String(payload.arguments ?? '').length;
      else if (payload.type === 'message' && payload.role === 'assistant') {
        for (const part of payload.content ?? []) acc += String(part?.text ?? '').length;
      }
    } else if (record.type === 'token_usage_record') {
      const usage = payload.usage ?? {};
      gen += ts - (lastInput ?? ts);
      lastInput = ts;
      out += usage.output_tokens ?? 0;
      visTok += (usage.output_tokens ?? 0) - (usage.reasoning_output_tokens ?? 0);
      visChars += acc;
      acc = 0;
    }
  }
  if (segmentStart !== null && lastTs !== null) wall += lastTs - segmentStart;
  return { wall, gen, out, tps: out / (gen / 1000), charsPerToken: visTok > 0 ? visChars / visTok : 4 };
}

function unionLength(intervals) {
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let start = null;
  let end = null;
  for (const [s, e] of intervals) {
    if (e < s) continue;
    if (end === null || s > end) {
      if (end !== null) total += end - start;
      start = s;
      end = e;
    } else if (e > end) end = e;
  }
  return end === null ? total : total + end - start;
}

async function cursorMetrics(composerId, dbPath, charsPerToken) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    fail('Cursor database support needs Node.js 22.5 or newer (node:sqlite)');
  }
  if (!existsSync(dbPath)) fail(`Cursor database not found: ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const select = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
  const read = (key) => {
    const row = select.get(key);
    return row ? JSON.parse(Buffer.from(row.value).toString('utf8')) : undefined;
  };
  const composer = read(`composerData:${composerId}`);
  if (!composer) fail(`Cursor composer not found: ${composerId}`);
  const bubbles = [];
  for (const header of composer.fullConversationHeadersOnly ?? []) {
    const bubble = read(`bubbleId:${composerId}:${header.bubbleId}`);
    if (bubble) bubbles.push(bubble);
  }
  db.close();

  const writeTools = new Set(['edit_file_v2', 'edit_file', 'write', 'search_replace']);
  const toolIntervals = [];
  let wall = 0;
  let think = 0;
  let visChars = 0;
  let turn = null;
  const closeTurn = () => {
    if (turn?.assistant) wall += turn.end - turn.start;
  };
  for (const bubble of bubbles) {
    if (bubble.type === 1) {
      closeTurn();
      const start = Date.parse(bubble.createdAt);
      turn = { start, end: start, assistant: false };
      continue;
    }
    if (bubble.type !== 2) continue;
    if (turn) {
      turn.assistant = true;
      turn.end = Math.max(turn.end, Date.parse(bubble.createdAt) || 0, bubble.completedAtMs || 0);
    }
    const tool = bubble.toolFormerData;
    if (tool?.name && !writeTools.has(tool.name) && typeof bubble.startedAtMs === 'number' && typeof bubble.completedAtMs === 'number') {
      toolIntervals.push([bubble.startedAtMs, bubble.completedAtMs]);
    }
    if (bubble.thinking?.text) {
      think += bubble.thinkingDurationMs || 0;
      continue;
    }
    if (tool?.name) {
      visChars += String(tool.rawArgs ?? tool.params ?? '').length;
      let extra = tool.additionalData;
      if (typeof extra === 'string') {
        try {
          extra = JSON.parse(extra);
        } catch {
          extra = undefined;
        }
      }
      for (const diffLine of extra?.precomputedDiff?.lines ?? []) {
        if (diffLine.type === 'added') visChars += String(diffLine.content ?? '').length + 1;
      }
    } else {
      visChars += String(bubble.text ?? '').length;
    }
  }
  closeTurn();

  const other = unionLength(toolIntervals);
  const gen = wall - other;
  const tokens = visChars / charsPerToken;
  return { wall, gen, other, tokens, tps: tokens / ((gen - think) / 1000) };
}

function defaultCursorDb() {
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? '', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  return path.join(homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
}

const fmt = (ms) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const codex = codexMetrics(findRollout(args.codex));
const cursor = await cursorMetrics(args.cursor, args['cursor-db'] ?? defaultCursorDb(), codex.charsPerToken);

const lines = [
  `Codex   wall ${fmt(codex.wall)}  generation ${fmt(codex.gen)}  other ${fmt(codex.wall - codex.gen)}  output ${codex.out} tokens (exact)  TPS ${codex.tps.toFixed(1)}`,
  `Cursor  wall ${fmt(cursor.wall)}  generation ${fmt(cursor.gen)}  other ${fmt(cursor.other)}  output ~${Math.round(cursor.tokens)} tokens (${codex.charsPerToken.toFixed(2)} chars/token, thinking excluded)  TPS ${cursor.tps.toFixed(1)}`,
];
if (!(codex.tps > 0 && cursor.tps > 0 && Number.isFinite(codex.tps) && Number.isFinite(cursor.tps))) {
  process.stdout.write(`${lines.join('\n')}\nNot enough data to normalize\n`);
  process.exit(1);
}
const common = Math.min(codex.tps, cursor.tps);
const normalized = (side) => side.wall - side.gen + (side.gen * side.tps) / common;
const codexNorm = normalized(codex);
const cursorNorm = normalized(cursor);
lines.push(
  `Common TPS ${common.toFixed(1)} (lower of the two)`,
  `At common TPS: Codex ${fmt(codexNorm)}, Cursor ${fmt(cursorNorm)}, Codex/Cursor ${(codexNorm / cursorNorm).toFixed(2)}`,
);
process.stdout.write(`${lines.join('\n')}\n`);
