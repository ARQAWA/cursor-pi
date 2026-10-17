// Fake provider for the capture tools. It answers Codex Responses requests (openai-codex) and Anthropic Messages requests
// (anthropic) with SSE built from a script of turns, and records every request body that Pi sends.
// A turn is { calls: [{ name, arguments }], reasoning? } for tool calls, { text } for the final answer or { compaction } for the
// Codex remote compaction item. `reasoning` adds a
// reasoning item before the calls and is Codex-only. Codex sends ApplyPatch as a custom tool call whose raw input is
// arguments.input; Anthropic sends every call as a tool_use block whose input is the arguments object.
import { createServer } from "node:http";
import zlib from "node:zlib";

export const REDACTED_HEADERS = new Set(["authorization", "x-api-key"]);
const PATHS = { "openai-codex": "/codex/responses", anthropic: "/v1/messages" };
const UNSCRIPTED_TEXT = "Unscripted request: the script has no turn left.";

// Codex reads the JWT payload with atob, so the segments use standard base64.
export function fakeCodexKey() {
  const segment = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
  const claims = { "https://api.openai.com/auth": { chatgpt_account_id: "capture" } };
  return `${segment({ alg: "none", typ: "JWT" })}.${segment(claims)}.`;
}

export function decodeBody(raw, encoding) {
  switch (encoding) {
    case undefined:
    case "identity":
      return raw;
    case "zstd":
      return Buffer.from(Bun.zstdDecompressSync(raw));
    case "gzip":
      return zlib.gunzipSync(raw);
    case "deflate":
      return zlib.inflateSync(raw);
    default:
      throw new Error(`unsupported content-encoding: ${encoding}`);
  }
}

export function recordRequest(req, raw) {
  const text = decodeBody(raw, req.headers["content-encoding"]).toString("utf8");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([name, value]) => [name, REDACTED_HEADERS.has(name) ? "[REDACTED]" : value]),
  );
  return { method: req.method, path: req.url, headers, body };
}

function validateTurns(turns, provider) {
  for (const [index, turn] of turns.entries()) {
    const hasCalls = Array.isArray(turn.calls) && turn.calls.length > 0;
    const hasText = typeof turn.text === "string";
    const hasCompaction = turn.compaction !== undefined;
    if ([hasCalls, hasText, hasCompaction].filter(Boolean).length !== 1) {
      throw new Error(`turn ${index} needs exactly one of calls, text or compaction`);
    }
    if (hasCompaction && provider !== "openai-codex") throw new Error(`turn ${index}: compaction is Codex-only`);
    if (turn.reasoning !== undefined && provider !== "openai-codex") throw new Error(`turn ${index}: reasoning is Codex-only`);
    for (const call of turn.calls ?? []) {
      if (call.name === "ApplyPatch" && typeof call.arguments?.input !== "string") {
        throw new Error(`turn ${index}: ApplyPatch arguments need a string input`);
      }
    }
  }
}

// A scripted call may hold {{match:PATTERN}} in its string arguments: the text becomes the first group of PATTERN in the request
// that the turn answers, so a call can use an id an earlier tool result gave (for example "Shell ID: (\d+)").
function resolveTurn(turn, body) {
  if (!Array.isArray(turn.calls)) return turn;
  const text = JSON.stringify(body);
  const fill = (value) => {
    if (typeof value === "string") {
      return value.replace(/\{\{match:(.+?)\}\}/g, (_whole, source) => {
        const found = new RegExp(source).exec(text);
        if (found === null || found[1] === undefined) throw new Error(`no match for /${source}/ in the request`);
        return found[1];
      });
    }
    if (Array.isArray(value)) return value.map(fill);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
    return value;
  };
  return { ...turn, calls: turn.calls.map((call) => ({ ...call, arguments: fill(call.arguments) })) };
}

