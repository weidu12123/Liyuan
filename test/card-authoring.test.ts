import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { type TestContext } from "node:test";
import {
	applyCardProject, buildCardProject, inspectCardProject, prepareCardProject,
	previewCardProject, readCardResource, setCardCover, undoCardProject, writeCardResource,
} from "../src/card-authoring.ts";
import { exportCardFile, loadCardFile, minimalPngBuffer, readCardJsonFromPng, readCardRawJson, writeCardJsonToPng } from "../src/card.ts";
import { collectActiveLoreForExport } from "../server/rest.ts";
import { DEFAULT_CONFIG } from "../src/types.ts";
import { loreFingerprint } from "../src/lorebook.ts";
import { cardProject } from "../src/tools/card.ts";
import { findLocalCard } from "./fixtures.ts";

function fixture() {
	return {
		spec: "chara_card_v3", spec_version: "3.0", custom: { untouched: 1 },
		data: {
			name: "工程测试", first_mes: "<div>试演</div>", description: "原文\r\n保留",
			assets: [{ type: "icon", uri: "https://example.invalid/icon.png", ext: "png", name: "icon" }],
			character_book: { description: "原书信息", extensions: { future: true }, entries: [
				{ id: 0, comment: "同名", content: "甲", keys: [], position: "after_char", extensions: { depth: 4, role: 0, unknown: "keep" } },
				{ id: 7, comment: "同名", content: "乙", enabled: false, position: "before_char", extensions: { depth: 2 } },
				{ id: 99, comment: "同名", content: "甲", enabled: true, position: "after_char", extensions: { custom: "duplicate" } },
			] },
			extensions: {
				custom_plugin: { a: [1, 2, 3] },
				regex_scripts: [{ id: "r", scriptName: "面板", findRegex: "PANEL", replaceString: "<div>面板</div>", placement: [2], markdownOnly: true, future: 42 }],
				tavern_helper: { future: true, scripts: [
					{ id: "s", name: "面板", content: "const value=1;", enabled: true, data: { coordinate: 2 }, button: { enabled: true }, future: "keep" },
				] },
			},
		},
	};
}

function project(t: TestContext, png = false, raw = fixture()) {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-authoring-"));
	const folder = join(cwd, "cards", "card");
	mkdirSync(folder, { recursive: true });
	const card = join(folder, png ? "card.png" : "card.json");
	writeFileSync(card, png ? writeCardJsonToPng(minimalPngBuffer(), raw) : JSON.stringify(raw));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	return { cwd, card, raw };
}

for (const png of [false, true]) test("工程往返与局部修改保真：" + (png ? "PNG" : "JSON"), t => {
	const { cwd, card, raw } = project(t, png);
	const originalBytes = readFileSync(card);
	assert.equal(inspectCardProject(cwd, card).prepared, false);
	const opened = prepareCardProject(cwd, card);
	const clean = buildCardProject(cwd, card);
	assert.deepEqual(clean.raw, raw);
	applyCardProject(cwd, card, clean.hash);
	assert.deepEqual(readFileSync(card), originalBytes, "无变更应用不重写文件");
	const lore = opened.resources.filter(r => r.kind === "lore");
	assert.equal(new Set(lore.map(r => r.id)).size, 3, "同名甚至同内容条目各自有身份");
	const entry = readCardResource(cwd, card, lore[1].id);
	writeCardResource(cwd, card, entry.id, "只改第二项\r\n", entry.hash);
	assert.deepEqual(readFileSync(card), originalBytes, "保存创作稿不动原卡");
	const build = buildCardProject(cwd, card);
	assert.deepEqual(build.errors, []);
	applyCardProject(cwd, card, build.hash);
	const expected = structuredClone(raw);
	expected.data.character_book.entries[1].content = "只改第二项\r\n";
	assert.deepEqual(readCardRawJson(card).raw, expected);
	for (const format of ["json", "png"] as const) {
		const result = exportCardFile(card, { format, loreMode: "embedded" });
		assert.deepEqual(format === "png" ? readCardJsonFromPng(result.body) : JSON.parse(result.body.toString()), expected);
	}
	const afterUndo = undoCardProject(cwd, card);
	assert.deepEqual(readFileSync(card), originalBytes);
	assert.ok(afterUndo.resources.find(r => r.id === entry.id)?.changed, "撤回应用仍保留创作稿");
});

