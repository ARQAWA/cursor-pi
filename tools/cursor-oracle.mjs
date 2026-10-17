// Loads the extracted Cursor Desktop agent bundle into a vm context so tests can call Cursor's own functions.
// The bundle is read from the OS temp folder at run time; no Cursor code is written into the repo.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const DEFAULT_DIR = path.join(os.tmpdir(), "cursor-3.25.6-f0df777c");
// The daemon starts at this line; the oracle cuts the bundle here so it never runs.
const DAEMON_ENTRY = /^var enteredAtMs = performance\.now\(\);/m;
const HOST_GLOBALS = [
  "process", "Buffer", "console", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
  "setImmediate", "queueMicrotask", "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
  "AbortController", "AbortSignal", "performance", "structuredClone", "fetch", "Headers", "Request",
  "Response", "WebAssembly", "crypto", "Intl",
  // Web event and stream classes; the bundle extends Event at module load (eventsource).
  "Event", "EventTarget", "MessageEvent", "CustomEvent", "DOMException", "Blob", "FormData",
  "ReadableStream", "WritableStream", "TransformStream", "BroadcastChannel", "MessageChannel", "WebSocket",
  "atob", "btoa",
];

const contexts = new Map();
// Bundle text per context, so initModule can find module markers without re-reading the file.
const sources = new WeakMap();

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createCursorContext(root) {
  const prettyPath = path.join(root, "pretty.js");
  let pretty;
  try {
    pretty = await readFile(prettyPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("Cursor bundle not extracted: run bun tools/extract-cursor.mjs");
    throw error;
  }
  const entry = DAEMON_ENTRY.exec(pretty);
  if (!entry) throw new Error(`no daemon entry line in ${prettyPath}`);
  const source = pretty.slice(0, entry.index);

  const sandbox = { require: createRequire(prettyPath) };
  for (const name of HOST_GLOBALS) sandbox[name] = globalThis[name];
  sandbox.globalThis = sandbox;
  // Node's alias for the global object, which parts of the bundle read.
  sandbox.global = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: prettyPath });
  sources.set(context, source);
  return context;
}

export async function loadCursor({ dir = DEFAULT_DIR } = {}) {
  const root = path.resolve(dir);
  if (!contexts.has(root)) {
    const loading = createCursorContext(root);
    contexts.set(root, loading);
    loading.catch(() => contexts.delete(root));
  }
  return contexts.get(root);
}

// Runs the module's init thunk once and returns the name of its variable in the bundle.
export function initModule(cursor, markerPath) {
  const source = sources.get(cursor);
  if (source === undefined) throw new Error("initModule needs a context returned by loadCursor");
  const pattern = new RegExp(`^var ([A-Za-z_$][\\w$]*) = __esm\\(\\{ "${escapeRegExp(markerPath)}"\\(\\) \\{`, "m");
  const match = pattern.exec(source);
  if (!match) throw new Error(`module not found in pretty.js: ${markerPath}`);
  const name = match[1];
  cursor[name]();
  return name;
}

if (import.meta.main) {
  const c = await loadCursor();
  initModule(c, "../agent/dist/prompts/vega-frontend-user-rule.js");
  initModule(c, "../prompt-jsx/dist/render.js");
  console.log(JSON.stringify(c.renderContent(c.jsx(c.RulesSection, {
    globalRules: [{ fullPath: "/w/AGENTS.md", content: "Use tabs." }],
    agentRequestableRules: [],
    userRules: [],
    composer2CustomUserRules: [],
  }))));
  console.log(c.truncateGitStatus("a\n".repeat(6000)).length);
}
