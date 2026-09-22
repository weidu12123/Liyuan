import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { appendSessionCardRebind, listCardSpaces, listChats, readChatMeta } from "../src/cardspace.ts";
import { ensureStorySessionDir } from "../src/story-guide.ts";
import { parseCardFromSessionHead, readSessionCardInfo } from "../src/session-scan.ts";
import {
	alreadyMigrated,
	applyCardMigration,
	chatIdFromSessionFile,
	planCardMigration,
	planOrphanSessions,
	promoteStagedCard,
	sessionIdFromFile,
} from "../src/migrate-cards.ts";
import { cardDirOf, chatDirOf, chatSessionsDirOf } from "../src/paths.ts";

/** 一张最小可解析的卡（JSON 卡；loadCardFile 认 V2/V3 外壳） */
function writeCard(path: string, name: string): void {
	writeFileSync(
		path,
		JSON.stringify({ spec: "chara_card_v2", data: { name, description: "", first_mes: "开场" } }),
		"utf8",
	);
}

/** 一个最小会话文件：带 rp-card 自描述条目 */
function writeSession(dirAbs: string, fileName: string, cardRef: string, cardName: string): string {
	const p = join(dirAbs, fileName);
	writeFileSync(
		p,
		[
			JSON.stringify({ type: "session", version: 1, id: "x", cwd: "E:/proj" }),
			JSON.stringify({ type: "custom", customType: "rp-card", data: { card: cardRef, name: cardName } }),
			JSON.stringify({ type: "message", message: { role: "user", content: "喂" } }),
		].join("\n") + "\n",
		"utf8",
	);
	return p;
}

function mkProject() {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-migrate-"));
	const sessionDir = mkdtempSync(join(tmpdir(), "liyuan-sessions-"));
	mkdirSync(join(cwd, "assets", "cards"), { recursive: true });
	return { cwd, sessionDir };
}

