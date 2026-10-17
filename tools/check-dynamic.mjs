#!/usr/bin/env bun
// Checks Cursor Pi's dynamic tools against Cursor's own functions, run through tools/cursor-oracle.mjs from the extracted
// bundle. E1 renders the <dynamic_tool_catalog> section for the first-party registry and a stdio MCP fixture server, and
// compares it byte for byte with Cursor's McpMetaToolServersSection. E2 compares GetDynamicTools output with Cursor's
// payload functions for the same descriptors, asserts CallDynamicTool results, and compares argument repair with Cursor's
// parseArgumentsLeniently. The fixture server is written to the OS temp folder and talks to this check over stdio, and the
// check runs with its own HOME so large results land in a temp folder, not in the real ~/.cursor-pi.
// Usage: bun tools/check-dynamic.mjs

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initModule, loadCursor } from "./cursor-oracle.mjs";
import { dynamicToolCatalogSection } from "../extensions/cursor-pi/dynamic/catalog.ts";
import { parseArgumentsLeniently } from "../extensions/cursor-pi/dynamic/argument-repair.ts";
import { capturedConciseInstruction, capturedCursorUseInstructions } from "../extensions/cursor-pi/dynamic/captured-instructions.ts";
import { registerFetchMcpResource } from "../extensions/cursor-pi/dynamic/fetch-mcp-resource.ts";
import { dynamicNamespaces } from "../extensions/cursor-pi/dynamic/namespaces.ts";
import { registerMcpSource } from "../extensions/cursor-pi/dynamic/mcp-source.ts";
import { registerDynamicNamespace, registerDynamicTool } from "../extensions/cursor-pi/dynamic/registry.ts";
import { renderContent } from "../extensions/cursor-pi/rules.ts";
import { executeCallDynamicTool } from "../extensions/cursor-pi/tools/call-dynamic-tool.ts";
import { executeGetDynamicTools } from "../extensions/cursor-pi/tools/get-dynamic-tools.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURSOR_NAMESPACE_DIR = join(ROOT, "research", "cursor", "reverse", "prompts", "tools", "cursor-namespace");
const require = createRequire(join(ROOT, "package.json"));
const sdkUrl = (subpath) => pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/${subpath}`)).href;
// A 1x1 PNG, returned by the fixture's picture tool.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const CONTEXT = { cwd: ROOT };
// Cursor's maybeWriteToFile threshold: a larger result is written to an agent-tools file and the model gets a note.
const FILE_OUTPUT_THRESHOLD_BYTES = 12_000;
// The bundle modules whose top-level names the checks read. The first seven are the ones tools/check-context.mjs initializes.
const ORACLE_MODULES = [
	"../prompt-jsx/dist/render.js",
	"../shell-exec/dist/runtime-env/output-suppression.js",
	"../agent/dist/prompts/user-info.js",
	"../agent/dist/utils/cursor-rule-matching.js",
	"../agent/dist/tools/core/shell/prompts/git-sections.js",
	"../agent/dist/prompts/vega-frontend-user-rule.js",
	"../local-exec/dist/services/extensibility/cursor-rules-service.js",
	"../agent-exec/dist/mcp.js",
	"../agent/dist/tools/mcp/meta-tool-names.js",
	"../agent/dist/tools/mcp/builtin-tools.js",
	"../agent/dist/tools/mcp/dynamic-tool-argument-repair.js",
];

let passed = 0;
const failed = [];

function check(name, ok, detail = "") {
	if (ok) {
		passed += 1;
		console.log(`ok - ${name}`);
	} else {
		failed.push(name);
		console.log(`FAIL - ${name}${detail === "" ? "" : `\n${detail.slice(0, 600)}`}`);
	}
}

function same(name, ours, expected) {
	check(name, ours === expected, ours === expected ? "" : `ours:\n${ours}\nexpected:\n${expected}`);
}

// A captured cursor-namespace declaration: { tool, description, inputSchema } in the research folder.
async function capturedDeclaration(name) {
	const captured = JSON.parse(await readFile(join(CURSOR_NAMESPACE_DIR, `${name}.json`), "utf8"));
	return { type: "function", name: captured.tool, description: captured.description, parameters: captured.inputSchema };
}

const FIXTURE_SOURCE = [
	`import { Server } from ${JSON.stringify(sdkUrl("server/index.js"))};`,
	`import { StdioServerTransport } from ${JSON.stringify(sdkUrl("server/stdio.js"))};`,
	`import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(sdkUrl("types.js"))};`,
	`const PNG = ${JSON.stringify(PNG_BASE64)};`,
	`const server = new Server({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: "Fixture server for the dynamic tool checks." });`,
	`server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [`,
	`  { name: "echo", description: "Echoes the text argument.", inputSchema: { type: "object", properties: { text: { type: "string", description: "Text to echo." } }, required: ["text"] } },`,
	`  { name: "picture", description: "Returns a small PNG image.", inputSchema: { type: "object", properties: {} } },`,
	`  { name: "fail", description: "Always returns a tool error.", inputSchema: { type: "object", properties: {} } },`,
	`] }));`,
	`server.setRequestHandler(CallToolRequestSchema, async (request) => {`,
	`  const name = request.params.name;`,
	`  if (name === "echo") return { content: [{ type: "text", text: String(request.params.arguments?.text) }] };`,
	`  if (name === "picture") return { content: [{ type: "image", data: PNG, mimeType: "image/png" }] };`,
	`  return { content: [{ type: "text", text: "fixture failure" }], isError: true };`,
	`});`,
	`await server.connect(new StdioServerTransport());`,
	``,
].join("\n");

async function startFixtureServer() {
	const dir = await mkdtemp(join(tmpdir(), "cursor-pi-dynamic-check-"));
	const serverPath = join(dir, "fixture-server.mjs");
	await writeFile(serverPath, FIXTURE_SOURCE);
	const { Client } = await import(sdkUrl("client/index.js"));
	const { StdioClientTransport } = await import(sdkUrl("client/stdio.js"));
	const client = new Client({ name: "cursor-pi-check", version: "1.0.0" });
	await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath] }));
	return client;
}

// The fixture as an MCP namespace, in the shape McpWriter's listing returns: the server's instructions and its tools.
async function fixtureNamespace(client) {
	const { tools } = await client.listTools();
	return {
		name: "user-fixture",
		status: "ready",
		error: undefined,
		instructions: client.getInstructions()?.trim() || undefined,
		tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: undefined })),
	};
}

function fixtureSource(client, namespace) {
	return {
		async listMcpNamespaces() {
			return [namespace];
		},
		async callMcpTool(_namespace, toolName, args) {
			const result = await client.callTool({ name: toolName, arguments: args });
			const content = (result.content ?? []).map((block) =>
				block.type === "text" ? { type: "text", text: block.text } : { type: "image", data: block.data, mimeType: block.mimeType },
			);
			const text = content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n");
			return { content, isError: result.isError === true, text, structuredContent: undefined };
		},
		async readMcpResource() {
			throw new Error("the check does not read resources");
		},
	};
}

function oracleDescriptor(namespace) {
	return {
		serverIdentifier: namespace.name,
		serverUseInstructions: namespace.useInstructions,
		tools: namespace.tools.map((tool) => ({ toolName: tool.name })),
	};
}

// The server record Cursor's payload functions read: its descriptor, its status and its error.
function oracleServer(namespace) {
	return {
		descriptor: {
			serverIdentifier: namespace.name,
			serverName: namespace.name,
			serverUseInstructions: namespace.useInstructions,
			tools: namespace.tools.map((tool) => ({
				toolName: tool.name,
				description: tool.description,
				inputSchemaJson: tool.inputSchema === undefined ? undefined : JSON.stringify(tool.inputSchema),
			})),
		},
		status: namespace.status,
		errorMessage: namespace.error,
	};
}

const textOf = (result) =>
	result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");

const messageOf = (error) => error.modelVisibleErrorMessage ?? error.clientVisibleErrorMessage ?? error.message;

// Cursor's maybeWriteToFile: a payload over the threshold goes to an agent-tools file and the model gets its note. This
// returns the written content when the note matches the expected payload's size, so the payload itself is compared.
async function payloadOf(text, expected) {
	if (!text.startsWith('{\n  "note": "Large output has been written to: ')) return text;
	const note = JSON.parse(text);
	const bytes = Buffer.byteLength(expected, "utf8");
	const size = bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} bytes`;
	const written = await readFile(note.filePath, "utf8");
	const expectedNote = `Large output has been written to: ${note.filePath} (${size}, ${written.split("\n").length} lines)`;
	return note.note === expectedNote ? written : `note mismatch: ${note.note}`;
}

