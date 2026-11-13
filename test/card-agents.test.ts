import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { cardAgentsPath, projectCardToAgents } from "../src/card-agents.ts";
import { syncLorebookMirror } from "../server/rest.ts";
import { buildStageInjection, buildStageSystemPrompt } from "../src/stage/assemble.ts";
import { defaultState } from "../src/state.ts";
import { loadStageMaterials } from "../src/stage/materials.ts";
import { DEFAULT_CONFIG, type RpConfig } from "../src/types.ts";
import type { CharacterCard } from "../src/types.ts";

const card: CharacterCard = {
	name: "冷鹰",
	description: "监察院使，{{user}} 的旧仇。",
	personality: "冷傲干练",
	scenario: "监察院公房",
	firstMes: "你来了。",
	mesExample: "",
	systemPrompt: "文风厚重。",
	postHistoryInstructions: "每拍末尾留钩子。",
	creatorNotes: "",
	alternateGreetings: [],
	tags: [],
	book: [],
};
const config: RpConfig = { ...DEFAULT_CONFIG, userName: "怀瑾" };
const lore = [
	{ uid: 1, keys: [], secondaryKeys: [], comment: "基础设定：世界观", content: "大乾乱世。", constant: true, enabled: true, selective: false, order: 0 },
] as never;

test("投影全文：字段+蓝灯+作者指令+末端指令，宏求值，AGENTS.md 形状", () => {
	const text = projectCardToAgents(card, lore, config);
	assert.ok(text.startsWith("# 你扮演的角色：冷鹰"), "角色标题");
	assert.ok(text.includes("监察院使，怀瑾 的旧仇。"), "{{user}} 求值");
	assert.ok(text.includes("## 性格\n冷傲干练"));
	assert.ok(text.includes("## 基础设定：世界观\n大乾乱世。"), "蓝灯逐条带标题");
	assert.ok(text.includes("# 卡作者附加指令\n文风厚重。"));
	assert.ok(text.includes("# 卡作者末端指令\n每拍末尾留钩子。"), "B8 末端指令进档案");
});

test("AGENTS.md 在场 ⇒ 文件为准：卡 sections 让位、零双份；不在场 ⇒ 投影照旧", () => {
	const withFile = buildStageSystemPrompt({
		card, config, constantLore: lore,
		cardAgents: "# 你扮演的角色：冷鹰\n（档案版内容）",
		tools: false,
	});
	assert.ok(withFile.includes("（档案版内容）"), "档案内容在场");
	assert.ok(!withFile.includes("# 世界设定（常驻事实）"), "蓝灯投影让位");
	assert.ok(!withFile.includes("卡作者附加指令"), "卡作者段让位");
	assert.ok(!withFile.includes("监察院使，怀瑾 的旧仇"), "卡字段投影让位（不双份）");
	assert.ok(withFile.includes("# 用户扮演：怀瑾"), "用户身份不受影响（harness 侧）");

	const noFile = buildStageSystemPrompt({ card, config, constantLore: lore, tools: false });
	assert.ok(noFile.includes("# 你扮演的角色：冷鹰") && noFile.includes("# 世界设定（常驻事实）"), "无档案时投影照旧");
});

test("AGENTS.md 在场 ⇒ 注入侧卡末端指令让位（B8）", () => {
	const withFile = buildStageInjection({
		state: defaultState(),
		activatedLore: [], card, config, cardAgentsActive: true,
	});
	assert.ok(!withFile.includes("【卡作者末端指令】"), "末端指令已在档案里，注入不双份");
	const noFile = buildStageInjection({
		state: defaultState(),
		activatedLore: [], card, config,
	});
	assert.ok(noFile.includes("【卡作者末端指令】"), "无档案时注入照旧");
});

