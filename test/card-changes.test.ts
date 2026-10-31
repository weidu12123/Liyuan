import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	addCardNode, applyCardProject, buildCardProject, cardProjectOperation, discardCardProject, inspectCardProject, outlineCardProject,
	prepareCardProject, readCardResource, rebaseCardProject, removeCardNode, setCardCover, setCardMeta, undoCardProject, writeCardResource,
} from "../src/card-authoring.ts";
import { minimalPngBuffer, readCardRawJson, writeCardJsonToPng } from "../src/card.ts";
import { draftView, newNode, nodeKind, pruneRemoved, validateMeta, emptyChanges } from "../src/card-changes.ts";
import { authoringTools } from "../src/stage/authoring.ts";
import { seedBuiltinSkills } from "../src/paths.ts";
import { scanSkillFiles } from "../src/stage/materials.ts";

function fixture() {
	return {
		spec: "chara_card_v3", spec_version: "3.0",
		data: {
			name: "账本测试", first_mes: "开场", alternate_greetings: ["备一", "备二"], description: "描述", tags: ["旧"],
			character_book: { name: "书", entries: [
				{ id: 3, comment: "甲", content: "甲文", keys: ["a"], constant: false, enabled: true, position: "before_char", extensions: { position: 0, depth: 4, keep: 1 } },
				{ id: 7, comment: "乙", content: "乙文", keys: [], constant: true, enabled: true },
				{ id: 9, comment: "丙", content: "丙文", keys: ["c"], constant: false, enabled: true },
			] },
			extensions: {
				regex_scripts: [
					{ id: "r1", scriptName: "壹", findRegex: "A", replaceString: "<div>a</div>", placement: [2], markdownOnly: true },
					{ id: "r2", scriptName: "贰", findRegex: "B", replaceString: "<div>b</div>", placement: [2], markdownOnly: true },
				],
				tavern_helper: { scripts: [{ id: "s1", name: "库", content: "const a=1;", enabled: true }] },
			},
		},
	};
}
function project(t: TestContext, png = false, raw: Record<string, unknown> = fixture()) {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-changes-"));
	const folder = join(cwd, "cards", "card");
	mkdirSync(folder, { recursive: true });
	const card = join(folder, png ? "card.png" : "card.json");
	writeFileSync(card, png ? writeCardJsonToPng(minimalPngBuffer(), raw) : JSON.stringify(raw));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	prepareCardProject(cwd, card);
	return { cwd, card, root: join(folder, "创作") };
}
const items = (cwd: string, card: string) => outlineCardProject(cwd, card).sections.flatMap(s => s.items);
const byLabel = (cwd: string, card: string, label: string) => {
	const item = items(cwd, card).find(i => i.label === label);
	assert.ok(item, "目录里应有：" + label);
	return item;
};
const data = (card: string) => readCardRawJson(card).raw.data as any;

test("节点类型只由路径形状决定；元数据白名单拒绝未知字段", () => {
	assert.equal(nodeKind(["data", "character_book", "entries", "2"]), "lore");
	assert.equal(nodeKind(["data", "character_book", "entries", "alpha"]), "lore");
	assert.equal(nodeKind(["data", "extensions", "regex_scripts", "0"]), "regex");
	assert.equal(nodeKind(["data", "extensions", "TavernHelper", "scripts", "1"]), "script");
	assert.equal(nodeKind(["data", "alternate_greetings", "0"]), "greeting");
	assert.equal(nodeKind(["data"]), "card");
	assert.equal(nodeKind(["data", "character_book", "entries", "2", "content"]), null);
	assert.throws(() => validateMeta("lore", { title: "x" }), /不支持字段 title/);
	assert.throws(() => validateMeta("lore", { keys: "不是数组" }), /不合法/);
	assert.throws(() => validateMeta("regex", { findRegex: "x" }), /不支持字段/);
	assert.deepEqual(validateMeta("lore", { position: "at_depth", depth: 2 }), { position: "at_depth", depth: 2 });
});

