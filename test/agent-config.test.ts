import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	applyEntryThinkingMap,
	enableProfile,
	findModelEntry,
	type LiyuanAgentConfig,
	mergeModelEntries,
	modelEntryKey,
	modelsForRuntime,
	normalizeAgentConfig,
	saveAgentConfig,
	seedProviderFromRuntime,
	loadAgentConfig,
	saveProfile,
	syncAgentConfigToRuntime,
} from "../src/agent-config.ts";

function makeTmpDir(): string {
	const d = mkdtempSync(join(tmpdir(), "agent-cfg-"));
	return d;
}

function writeConfig(cwd: string, config: LiyuanAgentConfig): void {
	writeFileSync(join(cwd, "liyuan.agent.json"), JSON.stringify(config, null, "\t"), "utf8");
}

test("mergeModelEntries：保留旧条目的 compat 等额外字段", () => {
	const old = [
		{ id: "deepseek/deepseek-v4-flash", reasoning: true, compat: { supportsDeveloperRole: false, thinkingFormat: "deepseek" } },
	];
	const incoming = [
		{ id: "deepseek/deepseek-v4-flash", reasoning: true, contextWindow: 1000000 },
	];
	const merged = mergeModelEntries(old, incoming);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].id, "deepseek/deepseek-v4-flash");
	assert.equal(merged[0].contextWindow, 1000000); // 新值生效
	assert.deepEqual(merged[0].compat, { supportsDeveloperRole: false, thinkingFormat: "deepseek" }); // 旧值保留
});

test("mergeModelEntries：incoming 的显式值覆盖旧值", () => {
	const old = [{ id: "m1", contextWindow: 8000, compat: { foo: true } }];
	const incoming = [{ id: "m1", contextWindow: 128000, compat: { foo: false } }];
	const merged = mergeModelEntries(old, incoming);
	assert.equal(merged[0].contextWindow, 128000);
	assert.deepEqual(merged[0].compat, { foo: false });
});

test("seedProviderFromRuntime：传入的额外字段不丢失", () => {
	const provider = seedProviderFromRuntime({
		provider: "deepseek",
		baseUrl: "https://api.deepseek.com/v1",
		api: "openai-completions",
		models: [
			{
				id: "deepseek/deepseek-v4-flash",
				reasoning: true,
				contextWindow: 1000000,
				maxTokens: 384000,
				compat: { supportsDeveloperRole: false, thinkingFormat: "deepseek" },
				cost: { input: 0.14, output: 0.28 },
				thinkingLevelMap: { off: null, max: "max" },
			} as any,
		],
	});
	const m = provider.models![0];
	assert.equal(m.id, "deepseek/deepseek-v4-flash");
	assert.deepEqual(m.compat, { supportsDeveloperRole: false, thinkingFormat: "deepseek" });
	assert.deepEqual(m.cost, { input: 0.14, output: 0.28 });
	assert.deepEqual(m.thinkingLevelMap, { off: null, max: "max" });
});

