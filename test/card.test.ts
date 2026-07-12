import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	applyMacros,
	exportCardFile,
	loadCardFile,
	normalizeCard,
	readCardJsonFromPng,
	updateCardFields,
} from "../src/card.ts";

const asset = (p: string) => fileURLToPath(new URL(`../assets/${p}`, import.meta.url));
const CARD_JSON = "cards/default_Qingwu.json";

/** 从示例 JSON 卡现场生成一张 PNG 卡（占位图 + tEXt）——测试素材零外部依赖 */
function makePngCard(dir: string): string {
	const p = exportCardFile(asset(CARD_JSON), { format: "png", loreMode: "embedded" });
	const dest = join(dir, "qingwu.png");
	writeFileSync(dest, p.body);
	return dest;
}

test("PNG 角色卡解析（tEXt chara/ccv3）", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-card-png-load-"));
	try {
		const card = loadCardFile(makePngCard(dir));
		assert.equal(card.name, "青梧");
		assert.ok(card.description.length > 100);
		assert.ok(card.firstMes.includes("听雨轩"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("JSON 角色卡解析，与 PNG 内容一致", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-card-eq-"));
	try {
		const png = loadCardFile(makePngCard(dir));
		const json = loadCardFile(asset(CARD_JSON));
		assert.equal(json.name, png.name);
		assert.equal(json.firstMes, png.firstMes);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("卡内嵌 character_book 归一化", () => {
	const card = loadCardFile(asset(CARD_JSON));
	assert.ok(card.book.length >= 1, "应有内嵌世界书条目");
	const inn = card.book.find((e) => e.keys.includes("听雨轩"));
	assert.ok(inn, "应包含 听雨轩 条目");
	assert.ok(inn.enabled);
	assert.ok(inn.content.length > 50);
});

test("V1 极简卡（顶层字段、无 spec）", () => {
	const card = normalizeCard({ name: "Alice", description: "A test char", first_mes: "hi" });
	assert.equal(card.name, "Alice");
	assert.equal(card.firstMes, "hi");
	assert.deepEqual(card.book, []);
});

test("缺 name 报错", () => {
	assert.throws(() => normalizeCard({ description: "x" }));
});

test("宏替换大小写不敏感", () => {
	const out = applyMacros("{{char}} greets {{USER}}, {{ Char }} smiles.", { charName: "Sera", userName: "旅人" });
	assert.equal(out, "Sera greets 旅人, Sera smiles.");
});

test("PNG tEXt 字段回写往返", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-card-png-"));
	try {
		const dest = makePngCard(dir);
		updateCardFields(dest, { description: "PNG_WRITEBACK_OK", personality: "冷静" });
		const card = loadCardFile(dest);
		assert.equal(card.description, "PNG_WRITEBACK_OK");
		assert.equal(card.personality, "冷静");
		assert.equal(card.name, "青梧");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("导出 JSON / PNG 含 character_book", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-card-exp-"));
	try {
		const dest = makePngCard(dir);
		updateCardFields(dest, { description: "export-me" });
		const j = exportCardFile(dest, { format: "json", loreMode: "embedded" });
		assert.match(j.filename, /\.json$/);
		assert.ok(j.loreCount >= 1);
		const parsed = JSON.parse(j.body.toString("utf8"));
		assert.match(String(parsed.spec), /chara_card_v[23]/);
		assert.equal(parsed.data.description, "export-me");
		assert.ok(parsed.data.character_book?.entries?.length >= 1);

		const p = exportCardFile(dest, { format: "png", loreMode: "embedded" });
		assert.match(p.filename, /\.png$/);
		const fromPng = readCardJsonFromPng(p.body) as { data?: { description?: string }; description?: string };
		const data = fromPng.data ?? fromPng;
		assert.equal((data as { description?: string }).description, "export-me");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("JSON 卡可导出为 PNG（占位图 + tEXt）", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-card-j2p-"));
	try {
		const dest = join(dir, "qingwu.json");
		copyFileSync(asset(CARD_JSON), dest);
		updateCardFields(dest, { scenario: "json-to-png" });
		const book = loadCardFile(dest).book;
		const p = exportCardFile(dest, { format: "png", loreMode: "active", bookEntries: book });
		const raw = readCardJsonFromPng(p.body) as { data?: { scenario?: string } };
		assert.equal(raw.data?.scenario, "json-to-png");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
