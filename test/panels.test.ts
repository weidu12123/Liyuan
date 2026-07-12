import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	activePanels,
	closePanel,
	formatPanelIndex,
	loadPanels,
	PANEL_MAX_CHARS,
	PANEL_SOFT_LIMIT,
	savePanels,
	writePanel,
	type PanelMap,
} from "../src/panels.ts";

test("writePanel：新建/更新/同名重开归档面板", () => {
	let r = writePanel({}, { name: "地图", kind: "svg", content: "<svg viewBox='0 0 10 10'/>" });
	assert.ok(r.ok && r.created && !r.reopened && r.activeCount === 1);
	let panels = r.ok ? r.panels : {};

	r = writePanel(panels, { name: "地图", kind: "svg", content: "<svg viewBox='0 0 20 20'/>" });
	assert.ok(r.ok && !r.created && !r.reopened, "同名写入是更新不是新建");
	panels = r.ok ? r.panels : {};
	assert.ok(panels["地图"].content.includes("20 20"), "内容整体替换");

	const closed = closePanel(panels, "地图");
	assert.ok(closed.ok);
	panels = closed.ok ? closed.panels : {};
	assert.equal(activePanels(panels).length, 0, "归档后不在活跃列表");

	r = writePanel(panels, { name: "地图", kind: "markdown", content: "# 新地图" });
	assert.ok(r.ok && r.reopened, "同名重写唤回归档面板");
	panels = r.ok ? r.panels : {};
	assert.equal(panels["地图"].archived, undefined, "重写后归档标记清除");
	assert.equal(panels["地图"].kind, "markdown", "kind 可随重写改变");
});

test("writePanel：校验（空名/非法 kind/空内容/超长）", () => {
	assert.ok(!writePanel({}, { name: "  ", kind: "markdown", content: "x" }).ok);
	assert.ok(!writePanel({}, { name: "a", kind: "iframe", content: "x" }).ok, "非法 kind 拒绝");
	assert.ok(!writePanel({}, { name: "a", kind: "markdown", content: "  " }).ok, "空内容拒绝（收起走 panel_close）");
	assert.ok(!writePanel({}, { name: "a", kind: "markdown", content: "x".repeat(PANEL_MAX_CHARS + 1) }).ok);
});

test("writePanel：软上限只提醒不硬拦", () => {
	let panels: PanelMap = {};
	for (let i = 1; i <= PANEL_SOFT_LIMIT; i++) {
		const r = writePanel(panels, { name: `面板${i}`, kind: "markdown", content: "x" });
		assert.ok(r.ok && !r.overLimit, `第 ${i} 个不超限`);
		panels = r.panels;
	}
	const over = writePanel(panels, { name: "再来一个", kind: "markdown", content: "x" });
	assert.ok(over.ok, "超限仍写入成功（软上限是纪律不是门禁）");
	assert.ok(over.ok && over.overLimit, "但带超限标记");
});

test("closePanel：不存在/重复归档报错并列出现有面板", () => {
	const r = writePanel({}, { name: "线索板", kind: "markdown", content: "- 线索" });
	const panels = r.ok ? r.panels : {};
	const miss = closePanel(panels, "不存在的");
	assert.ok(!miss.ok && miss.error.includes("线索板"), "报错附现有面板名");
	const closed = closePanel(panels, "线索板");
	assert.ok(closed.ok);
	const again = closePanel(closed.ok ? closed.panels : {}, "线索板");
	assert.ok(!again.ok, "重复归档报错");
});

test("savePanels/loadPanels 往返保序；损坏/缺失文件回落空表", () => {
	const dir = mkdtempSync(join(tmpdir(), "rp-panels-"));
	try {
		const file = join(dir, "s1.json");
		let panels: PanelMap = {};
		for (const name of ["地图", "装备库", "线索板"]) {
			const r = writePanel(panels, { name, kind: "markdown", content: name });
			panels = r.ok ? r.panels : panels;
		}
		savePanels(file, panels);
		const loaded = loadPanels(file);
		assert.deepEqual(
			activePanels(loaded).map((p) => p.name),
			["地图", "装备库", "线索板"],
			"插入序即页签序",
		);
		assert.deepEqual(loadPanels(join(dir, "no-such.json")), {}, "缺失文件回落空表");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("formatPanelIndex：速览行；无活跃面板为 null", () => {
	assert.equal(formatPanelIndex({}), null);
	let r = writePanel({}, { name: "地图", kind: "svg", content: "<svg/>" });
	let panels = r.ok ? r.panels : {};
	r = writePanel(panels, { name: "装备库", kind: "markdown", content: "-" });
	panels = r.ok ? r.panels : {};
	assert.equal(formatPanelIndex(panels), "地图(svg)、装备库(markdown)");
});