test("草稿视图：待删项留在原位，追加项落在尾部，元数据覆盖不动其他键；剔除只在构建时", () => {
	const base = fixture();
	const changes = { ...emptyChanges(),
		removed: [JSON.stringify(["data", "character_book", "entries", "0"])],
		meta: { [JSON.stringify(["data", "character_book", "entries", "1"])]: { keys: ["k"], position: "at_depth", depth: 2 } },
		added: [{ path: ["data", "character_book", "entries", "3"], payload: { id: 10, comment: "新", content: "" } }],
	};
	const view = draftView(base, changes);
	const entries = (view.raw.data as any).character_book.entries;
	assert.equal(entries.length, 4, "待删项仍在原位");
	assert.deepEqual(entries[1].keys, ["k"]);
	assert.equal(entries[1].extensions.position, 4);
	assert.equal(entries[1].position, "at_depth");
	assert.equal(entries[1].extensions.depth, 2);
	assert.deepEqual(view.stale, []);
	pruneRemoved(view.raw, view.removed);
	assert.deepEqual(entries.map((e: any) => e.id), [7, 9, 10]);
	// 账本对不上基线：追加位置被占、路径不存在
	const stale = draftView(base, { ...emptyChanges(), added: [{ path: ["data", "character_book", "entries", "1"], payload: {} }], removed: [JSON.stringify(["data", "nope"])] });
	assert.equal(stale.stale.length, 2);
});

test("新增载荷是公开格式的最小完整形状，id 递增，对象式 entries 取新键", () => {
	const draft = fixture() as any;
	const lore = newNode(draft, "lore", { comment: "新条", keys: ["x"], constant: true, content: "正文" });
	assert.deepEqual(lore.path, ["data", "character_book", "entries", "3"]);
	assert.equal((lore.payload as any).id, 10);
	assert.equal((lore.payload as any).constant, true);
	assert.equal((lore.payload as any).content, "正文");
	draft.data.character_book.entries = { alpha: { id: 1 }, "5": { id: 2 } };
	assert.deepEqual(newNode(draft, "lore", {}).path, ["data", "character_book", "entries", "6"]);
	const regex = newNode(draft, "regex", { scriptName: "新正则", placement: [2] });
	assert.deepEqual(regex.path, ["data", "extensions", "regex_scripts", "2"]);
	assert.equal((regex.payload as any).findRegex, "");
	assert.throws(() => newNode(draft, "regex", { content: "x" }), /资源通道/);
	const script = newNode(draft, "script", { name: "新脚本", content: "x()" });
	assert.deepEqual(script.path, ["data", "extensions", "tavern_helper", "scripts", "1"]);
	assert.deepEqual(newNode(draft, "greeting", { group: true }).path, ["data", "group_only_greetings", "0"]);
	assert.throws(() => newNode(draft, "greeting", { comment: "x" }), /没有元数据/);
});

