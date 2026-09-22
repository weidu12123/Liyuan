import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { seedStageSystemPrompt } from "../src/paths.ts";

const repoRoot = process.cwd();

/** 造一个最小假仓库（只要 assets/ 两份随包件在） */
const makeEnv = () => {
	const root = mkdtempSync(join(tmpdir(), "liyuan-seed-"));
	mkdirSync(join(root, "assets"), { recursive: true });
	mkdirSync(join(root, "assets", "SYSTEM.md".slice(0, 0)), { recursive: true });
	copyFileSync(join(repoRoot, "assets", "SYSTEM.md"), join(root, "assets", "SYSTEM.md"));
	copyFileSync(join(repoRoot, "assets", "APPEND_SYSTEM.md"), join(root, "assets", "APPEND_SYSTEM.md"));
	copyFileSync(join(repoRoot, "assets", "AGENT_APPEND_SYSTEM.md"), join(root, "assets", "AGENT_APPEND_SYSTEM.md"));
	const agentDir = join(root, "agent");
	return { root, agentDir };
};

test("全新环境：两份槽位都播种（SYSTEM=最小底座，APPEND=扮演定义默认值）", () => {
	const { root, agentDir } = makeEnv();
	try {
		seedStageSystemPrompt(root, agentDir);
		const sys = readFileSync(join(agentDir, "SYSTEM.md"), "utf8");
		const append = readFileSync(join(agentDir, "APPEND_SYSTEM.md"), "utf8");
		assert.ok(sys.length < 300, `底座应极简（实测 ${sys.length} 字）`);
		assert.ok(!sys.includes("一拍"), "底座不含行为规定");
		assert.ok(sys.includes("card workspace") || sys.includes("卡"), "底座只说环境事实");
		assert.ok(append.includes("## 一拍"), "扮演定义在 APPEND");
		assert.ok(append.includes("角色扮演 agent"), "身份定义在 APPEND");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("迁移：刀1 旧底座（扮演定义错位在 SYSTEM.md）→ 挪进 APPEND、底座换新", () => {
	const { root, agentDir } = makeEnv();
	try {
		// 刀1 旧版 SYSTEM.md 的开头签名＋节选正文（迁移只认开头签名，正文任意）
		const legacySystem =
			"你在 **梨园**（Liyuan）里担任角色扮演 agent。你不是编码助手：你的产出是剧情正文。\n\n" +
			"## 一拍\n\n用户发一次输入，你演一拍。\n\n## 记账不用你操心\n\n场记自动记。";
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "SYSTEM.md"), legacySystem, "utf8");

		seedStageSystemPrompt(root, agentDir);
		const sys = readFileSync(join(agentDir, "SYSTEM.md"), "utf8");
		const append = readFileSync(join(agentDir, "APPEND_SYSTEM.md"), "utf8");
		assert.ok(sys.length < 300, "SYSTEM.md 换成最小底座");
		assert.ok(!sys.includes("角色扮演"), "扮演定义不再在底座");
		assert.ok(append.includes("## 一拍"), "旧底座全文挪进 APPEND");
		assert.ok(append.includes("角色扮演 agent"), "身份定义保留");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("不越权：用户改写过的 SYSTEM.md 一字不动；已有 APPEND 不被覆盖", () => {
	const { root, agentDir } = makeEnv();
	try {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "SYSTEM.md"), "用户自己写的底座。", "utf8");
		writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), "用户自己的追加。", "utf8");
		seedStageSystemPrompt(root, agentDir);
		assert.equal(readFileSync(join(agentDir, "SYSTEM.md"), "utf8"), "用户自己写的底座。", "用户 SYSTEM.md 不动");
		assert.equal(readFileSync(join(agentDir, "APPEND_SYSTEM.md"), "utf8"), "用户自己的追加。", "用户 APPEND 不动");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("半迁移态：旧 SYSTEM.md + 用户已有 APPEND → 只换底座，APPEND 不覆盖（扮演定义以用户的为准）", () => {
	const { root, agentDir } = makeEnv();
	try {
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(agentDir, "SYSTEM.md"), "你在 **梨园**（Liyuan）里担任角色扮演 agent。旧版错位内容。", "utf8");
		writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), "用户自定义的扮演方式。", "utf8");
		seedStageSystemPrompt(root, agentDir);
		const sys = readFileSync(join(agentDir, "SYSTEM.md"), "utf8");
		assert.ok(sys.length < 300, "底座换新");
		assert.equal(readFileSync(join(agentDir, "APPEND_SYSTEM.md"), "utf8"), "用户自定义的扮演方式。", "APPEND 是用户的，不塞旧底座");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("agent 模式追加槽：全新环境播种 AGENT_APPEND_SYSTEM.md；用户已有的不覆盖", () => {
	const { root, agentDir } = makeEnv();
	try {
		seedStageSystemPrompt(root, agentDir);
		const agent = readFileSync(join(agentDir, "AGENT_APPEND_SYSTEM.md"), "utf8");
		assert.ok(agent.includes("## 正文是文件"), "agent 模式定义在 AGENT_APPEND_SYSTEM.md");
		assert.ok(!agent.includes("draft_write"), "不含扮演的稿纸工具");
		writeFileSync(join(agentDir, "AGENT_APPEND_SYSTEM.md"), "用户自己的 agent 规矩。", "utf8");
		seedStageSystemPrompt(root, agentDir);
		assert.equal(readFileSync(join(agentDir, "AGENT_APPEND_SYSTEM.md"), "utf8"), "用户自己的 agent 规矩。");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