// Codex Responses SSE: every event carries its type in the data JSON, as the Codex backend sends it.
function codexSse(turn, index, model) {
  const events = [];
  const output = [];
  const emit = (event) => events.push(event);
  const responseFor = (status, fields = {}) => ({
    id: `resp_turn${index}`,
    object: "response",
    created_at: 0,
    model,
    status,
    error: null,
    output: [],
    ...fields,
  });
  emit({ type: "response.created", response: responseFor("in_progress") });
  emit({ type: "response.in_progress", response: responseFor("in_progress") });
  let outputIndex = 0;

  if (turn.reasoning !== undefined) {
    const id = `rs_turn${index}`;
    const item = {
      type: "reasoning",
      id,
      summary: [{ type: "summary_text", text: turn.reasoning }],
      encrypted_content: `fake-encrypted-reasoning-turn${index}`,
    };
    emit({ type: "response.output_item.added", output_index: outputIndex, item: { type: "reasoning", id, summary: [] } });
    emit({ type: "response.reasoning_summary_text.delta", item_id: id, output_index: outputIndex, summary_index: 0, delta: turn.reasoning });
    emit({ type: "response.output_item.done", output_index: outputIndex, item });
    output.push(item);
    outputIndex += 1;
  }

  if (turn.compaction !== undefined) {
    // The remote compaction item: the only output of a compaction request, reported as the Codex stream reports it.
    const id = turn.compaction.id ?? `cmp_turn${index}`;
    const item = {
      type: "compaction",
      id,
      encrypted_content: turn.compaction.encrypted_content ?? `fake-encrypted-compaction-turn${index}`,
    };
    emit({ type: "response.output_item.added", output_index: outputIndex, item: { type: "compaction", id, encrypted_content: "" } });
    emit({ type: "response.output_item.done", output_index: outputIndex, item });
    output.push(item);
    outputIndex += 1;
  }

  for (const [callIndex, call] of (turn.calls ?? []).entries()) {
    const callId = `call_turn${index}_${callIndex}`;
    if (call.name === "ApplyPatch") {
      const id = `ctc_turn${index}_${callIndex}`;
      const input = call.arguments.input;
      emit({
        type: "response.output_item.added",
        output_index: outputIndex,
        item: { type: "custom_tool_call", id, call_id: callId, name: call.name, input: "", status: "in_progress" },
      });
      emit({ type: "response.custom_tool_call_input.delta", item_id: id, output_index: outputIndex, delta: input });
      emit({ type: "response.custom_tool_call_input.done", item_id: id, output_index: outputIndex, input });
      const item = { type: "custom_tool_call", id, call_id: callId, name: call.name, input, status: "completed" };
      emit({ type: "response.output_item.done", output_index: outputIndex, item });
      output.push(item);
    } else {
      const id = `fc_turn${index}_${callIndex}`;
      const args = JSON.stringify(call.arguments);
      emit({
        type: "response.output_item.added",
        output_index: outputIndex,
        item: { type: "function_call", id, call_id: callId, name: call.name, arguments: "", status: "in_progress" },
      });
      emit({ type: "response.function_call_arguments.delta", item_id: id, output_index: outputIndex, delta: args });
      emit({ type: "response.function_call_arguments.done", item_id: id, output_index: outputIndex, arguments: args });
      const item = { type: "function_call", id, call_id: callId, name: call.name, arguments: args, status: "completed" };
      emit({ type: "response.output_item.done", output_index: outputIndex, item });
      output.push(item);
    }
    outputIndex += 1;
  }

  if (turn.text !== undefined) {
    const id = `msg_turn${index}`;
    const part = { type: "output_text", text: turn.text, annotations: [] };
    emit({
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { type: "message", id, role: "assistant", status: "in_progress", content: [] },
    });
    emit({ type: "response.content_part.added", item_id: id, output_index: outputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
    emit({ type: "response.output_text.delta", item_id: id, output_index: outputIndex, content_index: 0, delta: turn.text });
    emit({ type: "response.output_text.done", item_id: id, output_index: outputIndex, content_index: 0, text: turn.text });
    emit({ type: "response.content_part.done", item_id: id, output_index: outputIndex, content_index: 0, part });
    const item = { type: "message", id, role: "assistant", status: "completed", phase: "final_answer", content: [part] };
    emit({ type: "response.output_item.done", output_index: outputIndex, item });
    output.push(item);
  }

  const usage = {
    input_tokens: turn.usage?.input_tokens ?? 1,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 1,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: (turn.usage?.input_tokens ?? 1) + 1,
  };
  emit({ type: "response.completed", response: responseFor("completed", { output, usage }) });
  return events
    .map((event, sequence) => `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: sequence })}\n\n`)
    .join("");
}

// Anthropic Messages SSE: named events with the data JSON that the SDK parses.
function anthropicSse(turn, index, model) {
  const events = [];
  const emit = (name, data) => events.push([name, data]);
  emit("message_start", {
    type: "message_start",
    message: {
      id: `msg_turn${index}`,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: turn.usage?.input_tokens ?? 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
  let blockIndex = 0;
  for (const [callIndex, call] of (turn.calls ?? []).entries()) {
    emit("content_block_start", {
      type: "content_block_start",
      index: blockIndex,
      content_block: { type: "tool_use", id: `toolu_turn${index}_${callIndex}`, name: call.name, input: {} },
    });
    emit("content_block_delta", {
      type: "content_block_delta",
      index: blockIndex,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(call.arguments) },
    });
    emit("content_block_stop", { type: "content_block_stop", index: blockIndex });
    blockIndex += 1;
  }
  if (turn.text !== undefined) {
    emit("content_block_start", { type: "content_block_start", index: blockIndex, content_block: { type: "text", text: "" } });
    emit("content_block_delta", { type: "content_block_delta", index: blockIndex, delta: { type: "text_delta", text: turn.text } });
    emit("content_block_stop", { type: "content_block_stop", index: blockIndex });
  }
  emit("message_delta", {
    type: "message_delta",
    delta: { stop_reason: turn.text === undefined ? "tool_use" : "end_turn", stop_sequence: null },
    usage: { output_tokens: 1 },
  });
  emit("message_stop", { type: "message_stop" });
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

// Serves one script. Request N is answered with turns[N - 1]; a request past the script gets a plain answer and an error.
export async function startFakeProvider({ provider, turns }) {
  if (PATHS[provider] === undefined) throw new Error(`unsupported provider ${provider}`);
  validateTurns(turns, provider);
  const requests = [];
  const errors = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let record;
      try {
        record = recordRequest(req, Buffer.concat(chunks));
      } catch (error) {
        errors.push(error);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return;
      }
      requests.push(record);
      if (!record.path.split("?")[0].endsWith(PATHS[provider])) {
        errors.push(new Error(`request ${requests.length} went to ${record.path}, expected ${PATHS[provider]}`));
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }
      const index = requests.length - 1;
      if (index >= turns.length) errors.push(new Error(`request ${requests.length} has no scripted turn`));
      let turn;
      try {
        turn = resolveTurn(turns[index] ?? { text: UNSCRIPTED_TEXT }, record.body);
      } catch (error) {
        errors.push(error);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return;
      }
      const model = typeof record.body?.model === "string" ? record.body.model : "unknown";
      const body = provider === "openai-codex" ? codexSse(turn, index, model) : anthropicSse(turn, index, model);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(body);
    });
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    errors,
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
