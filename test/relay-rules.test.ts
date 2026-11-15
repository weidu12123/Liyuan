import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseRelayRules, readRelayRules, relayRulesPath, seedRelayRules } from "../src/relay-rules.ts";
import { applyConfigPatch } from "../server/rest.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";

test("parseRelayRules：正确解析注释、词内打断项与替身替换项", () => {
	const raw = [
		"# 注释行",
		"",
		"短词",
		"较长目标词汇",
		"原词 => 替身",
		"长原词组 => 长替身词",
		"无效 => ",
		" => 无左",
		"同词 => 同词",
		"a",
	].join("\n");

	const parsed = parseRelayRules(raw);
	assert.deepEqual(parsed.splits, ["较长目标词汇", "短词"]);
	assert.deepEqual(parsed.replacements, [
		{ from: "长原词组", to: "长替身词" },
		{ from: "原词", to: "替身" },
	]);
});

test("seedRelayRules & readRelayRules：首次播种模板且不覆盖用户改写", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-relay-rules-"));
	const prevAgentDir = process.env.LIYUAN_CODING_AGENT_DIR;
	process.env.LIYUAN_CODING_AGENT_DIR = dir;
	try {
		seedRelayRules(dir);
		const seeded = readFileSync(relayRulesPath(), "utf8");
		assert.match(seeded, /RELAY_RULES\.txt/);
		assert.deepEqual(readRelayRules(), { splits: [], replacements: [] });

		const custom = "# 自定义\n禁止原词 => 安全替身\n敏感切片\n";
		writeFileSync(relayRulesPath(), custom, "utf8");
		seedRelayRules(dir);
		assert.equal(readFileSync(relayRulesPath(), "utf8"), custom, "已存在的规则文件不得被覆盖");
		const loaded = readRelayRules();
		assert.deepEqual(loaded.splits, ["敏感切片"]);
		assert.deepEqual(loaded.replacements, [{ from: "禁止原词", to: "安全替身" }]);
	} finally {
		if (prevAgentDir === undefined) delete process.env.LIYUAN_CODING_AGENT_DIR;
		else process.env.LIYUAN_CODING_AGENT_DIR = prevAgentDir;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("applyConfigPatch：relayPolicy 白名单正确放行 contextPackMode / scramble / googleSafetyOnOpenAi / jitterSampling", () => {
	const next = applyConfigPatch(DEFAULT_CONFIG, {
		relayPolicy: {
			contextPackMode: "tool-desc",
			antiRouteShield: "scramble",
			googleSafetyOnOpenAi: true,
			jitterSampling: true,
			badKey: "ignore",
		},
	});
	assert.deepEqual(next.relayPolicy, {
		contextPackMode: "tool-desc",
		antiRouteShield: "scramble",
		googleSafetyOnOpenAi: true,
		jitterSampling: true,
	});
});