test("enableProfile：磁盘上的 model compat 在启用 profile 后保留", () => {
	const cwd = makeTmpDir();
	try {
		// 磁盘上已有含 compat 的配置
		writeConfig(cwd, {
			version: 1,
			defaultProvider: "deepseek",
			defaultModel: "deepseek/deepseek-v4-flash",
			providers: {
				deepseek: {
					baseUrl: "https://api.deepseek.com/v1",
					api: "openai-completions",
					apiKey: "sk-test",
					models: [{ id: "deepseek/deepseek-v4-flash", reasoning: true, compat: { supportsDeveloperRole: false } }],
				},
			},
		});
		// 仓库里的 profile 没有 compat（保存时还没加）
		saveProfile(cwd, "deepseek", "deepseek", {
			version: 1,
			defaultProvider: "deepseek",
			defaultModel: "deepseek/deepseek-v4-flash",
			providers: {
				deepseek: {
					baseUrl: "https://api.deepseek.com/v1",
					api: "openai-completions",
					apiKey: "sk-test",
					models: [{ id: "deepseek/deepseek-v4-flash", reasoning: true }],
				},
			},
		});
		// 用一个 dummy agentDir（enableProfile 不需要真实 agentDir，syncAgentConfigToRuntime 只写文件）
		const agentDir = join(cwd, ".liyuan", "agent");
		mkdirSync(agentDir, { recursive: true });
		enableProfile(cwd, agentDir, "deepseek");
		// 重读磁盘上的 liyuan.agent.json
		const after = loadAgentConfig(cwd).config;
		const m = after.providers.deepseek?.models?.[0];
		assert.ok(m, "model entry should exist");
		assert.deepEqual(m.compat, { supportsDeveloperRole: false }, "compat should survive enableProfile");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("normalizeAgentConfig：model 上的 compat 原样保留", () => {
	const raw = {
		version: 1,
		providers: {
			test: {
				baseUrl: "https://example.com",
				models: [
					{ id: "m1", compat: { supportsDeveloperRole: false, maxTokensField: "max_tokens" } },
				],
			},
		},
	};
	const cfg = normalizeAgentConfig(raw);
	assert.deepEqual(cfg.providers.test.models![0].compat, { supportsDeveloperRole: false, maxTokensField: "max_tokens" });
});

test("saveAgentConfig → loadAgentConfig 往返保留 model compat", () => {
	const cwd = makeTmpDir();
	try {
		const config: LiyuanAgentConfig = {
			version: 1,
			defaultProvider: "ds",
			providers: {
				ds: {
					baseUrl: "https://api.deepseek.com/v1",
					apiKey: "sk-test",
					models: [{ id: "m1", compat: { supportsDeveloperRole: false }, thinkingLevelMap: { off: null } }],
				},
			},
		};
		saveAgentConfig(cwd, config);
		const loaded = loadAgentConfig(cwd).config;
		assert.deepEqual(loaded.providers.ds.models![0].compat, { supportsDeveloperRole: false });
		assert.deepEqual(loaded.providers.ds.models![0].thinkingLevelMap, { off: null });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

/* ---------- 同一个模型多条条目（各带各的思考档） ---------- */

test("条目身份：label 优先，没起名回落 id", () => {
	assert.equal(modelEntryKey({ id: "flash" }), "flash");
	assert.equal(modelEntryKey({ id: "flash", label: "flash off" }), "flash off");
	// 空白 label 不算起过名
	assert.equal(modelEntryKey({ id: "flash", label: "   " }), "flash");
});

test("normalizeAgentConfig：同 id 的多条条目一条都不丢，label 各自保留", () => {
	const cfg = normalizeAgentConfig({
		version: 1,
		providers: {
			opencode: {
				models: [
					{ id: "flash", label: "flash high", thinkingLevel: "high" },
					{ id: "flash", label: "flash off", thinkingLevel: "off" },
					{ id: "pro", thinkingLevel: "high" },
				],
			},
		},
	});
	const list = cfg.providers.opencode.models!;
	assert.equal(list.length, 3, "三条条目全在——同 id 不许被并掉");
	assert.deepEqual(list.map((m) => modelEntryKey(m)), ["flash high", "flash off", "pro"]);
	assert.equal(findModelEntry(list, "flash off")!.thinkingLevel, "off");
	assert.equal(findModelEntry(list, "flash high")!.thinkingLevel, "high");
	assert.equal(findModelEntry(list, "不存在"), undefined);
});

test("normalizeModelEntry：空 label 不留键（免得配置里一堆没用的空字段）", () => {
	const cfg = normalizeAgentConfig({
		version: 1,
		providers: { p: { models: [{ id: "m", label: "  " }] } },
	});
	assert.ok(!("label" in cfg.providers.p.models![0]), "空 label 应当被删掉");
});

test("mergeModelEntries：按条目配对，不把 high 那条的字段灌进 off 那条", () => {
	const old = [
		{ id: "flash", label: "flash high", thinkingLevel: "high", compat: { a: 1 } },
		{ id: "flash", label: "flash off", thinkingLevel: "off", compat: { b: 2 } },
	];
	const incoming = [
		{ id: "flash", label: "flash high", thinkingLevel: "high" },
		{ id: "flash", label: "flash off", thinkingLevel: "off" },
	];
	const merged = mergeModelEntries(old, incoming);
	assert.equal(merged.length, 2);
	assert.deepEqual(merged[0].compat, { a: 1 });
	assert.deepEqual(merged[1].compat, { b: 2 }, "off 那条拿回的必须是它自己的 compat");
});

test("modelsForRuntime：按 id 收成一条，取第一条", () => {
	const out = modelsForRuntime([
		{ id: "flash", label: "flash high", thinkingLevel: "high" },
		{ id: "flash", label: "flash off", thinkingLevel: "off" },
		{ id: "pro", thinkingLevel: "high" },
	]);
	assert.deepEqual(out.map((m) => m.id), ["flash", "pro"]);
	assert.equal(out[0].thinkingLevel, "high", "取第一条");
	// thinkingLevel 这个键必须还在：运行时靠它的**存在**把模型标成 reasoning
	//（packages/coding-agent/src/core/model-registry.ts:664-668 的梨园补丁），删了等于关死思考
	assert.ok("thinkingLevel" in out[0]);
});

test("syncAgentConfigToRuntime：写进 models.json 的清单已按 id 收敛，配置本身不动", () => {
	const cwd = makeTmpDir();
	try {
		const agentDir = join(cwd, ".liyuan", "agent");
		mkdirSync(agentDir, { recursive: true });
		const config: LiyuanAgentConfig = {
			version: 1,
			defaultProvider: "opencode",
			defaultModel: "flash",
			defaultModelEntry: "flash off",
			providers: {
				opencode: {
					baseUrl: "https://example.com",
					api: "openai-completions",
					apiKey: "sk-test",
					models: [
						{ id: "flash", label: "flash high", thinkingLevel: "high" },
						{ id: "flash", label: "flash off", thinkingLevel: "off" },
					],
				},
			},
		};
		syncAgentConfigToRuntime(cwd, agentDir, config);
		const runtime = JSON.parse(readFileSync(join(agentDir, "models.json"), "utf8")) as {
			providers: Record<string, { models: Array<{ id: string }> }>;
		};
		assert.equal(runtime.providers.opencode.models.length, 1, "运行时清单里一个 id 只能有一条");
		// 梨园自己那份配置仍是两条
		saveAgentConfig(cwd, config);
		assert.equal(loadAgentConfig(cwd).config.providers.opencode.models!.length, 2);
		assert.equal(loadAgentConfig(cwd).config.defaultModelEntry, "flash off", "剧情模型指向哪条条目要存得住");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("旁路条目：thinkingLevelMap 盖回运行时模型（同 id 多条被投影收干净的情形）", () => {
	// 真实故障形状：同 id 两条，map 挂在第二条；modelsForRuntime 按 id 只留第一条 → map 丢
	const models = [
		{ id: "qwen3.8-27b", thinkingLevel: "medium" },
		{ id: "qwen3.8-27b", label: "qwen3.8-27b-nothinking", thinkingLevel: "off", thinkingLevelMap: { off: "none" }, reasoning: true },
	];
	const runtimeModels = modelsForRuntime(models);
	assert.equal(runtimeModels.length, 1, "投影按 id 收敛");
	assert.equal(runtimeModels[0]!.thinkingLevelMap, undefined, "第一条本来没有 map——这就是故障来源");

	const entry = findModelEntry(models, "qwen3.8-27b-nothinking")!;
	const patched = applyEntryThinkingMap(runtimeModels[0] as { thinkingLevelMap?: Record<string, unknown> }, entry);
	assert.deepEqual(patched.thinkingLevelMap, { off: "none" }, "旁路条目自己的 map 必须补回来，否则 reasoning:off 折成 undefined、请求不带 reasoning_effort");
	assert.equal((runtimeModels[0] as { thinkingLevelMap?: unknown }).thinkingLevelMap, undefined, "纯函数：不改入参");
});

test("旁路条目：无 map 时原样返回同一个对象（不改动旧行为）", () => {
	const base = { id: "m", thinkingLevelMap: { low: "low" } };
	assert.equal(applyEntryThinkingMap(base, { id: "m" }), base);
	assert.equal(applyEntryThinkingMap(base, null), base);
	assert.equal(applyEntryThinkingMap(base, { id: "m", thinkingLevelMap: "bogus" as unknown as Record<string, unknown> }), base, "脏值当没有");
});

test("旁路条目：条目 map 与运行时已有 map 合并，条目优先", () => {
	const base = { id: "m", thinkingLevelMap: { off: "minimal", high: "high" } };
	const out = applyEntryThinkingMap(base, { id: "m", thinkingLevelMap: { off: "none" } });
	assert.deepEqual(out.thinkingLevelMap, { off: "none", high: "high" });
});