test("新增/删除/元数据 走账本，资源 ID 在应用前稳定，应用后 sources 按新基线重排", t => {
	const { cwd, card, root } = project(t);
	const before = inspectCardProject(cwd, card);
	// 元数据：条目关键词与常驻、正则停用、脚本改名、tags、书名
	setCardMeta(cwd, card, byLabel(cwd, card, "甲").key, { keys: ["a", "b"], constant: true, position: "at_depth", depth: 1 });
	setCardMeta(cwd, card, byLabel(cwd, card, "壹").key, { disabled: true, scriptName: "壹改" });
	setCardMeta(cwd, card, byLabel(cwd, card, "库").key, { name: "库改", enabled: false });
	setCardMeta(cwd, card, "settings-meta", { tags: ["新", "标"] });
	setCardMeta(cwd, card, "book", { name: "新书", scan_depth: 3 });
	assert.throws(() => setCardMeta(cwd, card, byLabel(cwd, card, "备选开场 1").key, { comment: "x" }), /不支持字段/);
	// 目录立刻反映草稿：标题改了、facts 变了
	assert.ok(byLabel(cwd, card, "壹改"));
	assert.equal(byLabel(cwd, card, "甲").facts.keys, 2);
	assert.equal(byLabel(cwd, card, "甲").facts.depth, 1);
	// 删除中间条目、新增一条并写正文
	removeCardNode(cwd, card, byLabel(cwd, card, "乙").key, false);
	assert.equal(byLabel(cwd, card, "乙").removed, true);
	const added = addCardNode(cwd, card, "lore", { comment: "丁", keys: ["d"] });
	assert.equal(added.item.addition, true);
	assert.equal(added.item.label, "丁");
	const res = readCardResource(cwd, card, added.item.resources[0]);
	writeCardResource(cwd, card, res.id, "丁的正文", res.hash);
	const greeting = addCardNode(cwd, card, "greeting", { content: "备三" });
	assert.equal(greeting.item.label, "备选开场 3");
	// 已有资源的 ID 与稿件全部没动
	const mid = inspectCardProject(cwd, card);
	for (const r of before.resources) assert.ok(mid.resources.find(x => x.id === r.id), "资源 ID 稳定：" + r.name);
	assert.deepEqual(mid.changes, { added: 2, removed: 1, meta: 5, cover: false, stale: 0 });
	assert.throws(() => removeCardNode(cwd, card, "settings-meta", false), /不支持删除/);
	// 构建与应用
	const build = buildCardProject(cwd, card);
	assert.deepEqual(build.errors, []);
	assert.equal(build.removed.length, 1);
	assert.equal(build.added.length, 2);
	applyCardProject(cwd, card, build.hash);
	const d = data(card);
	assert.deepEqual(d.character_book.entries.map((e: any) => e.comment), ["甲", "丙", "丁"]);
	assert.deepEqual(d.character_book.entries[0].keys, ["a", "b"]);
	assert.equal(d.character_book.entries[0].constant, true);
	assert.equal(d.character_book.entries[0].extensions.position, 4);
	assert.equal(d.character_book.entries[0].extensions.depth, 1);
	assert.equal(d.character_book.entries[0].extensions.keep, 1, "extensions 其他键不动");
	assert.equal(d.character_book.entries[2].content, "丁的正文");
	assert.equal(d.character_book.entries[2].id, 10);
	assert.equal(d.character_book.name, "新书");
	assert.equal(d.character_book.scan_depth, 3);
	assert.deepEqual(d.tags, ["新", "标"]);
	assert.equal(d.extensions.regex_scripts[0].disabled, true);
	assert.equal(d.extensions.regex_scripts[0].scriptName, "壹改");
	assert.equal(d.extensions.tavern_helper.scripts[0].name, "库改");
	assert.deepEqual(d.alternate_greetings, ["备一", "备二", "备三"]);
	// 应用后：账本清空、sources 与新基线一一对应、没有孤儿也没有串位
	const after = inspectCardProject(cwd, card);
	assert.deepEqual(after.changes, { added: 0, removed: 0, meta: 0, cover: false, stale: 0 });
	assert.equal(after.resources.filter(r => r.changed).length, 0, "应用后没有假的「已改」");
	assert.equal(existsSync(join(root, "changes.json")), false);
	assert.equal(readdirSync(join(root, "sources")).length, after.resources.length);
	const bing = after.resources.find(r => r.kind === "lore" && r.name === "丙")!;
	assert.equal(readFileSync(join(root, bing.file), "utf8"), "丙文", "移位后的条目源文件是自己的正文");
	// 撤回：原卡回到应用前，稿件（账本＋正文）恢复
	const undone = undoCardProject(cwd, card);
	assert.deepEqual(data(card).character_book.entries.map((e: any) => e.comment), ["甲", "乙", "丙"]);
	assert.deepEqual(undone.changes, { added: 2, removed: 1, meta: 5, cover: false, stale: 0 });
	const restoredAdd = undone.resources.find(r => r.addition && r.kind === "lore")!;
	assert.equal(readFileSync(join(root, restoredAdd.file), "utf8"), "丁的正文");
	assert.equal(undone.resources.find(r => r.name === "乙")?.removed, true);
	// 再应用一次得到同样结果；然后放弃
	const again = buildCardProject(cwd, card);
	applyCardProject(cwd, card, again.hash);
	assert.deepEqual(data(card).character_book.entries.map((e: any) => e.comment), ["甲", "丙", "丁"]);
	removeCardNode(cwd, card, byLabel(cwd, card, "丙").key, false);
	assert.equal(inspectCardProject(cwd, card).changes.removed, 1);
	discardCardProject(cwd, card);
	assert.equal(inspectCardProject(cwd, card).changes.removed, 0);
});