// Runs GetDynamicTools and returns its text, with an oversized payload read back from its file.
async function getOutput(args, expected) {
	return payloadOf(textOf(await executeGetDynamicTools(args, undefined, CONTEXT)), expected);
}

// The check's own HOME: Cursor Pi writes large results under it, and the real home must stay untouched.
process.env.HOME = await mkdtemp(join(tmpdir(), "cursor-pi-dynamic-home-"));

const client = await startFixtureServer();
try {
	const namespace = await fixtureNamespace(client);
	registerMcpSource(fixtureSource(client, namespace));
	registerDynamicNamespace("cursor", capturedCursorUseInstructions());
	for (const name of ["AwaitShell", "SwitchMode", "TodoWrite"]) {
		registerDynamicTool({
			namespace: "cursor",
			declaration: await capturedDeclaration(name),
			conciseInstructions: capturedConciseInstruction(name),
			async execute(args) {
				return { text: `${name} ran with ${JSON.stringify(args)}`, isError: false };
			},
		});
	}
	registerFetchMcpResource();

	const c = await loadCursor();
	for (const path of ORACLE_MODULES) initModule(c, path);
	const namespaces = await dynamicNamespaces(ROOT);
	const firstParty = namespaces.find((candidate) => candidate.firstParty);

	// E1: the catalog section, and the first-party header and composition, against Cursor's renderer.
	const ours = renderContent(dynamicToolCatalogSection(namespaces));
	const expectedSection = c.renderContent(
		c.jsx(c.McpMetaToolServersSection, {
			mcpMetaToolOptions: {
				enabled: true,
				mcpDescriptors: namespaces.map(oracleDescriptor),
				snapshotToolNames: { discoveryToolName: "GetDynamicTools", invocationToolName: "CallDynamicTool", useDynamicToolNamespaces: true },
			},
			mcpInfoComplete: true,
		}),
	);
	same("E1 catalog section matches Cursor's McpMetaToolServersSection", ours, expectedSection);
	check("E1 first-party header is Cursor's BUILTIN_TOOLS_SERVER_USE_INSTRUCTIONS", capturedCursorUseInstructions() === c.BUILTIN_TOOLS_SERVER_USE_INSTRUCTIONS);
	const registryTools = ["AwaitShell", "FetchMcpResource", "SwitchMode", "TodoWrite"].map((name) => {
		const concise = capturedConciseInstruction(name);
		return { name, contextType: concise === undefined ? undefined : { type: "dynamic", conciseStaticContext: concise } };
	});
	same("E1 first-party use instructions match Cursor's composition", firstParty.useInstructions, c.buildBuiltinToolsServerUseInstructions(registryTools));

	// E2: GetDynamicTools modes against Cursor's payload functions for the same descriptors.
	const servers = namespaces.map(oracleServer);
	const byName = (a, b) => a.descriptor.serverIdentifier.localeCompare(b.descriptor.serverIdentifier);
	const expectedCatalog = JSON.stringify(
		{ mode: "catalog", namespaces: [...servers].sort(byName).map((server) => c.toModelFacingServerPayload(c.descriptorToServerPayload(server), true)) },
		null,
		2,
	);
	same("E2 GetDynamicTools catalog", await getOutput({}, expectedCatalog), expectedCatalog);
	for (const ns of namespaces) {
		const expected = JSON.stringify(
			{
				mode: "namespace",
				...c.toModelFacingServerPayload(c.descriptorToServerPayload(oracleServer(ns), { includeSchema: true, trustedFirstParty: ns.firstParty, toolName: undefined }), true),
			},
			null,
			2,
		);
		same(`E2 GetDynamicTools namespace ${ns.name}`, await getOutput({ namespace: ns.name }, expected), expected);
	}
	for (const [ns, toolName] of [
		[firstParty, "TodoWrite"],
		[namespaces.find((candidate) => !candidate.firstParty), "echo"],
	]) {
		const payload = c.descriptorToServerPayload(oracleServer(ns), { includeSchema: true, trustedFirstParty: ns.firstParty, toolName });
		const expected = JSON.stringify(c.toModelFacingSingleToolPayload(payload, payload.tools[0], true), null, 2);
		same(`E2 GetDynamicTools tool ${ns.name}.${toolName}`, await getOutput({ namespace: ns.name, toolName }, expected), expected);
	}
	const search = JSON.parse(textOf(await executeGetDynamicTools({ pattern: "^echo$" }, undefined, CONTEXT)));
	check(
		"E2 GetDynamicTools search finds the fixture tool",
		search.mode === "search" && search.matches.some((m) => m.namespace === "user-fixture" && m.tool === "echo" && m.description === "Echoes the text argument."),
	);
	const expectedMissing = c.serverNotFoundError("nope", ["cursor", "user-fixture"], true);
	same("E2 GetDynamicTools unknown namespace", textOf(await executeGetDynamicTools({ namespace: "nope" }, undefined, CONTEXT)), `Error: ${messageOf(expectedMissing)}`);
	same("E2 GetDynamicTools toolName without namespace", textOf(await executeGetDynamicTools({ toolName: "echo" }, undefined, CONTEXT)), "Error: toolName requires namespace to be set.");
	same("E2 GetDynamicTools bad namespace type", textOf(await executeGetDynamicTools({ namespace: 5 }, undefined, CONTEXT)), "Error: Invalid arguments:\nserver: Expected string, received number");

	// E2: CallDynamicTool results and argument errors.
	const call = (args) => executeCallDynamicTool(args, undefined, CONTEXT);
	same("E2 CallDynamicTool runs a first-party tool", textOf(await call({ namespace: "cursor", toolName: "TodoWrite", arguments: { todos: [] } })), 'TodoWrite ran with {"todos":[]}');
	same(
		"E2 CallDynamicTool unknown first-party tool",
		textOf(await call({ namespace: "cursor", toolName: "Nope" })),
		'Error: Built-in tool "Nope" not found in namespace "cursor". Available tools: AwaitShell, FetchMcpResource, SwitchMode, TodoWrite. Use GetDynamicTools to discover their schemas.',
	);
	same("E2 CallDynamicTool unknown namespace", textOf(await call({ namespace: "nope", toolName: "echo" })), "Error: MCP server does not exist: nope. Use GetDynamicTools to discover available namespaces.");
	same("E2 CallDynamicTool unknown MCP tool", textOf(await call({ namespace: "user-fixture", toolName: "nope" })), "Error: Tool nope was not found. Use GetDynamicTools to discover available namespaces and their tools.");
	same("E2 CallDynamicTool bad namespace type", textOf(await call({ namespace: 5, toolName: "echo" })), "Error: Invalid arguments:\nserver: Expected string, received number");
	same("E2 CallDynamicTool missing identity", textOf(await call({ toolName: "echo" })), "Error: Missing required field: namespace. Re-issue the call with the tool's identity set; `arguments` alone does not identify the tool.");
	const failedCall = await call({ namespace: "user-fixture", toolName: "fail" });
	check("E2 CallDynamicTool passes an MCP tool error through as an error", failedCall.isError === true && textOf(failedCall) === "fixture failure");
	const picture = await call({ namespace: "user-fixture", toolName: "picture" });
	check("E2 CallDynamicTool returns an image block", picture.content.some((block) => block.type === "image" && block.data === PNG_BASE64 && block.mimeType === "image/png"));
	same("E2 CallDynamicTool reads stringified arguments", textOf(await call({ namespace: "user-fixture", toolName: "echo", arguments: '{"text":"hi"}' })), "hi");

	// E2: argument repair against Cursor's parseArgumentsLeniently.
	const samples = [
		'{"text":"hi"}',
		'{"text":"hi"}}',
		'{"text":"hi"}<parameter name="description">Say hi</parameter>',
		'{"text":"a"}{"text":"a"}',
		'{"text":"x",}',
		"not json",
		'{"text":"hi"} trailing',
		'{"a":{"b":1}}}',
		'{"text":"hi","text":"again"}',
	];
	for (const blob of samples) {
		same(`E2 argument repair ${JSON.stringify(blob)}`, JSON.stringify(parseArgumentsLeniently(blob) ?? null), JSON.stringify(c.parseArgumentsLeniently(blob) ?? null));
	}
} finally {
	await client.close();
}

console.log(`check-dynamic: ${passed} passed, ${failed.length} failed`);
process.exit(failed.length === 0 ? 0 : 1);