test("JSON 卡封面走侧挂：应用落同名 .png，撤回整张恢复，导出 PNG 拿它当壳", t => {
	// 序列一：无旧侧挂 → 设封面 → 应用 → 撤回（侧挂随之移除）；导出用侧挂当壳
	{
		const { cwd, card } = project(t);
		const sidecar = join(dirname(card), "card.png");
		prepareCardProject(cwd, card);
		const coverA = minimalPngBuffer();
		const st = setCardCover(cwd, card, coverA.toString("base64"));
		assert.equal(st.changes.cover, true, "封面改动进账本");
		assert.ok(!existsSync(sidecar), "应用前侧挂不落盘");
		applyCardProject(cwd, card, buildCardProject(cwd, card).hash);
		assert.ok(existsSync(sidecar));
		assert.deepEqual(readFileSync(sidecar), coverA);
		assert.deepEqual(JSON.parse(readFileSync(card, "utf8")).data.name, "工程测试", "卡本体不被嵌图");
		// 导出 PNG：壳换成侧挂，卡数据完整可读回
		const withCover = exportCardFile(card, { format: "png", loreMode: "embedded" });
		assert.deepEqual(readCardJsonFromPng(withCover.body), JSON.parse(readFileSync(card, "utf8")));
		undoCardProject(cwd, card);
		assert.ok(!existsSync(sidecar), "应用前没有侧挂，撤回就清掉后落的");
	}
	// 序列二：已有侧挂（上轮应用落的）→ 换封面 → 应用 → 撤回恢复上一张
	{
		const { cwd, card } = project(t);
		const sidecar = join(dirname(card), "card.png");
		prepareCardProject(cwd, card);
		const coverA = minimalPngBuffer();
		const coverB = Buffer.concat([minimalPngBuffer(), Buffer.from("v2")]);
		setCardCover(cwd, card, coverA.toString("base64"));
		applyCardProject(cwd, card, buildCardProject(cwd, card).hash);
		assert.deepEqual(readFileSync(sidecar), coverA);
		setCardCover(cwd, card, coverB.toString("base64"));
		applyCardProject(cwd, card, buildCardProject(cwd, card).hash);
		assert.deepEqual(readFileSync(sidecar), coverB);
		undoCardProject(cwd, card);
		assert.deepEqual(readFileSync(sidecar), coverA, "撤回恢复到上次应用前的侧挂");
	}
});

test("过期资源、构建与外部原卡修改都不能覆盖新内容", t => {
	const { cwd, card } = project(t);
	const opened = prepareCardProject(cwd, card);
	const r = readCardResource(cwd, card, opened.resources.find(r => r.kind === "script")!.id);
	writeCardResource(cwd, card, r.id, "const value=2;", r.hash);
	assert.throws(() => writeCardResource(cwd, card, r.id, "const value=3;", r.hash), /资源已变化/);
	const stale = buildCardProject(cwd, card);
	const updated = readCardResource(cwd, card, r.id);
	writeCardResource(cwd, card, r.id, "const value=3;", updated.hash);
	assert.throws(() => applyCardProject(cwd, card, stale.hash), /创作稿已变化/);
	const built = buildCardProject(cwd, card);
	const raw = readCardRawJson(card).raw;
	(raw.data as Record<string, unknown>).description = "外部新修改";
	writeFileSync(card, JSON.stringify(raw));
	assert.throws(() => applyCardProject(cwd, card, built.hash), /原卡已被其他操作修改/);
	assert.equal(inspectCardProject(cwd, card).conflict, true);
	assert.equal(loadCardFile(card).description, "外部新修改");
	assert.equal(prepareCardProject(cwd, card).conflict, true, "重复展开不能悄悄覆盖创作稿");
});

test("只检查变更脚本的语法，不执行副作用，坏脚本不能应用", t => {
	const { cwd, card } = project(t);
	const opened = prepareCardProject(cwd, card);
	const r = readCardResource(cwd, card, opened.resources.find(r => r.kind === "script")!.id);
	writeCardResource(cwd, card, r.id, "import 'https://example.invalid/never-fetch.js';\nthrow new Error('不会执行');", r.hash);
	assert.deepEqual(buildCardProject(cwd, card).errors, []);
	const good = readCardResource(cwd, card, r.id);
	writeCardResource(cwd, card, r.id, "const = ;", good.hash);
	const build = buildCardProject(cwd, card);
	assert.equal(build.errors[0]?.resource, r.id);
	assert.throws(() => applyCardProject(cwd, card, build.hash), /有错误/);
	assert.equal((readCardRawJson(card).raw.data as any).extensions.tavern_helper.scripts[0].content, "const value=1;");
});

test("预览只返回稿件与初值，原包快照不能被当作资源改写", t => {
	const { cwd, card } = project(t);
	prepareCardProject(cwd, card);
	const original = readFileSync(card);
	const preview = previewCardProject(cwd, card, "作者");
	assert.equal(preview.front.scripts.length, 1);
	assert.deepEqual(preview.variables, {});
	assert.deepEqual(readFileSync(card), original);
	assert.throws(() => writeCardResource(cwd, card, "raw", "{}", ""), /只读/);
	assert.throws(() => readCardResource(cwd, card, "../../other"), /找不到资源/);
	assert.deepEqual(cardProject.surfaces, ["authoring"]);
});