test("端到端：AGENTS.md 文件存在 ⇒ materials 读到 + system 投影让位；指纹变化即失效", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-agents-"));
	process.env.LIYUAN_CODING_AGENT_DIR = join(cwd, "agentDir");
	try {
		writeFileSync(join(cwd, "card.json"), JSON.stringify({ data: { name: "冷鹰", description: "公房里的院使", first_mes: "你来了。" } }));
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "怀瑾" }));
		mkdirSync(join(cwd, "agentDir"), { recursive: true });

		// 无档案：投影路径
		const m1 = loadStageMaterials(cwd);
		assert.equal(m1.cardAgents, "");
		const sp1 = buildStageSystemPrompt({ card: m1.card, config: m1.config, constantLore: [], cardAgents: m1.cardAgents, tools: false });
		assert.ok(sp1.includes("公房里的院使"), "无档案时卡描述投影在场");

		// 建档案：文件为准
		writeFileSync(cardAgentsPath(cwd), "# 你扮演的角色：冷鹰\n档案版。", "utf8");
		const m2 = loadStageMaterials(cwd);
		assert.ok(m2.cardAgents.includes("档案版。"), "档案读到");
		const sp2 = buildStageSystemPrompt({ card: m2.card, config: m2.config, constantLore: [], cardAgents: m2.cardAgents, tools: false });
		assert.ok(sp2.includes("档案版。") && !sp2.includes("公房里的院使"), "档案在场时卡投影让位（不双份）");
	} finally {
		delete process.env.LIYUAN_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("投影带来源：给 bookOf 时蓝灯小节标题尾缀（世界书·书名），无标题条目补「条目 uid」；不给则原样", () => {
	const twoBooks = [
		{ uid: 1, keys: [], secondaryKeys: [], comment: "基础设定：世界观", content: "大乾乱世。", constant: true, enabled: true, selective: false, order: 0 },
		{ uid: 7, keys: [], secondaryKeys: [], comment: "", content: "无题条目。", constant: true, enabled: true, selective: false, order: 1 },
		{ uid: 2, keys: ["补充"], secondaryKeys: [], comment: "", content: "补充设定。", constant: true, enabled: true, selective: false, order: 2 },
	] as never;
	const bookOf = (e: { content: string }) => (e.content === "补充设定。" ? undefined : "大世界");
	const text = projectCardToAgents(card, twoBooks, config, { bookOf });
	assert.ok(text.includes("## 基础设定：世界观（世界书·大世界）\n大乾乱世。"), "来源进标题尾缀");
	assert.ok(text.includes("## 条目 7（世界书·大世界）\n无题条目。"), "有来源必有标题");
	assert.ok(text.includes("## 补充\n补充设定。"), "不在挂载书里的条目不标");
	assert.equal(projectCardToAgents(card, lore, config), projectCardToAgents(card, lore, config, {}), "不给 bookOf 与原样一致");
});

test("世界书镜像同步（syncLorebookMirror）：挂上就有、卸下就没、新增蓝灯跟着来；用户条目不动；档案不在场不做", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mirror-"));
	process.env.LIYUAN_CODING_AGENT_DIR = join(cwd, "agentDir");
	try {
		mkdirSync(join(cwd, "agentDir"), { recursive: true });
		writeFileSync(join(cwd, "card.json"), JSON.stringify({ data: { name: "冷鹰", description: "公房里的院使", first_mes: "你来了。" } }));
		const book = (entries: unknown[]) => writeFileSync(join(cwd, "大世界.json"), JSON.stringify({ entries }));
		book([
			{ uid: 1, key: ["门派"], comment: "门派", content: "门派设定。", constant: true },
			{ uid: 2, key: ["绿灯"], comment: "绿灯条目", content: "只检索不常驻。", constant: false },
		]);
		const cfg = (lorebooks: string[]) =>
			writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "怀瑾", lorebooks }));

		// 档案不在场：无事可做（台上本就从挂载书现场装配）
		cfg(["大世界.json"]);
		assert.equal(syncLorebookMirror(cwd).state, "none");
		assert.ok(!existsSync(cardAgentsPath(cwd)));

		// 建档案（用户自己的内容）→ 挂上 ⇒ 镜像条目出现，用户内容不动
		const mine = "# 你扮演的角色：冷鹰\n档案版。\n\n## 武学\n用户自己写的。\n";
		writeFileSync(cardAgentsPath(cwd), mine, "utf8");
		const r1 = syncLorebookMirror(cwd);
		assert.equal(r1.state, "written");
		assert.equal(r1.entries, 1, "只镜像常驻条目");
		const t1 = readFileSync(cardAgentsPath(cwd), "utf8");
		assert.ok(t1.includes("## 门派（世界书·大世界）\n\n门派设定。"), "镜像条目形态");
		assert.ok(!t1.includes("只检索不常驻"), "绿灯不进档案");
		assert.ok(t1.startsWith(mine.trimEnd()), "用户内容原样在前");
		assert.equal(syncLorebookMirror(cwd).state, "unchanged", "再跑幂等");
		assert.ok(loadStageMaterials(cwd).cardAgents.includes("门派设定。"), "送模看得到");

		// 新增蓝灯 ⇒ 跟着来
		book([
			{ uid: 1, key: ["门派"], comment: "门派", content: "门派设定。", constant: true },
			{ uid: 2, key: ["绿灯"], comment: "绿灯条目", content: "只检索不常驻。", constant: false },
			{ uid: 3, key: ["朝堂"], comment: "朝堂", content: "朝堂结构。", constant: true },
		]);
		const r2 = syncLorebookMirror(cwd);
		assert.equal(r2.state, "written");
		assert.equal(r2.entries, 2);
		assert.ok(readFileSync(cardAgentsPath(cwd), "utf8").includes("## 朝堂（世界书·大世界）"));

		// 卸下 ⇒ 镜像条目全没，用户内容逐字回到原样
		cfg([]);
		const r3 = syncLorebookMirror(cwd);
		assert.equal(r3.state, "written");
		assert.equal(r3.entries, 0);
		assert.equal(readFileSync(cardAgentsPath(cwd), "utf8"), mine, "用户内容一字不动");
		assert.ok(!loadStageMaterials(cwd).cardAgents.includes("门派设定。"), "送模看不到");
	} finally {
		delete process.env.LIYUAN_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("世界书被删除或更换：清理历史遗留无主 '# 世界设定' 段落，绝不留无主条目", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-orphan-lore-"));
	process.env.LIYUAN_CODING_AGENT_DIR = join(cwd, "agentDir");
	try {
		mkdirSync(join(cwd, "agentDir"), { recursive: true });
		writeFileSync(join(cwd, "card.json"), JSON.stringify({ data: { name: "冷鹰", description: "公房里的院使", first_mes: "你来了。" } }));
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "card.json", userName: "怀瑾", lorebooks: [] }));

		// 模拟历史遗留：旧底稿把世界书当成无主条目抄进了 AGENTS.md（带有 "# 世界设定（常驻事实）" 与无后缀小节）
		const legacyWithOrphan = [
			"# 你扮演的角色：冷鹰",
			"公房里的院使",
			"",
			"# 世界设定（常驻事实）",
			"## 旧门派设定",
			"旧世界的门派，源文件已被删。",
			"",
			"# 卡作者末端指令",
			"每拍留钩子。",
			"",
			"## 某预设规则（预设）",
			"预设内容。",
		].join("\n");
		writeFileSync(cardAgentsPath(cwd), legacyWithOrphan, "utf8");

		// 此时未挂载世界书，执行镜像同步
		const r = syncLorebookMirror(cwd);
		assert.equal(r.state, "written");
		assert.equal(r.entries, 0);

		const cleaned = readFileSync(cardAgentsPath(cwd), "utf8");
		assert.doesNotMatch(cleaned, /世界设定/, "无主的世界设定大标题被彻底剥除");
		assert.doesNotMatch(cleaned, /旧门派设定/, "无主的世界书条目被彻底剥除");
		assert.doesNotMatch(cleaned, /旧世界的门派/, "无主正文被彻底剥除");
		assert.ok(cleaned.includes("公房里的院使"), "卡自身描述保留");
		assert.ok(cleaned.includes("# 卡作者末端指令\n每拍留钩子。"), "卡作者末端指令保留");
		assert.ok(cleaned.includes("## 某预设规则（预设）"), "预设条目保留");
	} finally {
		delete process.env.LIYUAN_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
	}
});
