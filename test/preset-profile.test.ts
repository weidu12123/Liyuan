import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadPresetDoc } from "../src/preset-doc.ts";
import { detectPresetBreakthroughProfile } from "../src/stage/preset-profile.ts";

test("preset-profile：无预设或关停开关恒走 direct 零影响", () => {
	assert.equal(detectPresetBreakthroughProfile(null).mode, "direct");
	assert.equal(detectPresetBreakthroughProfile(null, { breakthroughRelay: "always" }).mode, "two-phase-bridge");

	const heavyRaw = {
		squash_system_messages: true,
		assistant_prefill: "继续",
		prompts: [{ identifier: "p1", name: "p1", role: "assistant", content: "pre" }],
		prompt_order: [{ character_id: 100001, order: [{ identifier: "p1", enabled: true }] }],
	};
	const doc = loadPresetDoc(heavyRaw, "heavy");
	assert.equal(detectPresetBreakthroughProfile(doc, { breakthroughRelay: "off" }).mode, "direct");
	assert.equal(detectPresetBreakthroughProfile(doc, { breakthroughRelay: "auto" }).mode, "two-phase-bridge");
});

test("preset-profile：纯文本普通预设归 direct；仅开压平或无假工具请求脚本归 channel-proxy", () => {
	const plainDoc = loadPresetDoc(
		{
			prompts: [{ identifier: "main", name: "文风", role: "system", content: "写自然一点。" }],
			prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
		},
		"plain",
	);
	assert.equal(detectPresetBreakthroughProfile(plainDoc).mode, "direct");

	const squashDoc = loadPresetDoc(
		{
			squash_system_messages: true,
			prompts: [{ identifier: "main", name: "文风", role: "system", content: "写自然一点。" }],
			prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }] }],
		},
		"squash-only",
	);
	assert.equal(detectPresetBreakthroughProfile(squashDoc).mode, "channel-proxy");
});

test("preset-profile：校验本地真实预设各自命中的精确执行档位", () => {
	const expected: Record<string, "direct" | "channel-proxy" | "two-phase-bridge"> = {
		"Meowssiah_1.9.12.json": "two-phase-bridge",
		"Reborn2.3.json": "two-phase-bridge",
		"我即浪潮-1109-Amour.json": "two-phase-bridge",
		"梦鲸思客V5-1030-exp.json": "two-phase-bridge",
		"梦鲸思客V4-0915.json": "two-phase-bridge",
		"[主预设]-V19.7.7-狐神抚-·-毓忻.json": "two-phase-bridge",
		"双人成行v10.0—青云上-(1).json": "two-phase-bridge",
		"Ny-Gemini-1.4.5_SogonSigon_1.json": "direct",
		"TGbreak😺V2.1.6.json": "channel-proxy",
		"夏瑾-V2.01.json": "direct",
	};

	for (const [file, wantMode] of Object.entries(expected)) {
		const path = join(process.cwd(), "assets", "presets", file);
		if (!existsSync(path)) continue;
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const doc = loadPresetDoc(raw, file.replace(/\.json$/i, ""));
		const prof = detectPresetBreakthroughProfile(doc);
		assert.equal(prof.mode, wantMode, `${file} 期望 ${wantMode}，实得 ${prof.mode}（reasons=${prof.reasons.join(",")})`);
	}
});
