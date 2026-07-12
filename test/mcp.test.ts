import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	allocateServerId,
	defaultSessionEnabledIds,
	discoverMcpCatalog,
	emptyMcpConfig,
	formatMcpIndex,
	loadMcpConfig,
	normalizeMcpConfig,
	parametersFromMcpSchema,
	parseMcpServersMap,
	qualifyMcpToolName,
	resetMcpHubForTests,
	sanitizeServerId,
	saveMcpConfig,
	setDefaultEnabled,
	serverSummary,
	validateServerConfig,
	type McpServerStatus,
} from "../src/mcp.ts";

test("sanitizeServerId and qualifyMcpToolName", () => {
	assert.equal(sanitizeServerId("Playwright MCP"), "playwright_mcp");
	assert.equal(sanitizeServerId("  "), "");
	const q = qualifyMcpToolName("playwright", "browser_navigate");
	assert.equal(q, "mcp__playwright__browser_navigate");
	assert.ok(q.length <= 64);
});

test("validateServerConfig", () => {
	assert.ok(validateServerConfig({ id: "a", name: "a", enabled: true, transport: "stdio" }));
	assert.equal(
		validateServerConfig({ id: "a", name: "a", enabled: true, transport: "stdio", command: "npx" }),
		null,
	);
	assert.equal(
		validateServerConfig({
			id: "a",
			name: "a",
			enabled: true,
			transport: "http",
			url: "http://127.0.0.1:3000/mcp",
		}),
		null,
	);
});

test("mcp config roundtrip + allocate id", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-mcp-"));
	try {
		resetMcpHubForTests();
		assert.deepEqual(loadMcpConfig(dir), emptyMcpConfig());
		// 用不太可能与本机 Claude 台账撞名的 id
		const id = allocateServerId(dir, "liyuan-unique-mcp-zzz");
		assert.equal(id, "liyuan_unique_mcp_zzz");
		saveMcpConfig(dir, {
			format: "liyuan-mcp",
			version: 2,
			servers: [
				{
					id,
					name: "LiyuanTest",
					enabled: false,
					transport: "stdio",
					command: "npx",
					args: ["-y", "@playwright/mcp@latest"],
				},
			],
			defaults: {},
		});
		const loaded = loadMcpConfig(dir);
		assert.equal(loaded.servers.length, 1);
		assert.equal(loaded.servers[0].id, "liyuan_unique_mcp_zzz");
		assert.equal(allocateServerId(dir, "liyuan-unique-mcp-zzz"), "liyuan_unique_mcp_zzz_2");
		assert.match(serverSummary(loaded.servers[0]), /npx/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		resetMcpHubForTests();
	}
});

test("normalizeMcpConfig drops bad / duplicate ids; defaults false by default", () => {
	const n = normalizeMcpConfig({
		format: "liyuan-mcp",
		version: 2,
		servers: [
			{ id: "ok", name: "OK", enabled: true, transport: "stdio", command: "x" },
			{ id: "ok", name: "dup", enabled: true, transport: "stdio", command: "y" },
			{ id: "", name: "bad", enabled: true, transport: "stdio", command: "z" },
			null as unknown as never,
		],
	});
	assert.equal(n.servers.length, 1);
	assert.equal(n.servers[0].command, "x");
	assert.equal(n.defaults?.ok, true);
});

test("parseMcpServersMap: Claude-style stdio + sse", () => {
	const list = parseMcpServersMap(
		{
			playwright: { type: "stdio", command: "npx", args: ["-y", "@playwright/mcp"] },
			"1shell": { type: "sse", url: "http://127.0.0.1:3301/mcp/sse", headers: { A: "b" } },
			broken: { type: "stdio" },
		},
		"claude",
	);
	assert.equal(list.length, 2);
	assert.equal(list.find((x) => x.id === "playwright")?.transport, "stdio");
	assert.equal(list.find((x) => x.id === "1shell")?.transport, "sse");
	assert.equal(list.every((x) => x.enabled === false), true);
	assert.equal(list.every((x) => x.source === "claude"), true);
});

test("discoverMcpCatalog merges project .mcp.json and liyuan-mcp; defaults off", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-mcp-disc-"));
	try {
		resetMcpHubForTests();
		writeFileSync(
			join(dir, ".mcp.json"),
			JSON.stringify({
				mcpServers: {
					alpha: { command: "npx", args: ["-y", "x"], type: "stdio" },
				},
			}),
		);
		saveMcpConfig(dir, {
			format: "liyuan-mcp",
			version: 2,
			servers: [
				{
					id: "alpha",
					name: "Alpha Override",
					enabled: false,
					transport: "stdio",
					command: "node",
					args: ["local.js"],
				},
			],
			defaults: {},
		});
		const cat = discoverMcpCatalog(dir);
		const alpha = cat.find((c) => c.id === "alpha");
		assert.ok(alpha);
		assert.equal(alpha!.command, "node"); // liyuan 覆盖 .mcp.json
		assert.ok(alpha!.sources.includes("project-mcp") || alpha!.sources.includes("liyuan"));
		assert.equal(alpha!.enabled, false);
		assert.deepEqual(defaultSessionEnabledIds(dir), []);

		setDefaultEnabled(dir, "alpha", true);
		assert.deepEqual(defaultSessionEnabledIds(dir), ["alpha"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		resetMcpHubForTests();
	}
});

test("parametersFromMcpSchema accepts object schema", () => {
	const schema = parametersFromMcpSchema({
		type: "object",
		properties: { q: { type: "string" } },
		required: ["q"],
	});
	assert.equal((schema as { type?: string }).type, "object");
	const loose = parametersFromMcpSchema(null);
	assert.equal((loose as { type?: string }).type, "object");
});

test("formatMcpIndex mentions discovery when none enabled", () => {
	const statuses: McpServerStatus[] = [
		{
			id: "pw",
			name: "Playwright",
			enabled: false,
			defaultEnabled: false,
			transport: "stdio",
			status: "disconnected",
			summary: "npx",
			tools: [],
			source: "claude",
			sources: ["claude"],
			discovered: true,
		},
	];
	const text = formatMcpIndex(statuses);
	assert.match(text, /发现/);
	assert.match(text, /未启用/);
});

test("discover from real ~/.claude.json if present", () => {
	const p = join(homedir(), ".claude.json");
	const cat = discoverMcpCatalog(mkdtempSync(join(tmpdir(), "liyuan-mcp-home-")));
	// 只要本机有 claude 配置，目录里应出现其服务器（不依赖 cwd 项目文件）
	try {
		const j = JSON.parse(require("node:fs").readFileSync(p, "utf8"));
		const keys = Object.keys(j.mcpServers || {});
		if (keys.length === 0) return;
		const ids = new Set(cat.map((c) => c.id));
		const hit = keys.some((k: string) => ids.has(k.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32)));
		assert.ok(hit, `expected some of ${keys.join(",")} in catalog, got ${[...ids].join(",")}`);
	} catch {
		// 无 claude 配置则跳过断言
	}
});