test("尾部新增项可直接撤掉；非尾部新增只做标记；restore 撤销删除", t => {
	const { cwd, card } = project(t);
	const a = addCardNode(cwd, card, "regex", { scriptName: "甲正则" });
	const b = addCardNode(cwd, card, "regex", { scriptName: "乙正则" });
	removeCardNode(cwd, card, a.item.key, false);
	assert.equal(byLabel(cwd, card, "甲正则").removed, true, "非尾部新增只标记，乙正则的下标不变");
	assert.equal(byLabel(cwd, card, "乙正则").key, b.item.key);
	removeCardNode(cwd, card, b.item.key, false);
	assert.equal(items(cwd, card).find(i => i.label === "乙正则"), undefined, "尾部新增直接撤掉");
	removeCardNode(cwd, card, a.item.key, true);
	assert.equal(byLabel(cwd, card, "甲正则").removed, undefined);
	const build = buildCardProject(cwd, card);
	applyCardProject(cwd, card, build.hash);
	assert.deepEqual(data(card).extensions.regex_scripts.map((r: any) => r.scriptName), ["壹", "贰", "甲正则"]);
});

test("重新同步：外部改动成为新基线，未改稿件跟随，改过的保留，冲突列出，追加项重排", t => {
	const { cwd, card, root } = project(t);
	const status = inspectCardProject(cwd, card);
	const desc = status.resources.find(r => r.name === "描述")!;
	const jia = status.resources.find(r => r.name === "甲")!;
	writeCardResource(cwd, card, desc.id, "我改的描述", readCardResource(cwd, card, desc.id).hash);
	writeCardResource(cwd, card, jia.id, "我改的甲", readCardResource(cwd, card, jia.id).hash);
	const added = addCardNode(cwd, card, "lore", { comment: "追加" });
	writeCardResource(cwd, card, added.item.resources[0], "追加正文", readCardResource(cwd, card, added.item.resources[0]).hash);
	setCardMeta(cwd, card, byLabel(cwd, card, "丙").key, { constant: true });
	// 外部：改描述、给世界书追加一条、删掉正则
	const raw = fixture() as any;
	raw.data.description = "外部改的描述";
	raw.data.character_book.entries.push({ id: 11, comment: "外部追加", content: "外", keys: [] });
	raw.data.extensions.regex_scripts = [];
	writeFileSync(card, JSON.stringify(raw));
	assert.equal(inspectCardProject(cwd, card).conflict, true);
	assert.throws(() => applyCardProject(cwd, card, buildCardProject(cwd, card).hash), /重新同步/);
	const result = rebaseCardProject(cwd, card);
	assert.equal(result.conflict, false);
	assert.deepEqual(result.conflicts, [desc.id], "描述两边都改了");
	assert.ok(existsSync(join(root, "conflicts", desc.id + ".txt")));
	assert.equal(readFileSync(join(root, desc.file), "utf8"), "我改的描述", "冲突的稿件文本仍保留在源文件");
	assert.equal(readFileSync(join(root, jia.file), "utf8"), "我改的甲", "基线没变的稿件保留");
	assert.equal(result.changes.meta, 1);
	assert.equal(result.changes.added, 1);
	const moved = byLabel(cwd, card, "追加");
	assert.deepEqual(moved.path, ["data", "character_book", "entries", "4"], "追加项排到外部新条目之后");
	assert.equal(readCardResource(cwd, card, moved.resources[0]).text, "追加正文");
	const build = buildCardProject(cwd, card);
	assert.deepEqual(build.errors, []);
	applyCardProject(cwd, card, build.hash);
	const d = data(card);
	assert.deepEqual(d.character_book.entries.map((e: any) => e.comment), ["甲", "乙", "丙", "外部追加", "追加"]);
	assert.equal(d.character_book.entries[0].content, "我改的甲");
	assert.equal(d.character_book.entries[2].constant, true);
	assert.equal(d.description, "我改的描述");
	assert.equal(inspectCardProject(cwd, card).conflicts, undefined, "应用后冲突清除");
});

test("封面：PNG 卡只换图像，卡数据照常写回；JSON 卡也受理（侧挂）", t => {
	const { cwd, card } = project(t, true);
	const cover = minimalPngBuffer();
	assert.throws(() => setCardCover(cwd, card, Buffer.from("not png").toString("base64")), /PNG/);
	const status = setCardCover(cwd, card, cover.toString("base64"));
	assert.equal(status.changes.cover, true);
	const build = buildCardProject(cwd, card);
	applyCardProject(cwd, card, build.hash);
	assert.equal(data(card).name, "账本测试");
	assert.equal(inspectCardProject(cwd, card).changes.cover, false);
	// JSON 卡不再拒绝（2026-09-14 侧挂封面）：受理进账本，落盘细节见 card-authoring 侧挂测试
	const json = project(t, false);
	const st = setCardCover(json.cwd, json.card, cover.toString("base64"));
	assert.equal(st.changes.cover, true);
});