test("active 导出保留原书元数据、重复项与挂载书原始扩展", t => {
	const { cwd, card, raw } = project(t);
	const lore = join(cwd, "lore.json");
	writeFileSync(lore, JSON.stringify({ entries: { "5": {
		uid: 5, key: ["附加"], content: "外部设定", position: 4, depth: 7, disable: false,
		extensions: { unknown: { a: 1 } }, extra: 42,
	} } }));
	const config = { ...DEFAULT_CONFIG, card: "cards/card/card.json", lorebooks: ["lore.json"] };
	const result = exportCardFile(card, { format: "json", loreMode: "active", bookEntries: collectActiveLoreForExport(cwd, config) });
	const out = JSON.parse(result.body.toString()).data.character_book;
	assert.deepEqual(out.extensions, raw.data.character_book.extensions);
	assert.deepEqual(out.entries.slice(0, 3), raw.data.character_book.entries);
	assert.equal(out.entries.length, 4);
	assert.equal(out.entries[3].extensions.unknown.a, 1);
	assert.equal(out.entries[3].extensions.position, 4);
	assert.equal(out.entries[3].extensions.depth, 7);
	assert.equal(out.entries[3].extra, 42);
	const plain = exportCardFile(card, { format: "json", loreMode: "active", bookEntries: loadCardFile(card).book });
	assert.deepEqual(JSON.parse(plain.body.toString()).data.character_book, raw.data.character_book);
});

test("active 同内容覆盖保留原条目身份，修改的字段和扩展优先，其余重复项不动", t => {
	const { cwd, card, raw } = project(t);
	writeFileSync(join(cwd, "lore.json"), JSON.stringify({ entries: { "99": {
		uid: 99, key: ["新关键词"], keysecondary: ["条件"], comment: "修改后的标题", content: "甲",
		constant: true, selective: true, disable: false, order: 23, position: 4, depth: 8,
		extensions: { activeOnly: true }, extra: "活跃元数据",
	} } }));
	const config = { ...DEFAULT_CONFIG, card: "cards/card/card.json", lorebooks: ["lore.json"], disabledLore: [loreFingerprint("甲")] };
	const result = exportCardFile(card, { format: "json", loreMode: "active", bookEntries: collectActiveLoreForExport(cwd, config) });
	const book = JSON.parse(result.body.toString()).data.character_book;
	assert.equal(book.entries.length, 3);
	assert.deepEqual(book.entries[0], { ...raw.data.character_book.entries[0], enabled: false });
	assert.deepEqual(book.entries[1], raw.data.character_book.entries[1]);
	const edited = book.entries[2];
	assert.equal(edited.id, 99);
	assert.equal(Object.hasOwn(edited, "uid"), false, "活跃来源的 UID 不新增到原条目");
	assert.deepEqual(edited.keys, ["新关键词"]);
	assert.deepEqual(edited.secondary_keys, ["条件"]);
	assert.equal(edited.constant, true);
	assert.equal(edited.selective, true);
	assert.equal(edited.insertion_order, 23);
	assert.equal(edited.enabled, false);
	assert.equal(edited.disable, true);
	assert.deepEqual(edited.extensions, { custom: "duplicate", activeOnly: true, position: 4, depth: 8 });
	assert.equal(edited.extra, "活跃元数据");
	assert.deepEqual(readCardRawJson(card).raw, raw);
});

test("active 无修改保留缺失 ID、对象式条目键和空条目", t => {
	const { cwd, card, raw } = project(t);
	const original = { ...raw, data: { ...raw.data, character_book: { entries: {
		alpha: { comment: "没有身份", content: "正文" },
		omega: { comment: "空占位", content: "", extensions: { future: 1 } },
	} } } };
	writeFileSync(card, JSON.stringify(original));
	const config = { ...DEFAULT_CONFIG, card: "cards/card/card.json" };
	const result = exportCardFile(card, { format: "json", loreMode: "active", bookEntries: collectActiveLoreForExport(cwd, config) });
	assert.deepEqual(JSON.parse(result.body.toString()), original);
});

test("active 未挂载世界书时不向纯文本卡添加空书", t => {
	const { cwd, card } = project(t);
	const original = { spec: "chara_card_v3", spec_version: "3.0", data: { name: "纯文本卡", first_mes: "你好" } };
	writeFileSync(card, JSON.stringify(original));
	const config = { ...DEFAULT_CONFIG, card: "cards/card/card.json" };
	const result = exportCardFile(card, { format: "json", loreMode: "active", bookEntries: collectActiveLoreForExport(cwd, config) });
	assert.deepEqual(JSON.parse(result.body.toString()), original);
});

test("实卡：复杂资源展开、修改一个替换模板后所有其他数据保留", t => {
	const source = findLocalCard(c => Array.isArray((c.data.extensions as any)?.regex_scripts) &&
		((c.data.extensions as any).regex_scripts as any[]).some(r => typeof r.replaceString === "string" && r.replaceString.length > 1000));
	if (!source) return t.skip("本地没有含复杂替换模板的卡");
	const { cwd, card } = project(t, true, source.raw as any);
	const opened = prepareCardProject(cwd, card);
	const r = readCardResource(cwd, card, opened.resources.find(r => r.kind === "regex-template" && r.length > 1000)!.id);
	const next = r.text + "\n<!-- authoring verification -->";
	writeCardResource(cwd, card, r.id, next, r.hash);
	const build = buildCardProject(cwd, card);
	applyCardProject(cwd, card, build.hash);
	const expected = structuredClone(source.raw);
	let target = expected as any;
	for (const key of (r as any).path.slice(0, -1)) target = target[key];
	target[(r as any).path.at(-1)] = next;
	assert.deepEqual(readCardRawJson(card).raw, expected);
});