test("迁移：卡进文件夹、旧会话各成一个子项目、随身数据跟着走", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");
		writeCard(join(cwd, "assets", "cards", "b.json"), "乙卡");

		writeSession(sessionDir, "2026-09-05T16-41-36-682Z_01a07272-aaaa.jsonl", "assets/cards/a.json", "甲卡");
		writeSession(sessionDir, "2026-09-01T10-00-00-000Z_01a06023-bbbb.jsonl", "assets\\cards\\a.json", "甲卡");
		writeSession(sessionDir, "2026-08-30T13-03-51-697Z_01a052c4-cccc.jsonl", "assets/cards/b.json", "乙卡");

		// 甲卡第一个会话的随身数据
		mkdirSync(join(cwd, ".liyuan-state"), { recursive: true });
		writeFileSync(join(cwd, ".liyuan-state", "01a07272-aaaa.json"), '{"time":"正午"}');
		mkdirSync(join(cwd, ".liyuan-worldline"), { recursive: true });
		writeFileSync(join(cwd, ".liyuan-worldline", "01a07272-aaaa.json"), '{"deletedSaveIds":[]}');
		mkdirSync(join(cwd, ".liyuan-artifacts"), { recursive: true });
		writeFileSync(join(cwd, ".liyuan-artifacts", "01a07272-aaaa.json"), '{"panels":[]}');
		mkdirSync(join(cwd, ".liyuan-memory", "scopes", "abc1234567__01a07272-aaaa", "stores", "s1"), { recursive: true });
		writeFileSync(
			join(cwd, ".liyuan-memory", "scopes", "abc1234567__01a07272-aaaa", "stores", "s1", "chunks.jsonl"),
			"chunk\n",
		);
		// 补充设定集按卡名存
		mkdirSync(join(cwd, ".liyuan-lore"), { recursive: true });
		writeFileSync(join(cwd, ".liyuan-lore", "甲卡.json"), '{"entries":{}}');

		assert.equal(alreadyMigrated(cwd), false);
		const plan = planCardMigration(cwd, sessionDir);
		assert.deepEqual(
			plan.cards.map((c) => c.folder).sort(),
			["乙卡", "甲卡"],
			"文件夹名取卡显示名",
		);
		assert.equal(plan.sessions.length, 3);
		assert.equal(plan.skipped.length, 0);
		// 计划是只读的
		assert.ok(existsSync(join(cwd, "assets", "cards", "a.json")), "plan 阶段不许动盘");

		const log = applyCardMigration(cwd, plan);
		assert.ok(log.length > 0);
		assert.equal(alreadyMigrated(cwd), true);

		// 卡进了文件夹
		assert.deepEqual(listCardSpaces(cwd).map((s) => s.folder).sort(), ["乙卡", "甲卡"]);
		assert.ok(!existsSync(join(cwd, "assets", "cards", "a.json")), "卡本体已搬走");
		assert.ok(existsSync(join(cardDirOf(cwd, "甲卡"), "a.json")));

		// 甲卡两个子项目、乙卡一个
		const jia = listChats(cardDirOf(cwd, "甲卡"));
		assert.equal(jia.length, 2, "今天的一个会话＝一个子项目");
		assert.equal(listChats(cardDirOf(cwd, "乙卡")).length, 1);
		for (const c of jia) assert.equal(c.sessionCount, 1);

		// 随身数据落到对应子项目
		const chatId = "20260905-164136-01a0";
		const chatAbs = chatDirOf(cardDirOf(cwd, "甲卡"), chatId);
		assert.ok(existsSync(join(chatSessionsDirOf(cardDirOf(cwd, "甲卡"), chatId), "2026-09-05T16-41-36-682Z_01a07272-aaaa.jsonl")));
		assert.equal(readFileSync(join(chatAbs, "世界状态.json"), "utf8"), '{"time":"正午"}');
		assert.ok(existsSync(join(chatAbs, "世界线.json")));
		assert.ok(existsSync(join(chatAbs, "面板.json")));
		assert.ok(existsSync(join(chatAbs, "向量记忆", "stores", "s1", "chunks.jsonl")), "向量记忆整个 scope 目录跟着走");
		assert.ok(readChatMeta(cardDirOf(cwd, "甲卡"), chatId)?.createdAt, "子项目元数据要有建立时间");

		// 补充设定集进卡文件夹
		assert.ok(existsSync(join(cardDirOf(cwd, "甲卡"), "补充设定集.json")));

		// 搬完的会话追加 rp-card 重绑定行：认最后一条 ⇒ 新引用
		const moved2 = readFileSync(
			join(chatSessionsDirOf(cardDirOf(cwd, "甲卡"), chatId), "2026-09-05T16-41-36-682Z_01a07272-aaaa.jsonl"),
			"utf8",
		).split(/\r?\n/).filter(Boolean);
		assert.ok(moved2.length >= 4, "重绑定行已追加");
		const last = JSON.parse(moved2[moved2.length - 1]) as { type: string; customType: string; data: { card: string; name?: string } };
		assert.equal(last.customType, "rp-card");
		assert.equal(last.data.card, "cards/甲卡/a.json", "重绑定行指向新卡引用");
		assert.equal(last.data.name, "甲卡");
		const parsed = parseCardFromSessionHead(moved2.join("\n"));
		assert.equal(parsed?.card, "cards/甲卡/a.json", "浅扫描认最后一条 ⇒ 新引用");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("迁移：config.card / personas / 收藏改指新引用；旧助手目录原地不动", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");
		writeSession(sessionDir, "2026-09-05T16-41-36-682Z_01a07272-aaaa.jsonl", "assets/cards/a.json", "甲卡");

		// config 指着旧卡；personas 有按旧卡锁定；收藏里有旧卡
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "assets/cards/a.json", userName: "旅人" }), "utf8");
		writeFileSync(
			join(cwd, ".liyuan-personas.json"),
			JSON.stringify({ personas: [{ id: "p1", name: "明月", persona: "" }], current: "p1", byCard: { "assets/cards/a.json": "p1" } }),
			"utf8",
		);
		mkdirSync(join(cwd, ".liyuan-cache"), { recursive: true });
		writeFileSync(join(cwd, ".liyuan-cache", "card-favs.json"), JSON.stringify(["assets/cards/a.json", "assets/cards/别的.png"]));

		// 已退役的右栏助手（2026-09-12 删除）留下的旧目录：迁移不认识它，一字不动
		mkdirSync(join(cwd, ".liyuan-assistant"), { recursive: true });
		writeFileSync(join(cwd, ".liyuan-assistant", "2026-07-18T15-10-12-939Z_019f75c7.jsonl"), '{"type":"session","version":3,"id":"x","cwd":"E:/proj"}\n');

		applyCardMigration(cwd, planCardMigration(cwd, sessionDir));

		// config.card 换新引用
		assert.equal((JSON.parse(readFileSync(join(cwd, "liyuan.config.json"), "utf8")) as { card: string }).card, "cards/甲卡/a.json");
		// personas byCard 换键
		const store = JSON.parse(readFileSync(join(cwd, ".liyuan-personas.json"), "utf8")) as { byCard: Record<string, string> };
		assert.ok(store.byCard["cards/甲卡/a.json"], "按卡锁定改指新引用");
		assert.ok(!store.byCard["assets/cards/a.json"], "旧键不在");
		// 收藏改指新引用，别的条目不动
		const favs = JSON.parse(readFileSync(join(cwd, ".liyuan-cache", "card-favs.json"), "utf8")) as string[];
		assert.deepEqual(favs, ["cards/甲卡/a.json", "assets/cards/别的.png"]);
		assert.ok(existsSync(join(cwd, ".liyuan-assistant", "2026-07-18T15-10-12-939Z_019f75c7.jsonl")), "旧助手目录原地不动");
		assert.ok(!existsSync(join(chatDirOf(cardDirOf(cwd, "甲卡"), "20260905-164136-01a0"), "助手会话")), "子项目里不再生出助手目录");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("迁移：认不出卡的会话原地不动，绝不猜", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");
		// 没有 rp-card 标记
		writeFileSync(join(sessionDir, "2026-01-01T00-00-00-000Z_01a00000-dddd.jsonl"), '{"type":"session"}\n');
		// 标记指向卡库里没有的卡
		writeSession(sessionDir, "2026-01-02T00-00-00-000Z_01a00001-eeee.jsonl", "assets/cards/没这张.png", "幽灵");

		const plan = planCardMigration(cwd, sessionDir);
		assert.equal(plan.sessions.length, 0);
		assert.equal(plan.skipped.length, 2);
		applyCardMigration(cwd, plan);
		assert.equal(existsSync(join(sessionDir, "2026-01-01T00-00-00-000Z_01a00000-dddd.jsonl")), true);
		assert.equal(existsSync(join(sessionDir, "2026-01-02T00-00-00-000Z_01a00001-eeee.jsonl")), true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("迁移：同名卡不互相覆盖", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		writeCard(join(cwd, "assets", "cards", "x1.json"), "重名");
		writeCard(join(cwd, "assets", "cards", "x2.json"), "重名");
		const plan = planCardMigration(cwd, sessionDir);
		assert.deepEqual(plan.cards.map((c) => c.folder), ["重名", "重名-2"]);
		applyCardMigration(cwd, plan);
		assert.deepEqual(listCardSpaces(cwd).map((s) => s.folder).sort(), ["重名", "重名-2"]);
		assert.ok(existsSync(join(cardDirOf(cwd, "重名"), "x1.json")));
		assert.ok(existsSync(join(cardDirOf(cwd, "重名-2"), "x2.json")));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("迁移：再跑一次不重复搬、不覆盖（幂等）", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");
		writeSession(sessionDir, "2026-09-05T16-41-36-682Z_01a07272-aaaa.jsonl", "assets/cards/a.json", "甲卡");
		applyCardMigration(cwd, planCardMigration(cwd, sessionDir));

		const again = planCardMigration(cwd, sessionDir);
		assert.equal(again.cards.length, 0, "assets/cards 已空，没有可搬的卡");
		assert.equal(again.sessions.length, 0, "会话已搬走");
		const log = applyCardMigration(cwd, again);
		assert.deepEqual(log, []);
		assert.equal(listCardSpaces(cwd).length, 1);
		assert.equal(listChats(cardDirOf(cwd, "甲卡")).length, 1);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("会话文件名 → 子项目 id / 会话 id", () => {
	assert.equal(chatIdFromSessionFile("2026-09-05T16-41-36-682Z_01a07272-6caa-7267.jsonl"), "20260905-164136-01a0");
	assert.equal(chatIdFromSessionFile("2026-01-02T03-04-05-000Z_abcd1234.jsonl"), "20260102-030405-abcd");
	// 不合套路的文件名也要给出可排序、Windows 合法的 id
	const odd = chatIdFromSessionFile("怪名字.jsonl", 7);
	assert.match(odd, /^\d{8}-\d{6}-\d{4}$/);
	assert.ok(!odd.includes(":"));

	assert.equal(sessionIdFromFile("2026-09-05T16-41-36-682Z_01a07272-6caa-7267.jsonl"), "01a07272-6caa-7267");
	assert.equal(sessionIdFromFile("怪名字.jsonl"), "");
});


test("promoteStagedCard：暂存卡在打开时升格——只搬这一张、旧会话成子项目、幂等", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");
		writeCard(join(cwd, "assets", "cards", "b.json"), "乙卡");
		writeSession(sessionDir, "2026-09-05T16-41-36-682Z_01a07272-aaaa.jsonl", "assets/cards/a.json", "甲卡");
		writeSession(sessionDir, "2026-08-30T13-03-51-697Z_01a052c4-cccc.jsonl", "assets/cards/b.json", "乙卡");

		const ref = promoteStagedCard(cwd, sessionDir, "assets/cards/a.json");
		assert.equal(ref, "cards/甲卡/a.json");
		// 只升格被打开的那张；旁边暂存的乙卡原地不动
		assert.ok(!existsSync(join(cwd, "assets", "cards", "a.json")), "甲卡已搬进空间");
		assert.ok(existsSync(join(cwd, "assets", "cards", "b.json")), "没打开的卡不许被连带搬走");
		assert.deepEqual(listCardSpaces(cwd).map((s) => s.folder), ["甲卡"]);
		// 旧扁平会话成了子项目（一个会话＝一个子项目）
		const chats = listChats(cardDirOf(cwd, "甲卡"));
		assert.equal(chats.length, 1);
		assert.equal(chats[0].sessionCount, 1);
		// 乙卡的扁平会话没被卷走
		assert.ok(existsSync(join(sessionDir, "2026-08-30T13-03-51-697Z_01a052c4-cccc.jsonl")), "别卡会话原地不动");
		// 幂等：已升格后再点、或直接给 cards/ 引用，都返回 null 且零改动
		assert.equal(promoteStagedCard(cwd, sessionDir, "assets/cards/a.json"), null);
		assert.equal(promoteStagedCard(cwd, sessionDir, "cards/甲卡/a.json"), null);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("alreadyMigrated：空 cards/ 目录不算做过", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		mkdirSync(join(cwd, "cards"), { recursive: true });
		assert.equal(alreadyMigrated(cwd), false, "Docker 卷会先建出空目录");
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");
		applyCardMigration(cwd, planCardMigration(cwd, sessionDir));
		assert.equal(alreadyMigrated(cwd), true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("产品种子 default_* 只拷不搬；再跑不复制第二份；config 改指空间", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		writeCard(join(cwd, "assets", "cards", "default_Qingwu.json"), "青梧");
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");
		writeFileSync(join(cwd, "liyuan.config.json"), JSON.stringify({ card: "assets/cards/default_Qingwu.json" }), "utf8");

		applyCardMigration(cwd, planCardMigration(cwd, sessionDir));
		assert.ok(existsSync(join(cwd, "assets", "cards", "default_Qingwu.json")), "种子留在暂存");
		assert.ok(!existsSync(join(cwd, "assets", "cards", "a.json")), "用户卡搬走");
		assert.ok(existsSync(join(cardDirOf(cwd, "青梧"), "default_Qingwu.json")));
		assert.ok(existsSync(join(cardDirOf(cwd, "甲卡"), "a.json")));
		assert.equal(
			(JSON.parse(readFileSync(join(cwd, "liyuan.config.json"), "utf8")) as { card: string }).card,
			"cards/青梧/default_Qingwu.json",
		);

		applyCardMigration(cwd, planCardMigration(cwd, sessionDir));
		assert.deepEqual(listCardSpaces(cwd).map((s) => s.folder).sort(), ["甲卡", "青梧"], "种子再跑不复制第二份");

		const again = promoteStagedCard(cwd, sessionDir, "assets/cards/default_Qingwu.json");
		assert.equal(again, "cards/青梧/default_Qingwu.json");
		assert.equal(listCardSpaces(cwd).length, 2);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("planOrphanSessions：只收「指向已有卡空间」的散会话；落到该卡一个子项目", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		// 已有卡空间：青梧
		mkdirSync(join(cwd, "cards", "青梧"), { recursive: true });
		writeCard(join(cwd, "cards", "青梧", "q.json"), "青梧");
		// 一张还在暂存的卡（不归收散管，归属跟着单卡升格走）
		writeCard(join(cwd, "assets", "cards", "a.json"), "甲卡");

		writeSession(sessionDir, "2026-09-21T10-00-00-000Z_01a0aaaa-aaaa.jsonl", "cards/青梧/q.json", "青梧");
		writeSession(sessionDir, "2026-09-21T11-00-00-000Z_01a0bbbb-bbbb.jsonl", "assets/cards/a.json", "甲卡");
		writeSession(sessionDir, "2026-09-21T12-00-00-000Z_01a0cccc-cccc.jsonl", "cards/不存在/无.json", "无");

		const strays = planOrphanSessions(cwd, sessionDir);
		assert.equal(strays.length, 1, "只收卡空间散会话");
		assert.equal(strays[0].folder, "青梧");
		assert.equal(strays[0].newRef, "cards/青梧/q.json");

		applyCardMigration(cwd, { cards: [], sessions: strays, skipped: [] });
		const chats = listChats(cardDirOf(cwd, "青梧"));
		assert.equal(chats.length, 1);
		assert.equal(chats[0].sessionCount, 1);
		// 暂存卡的会话与认不出的会话原地不动
		assert.ok(existsSync(join(sessionDir, "2026-09-21T11-00-00-000Z_01a0bbbb-bbbb.jsonl")));
		assert.ok(existsSync(join(sessionDir, "2026-09-21T12-00-00-000Z_01a0cccc-cccc.jsonl")));
		// 幂等：再跑一次无事可做
		assert.equal(planOrphanSessions(cwd, sessionDir).length, 0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("ensureStorySessionDir：没有子项目就建第一个；已有则复用；老布局 null", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		mkdirSync(join(cwd, "cards", "青梧"), { recursive: true });
		writeCard(join(cwd, "cards", "青梧", "q.json"), "青梧");

		const dir1 = ensureStorySessionDir(cwd, "cards/青梧/q.json");
		assert.ok(dir1, "卡空间应有落脚子项目");
		assert.equal(listChats(cardDirOf(cwd, "青梧")).length, 1, "第一个子项目被建出来");
		const dir2 = ensureStorySessionDir(cwd, "cards/青梧/q.json");
		assert.equal(dir2, dir1, "已有子项目则复用，不再新建");
		assert.equal(listChats(cardDirOf(cwd, "青梧")).length, 1);

		// 老布局（卡不在 cards/）：返回 null，调用方保持原行为
		assert.equal(ensureStorySessionDir(cwd, "assets/cards/a.json"), null);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});

test("readSessionCardInfo：重绑定行漂到文件中部（远超 64KB）也取到最后一条（issue #11）", () => {
	const { cwd, sessionDir } = mkProject();
	try {
		const p = writeSession(sessionDir, "2026-08-01T00-00-00-000Z_01a0dddd-dddd.jsonl", "assets/cards/k.json", "神鳴村");
		const bulk = (n: number) =>
			Array.from({ length: n }, (_, i) =>
				JSON.stringify({ type: "message", id: `m${i}`, message: { role: "assistant", content: "正文".repeat(400) } }),
			).join("\n") + "\n";
		// 升格前已有 200KB 正文；升格时 append 一条重绑定；之后又长了 300KB
		appendFileSync(p, bulk(100), "utf8");
		appendSessionCardRebind(p, "cards/神鳴村/k.json");
		appendFileSync(p, bulk(150), "utf8");
		assert.ok(statSync(p).size > 4 * 65536, "样本要远大于旧的头尾窗口");

		const info = readSessionCardInfo(p);
		assert.equal(info?.card, "cards/神鳴村/k.json", "认新卡路径，不被头部旧标记盖过");
		assert.equal(info?.name, "神鳴村");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
});