test("工具面：写卡模式只留 card_project 一条写路径；操作入口能走完整链", t => {
	const names = authoringTools("zh", { project: async () => ({}) } as any).map(t => t.name);
	assert.ok(names.includes("card_project"));
	const { cwd, card } = project(t);
	const added = cardProjectOperation(cwd, card, { action: "add", kind: "script", fields: { name: "工具脚本", content: "x=1" } }) as any;
	assert.equal(added.item.label, "工具脚本");
	cardProjectOperation(cwd, card, { action: "meta", key: added.item.key, fields: { enabled: false } });
	assert.throws(() => cardProjectOperation(cwd, card, { action: "add", kind: "nope" }), /kind/);
	const draft = cardProjectOperation(cwd, card, { action: "read", resource: "draft" }) as { text: string };
	assert.equal(JSON.parse(draft.text).data.extensions.tavern_helper.scripts[1].enabled, false);
	const rawText = cardProjectOperation(cwd, card, { action: "read", resource: "raw" }) as { text: string };
	assert.equal(JSON.parse(rawText.text).data.extensions.tavern_helper.scripts.length, 1, "raw 仍是基线");
	const check = cardProjectOperation(cwd, card, { action: "check" }) as any;
	assert.equal(check.added.length, 1);
	cardProjectOperation(cwd, card, { action: "apply", buildHash: check.hash });
	assert.equal(data(card).extensions.tavern_helper.scripts[1].content, "x=1");
});

test("写卡手册：guide 读全局技能根的 SKILL.md 正文，缺失时读发行版；不上扮演模式的 skill 清单", t => {
	const { cwd, card } = project(t);
	const shipped = cardProjectOperation(process.cwd(), card, { action: "guide" }) as { text: string };
	assert.ok(shipped.text.includes("# 写卡工作手册"), "发行版手册可读");
	assert.ok(!shipped.text.startsWith("---"), "不含 frontmatter");
	const ref = cardProjectOperation(process.cwd(), card, { action: "guide", file: "references/mvu.md" }) as { text: string };
	assert.ok(ref.text.includes("# MVU 变量分册"), "分册可按 file 读");
	assert.throws(() => cardProjectOperation(process.cwd(), card, { action: "guide", file: "../secret" }), /包内相对路径/);
	assert.match((cardProjectOperation(process.cwd(), card, { action: "guide", file: "references/nope.md" }) as { text: string }).text, /没有找到/);
	mkdirSync(join(cwd, "skills", "card-authoring"), { recursive: true });
	writeFileSync(join(cwd, "skills", "card-authoring", "SKILL.md"), "---\nname: card-authoring\ndescription: 用户改过\nmode: authoring\n---\n用户的手册");
	assert.equal((cardProjectOperation(cwd, card, { action: "guide" }) as { text: string }).text, "用户的手册");
	const seeded = seedBuiltinSkills(cwd);
	assert.deepEqual(seeded, [], "已存在的不覆盖");
	const fresh = mkdtempSync(join(tmpdir(), "liyuan-seed-"));
	t.after(() => rmSync(fresh, { recursive: true, force: true }));
	mkdirSync(join(fresh, "assets", "skills", "demo", "references"), { recursive: true });
	writeFileSync(join(fresh, "assets", "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: d\nmode: authoring\n---\n正文");
	writeFileSync(join(fresh, "assets", "skills", "demo", "references", "x.md"), "分册正文");
	assert.deepEqual(seedBuiltinSkills(fresh), ["demo"]);
	assert.ok(existsSync(join(fresh, "skills", "demo", "SKILL.md")));
	assert.equal(readFileSync(join(fresh, "skills", "demo", "references", "x.md"), "utf8"), "分册正文", "整包含子目录复制");
	writeFileSync(join(fresh, "liyuan.config.json"), JSON.stringify({ card: "" }));
	const files = scanSkillFiles(fresh);
	assert.equal(files[0]?.mode, "authoring");
});
