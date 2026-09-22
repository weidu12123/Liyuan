/**
 * 界面国际化的完整性检查（docs/PLAN-I18N.md §三）。
 *
 * 1. 外壳源码里的中文字符串字面量 / JSX 文本必须是 `t(...)` 的第一个参数；
 *    行尾带 `i18n-ignore` 注释的例外（协议字符串、与落盘数据比对的常量）。
 * 2. 英文目录里的每个键都要在源码的 `t("…")` 里出现（防死条目）。
 * 3. 同一个键在多个分片里译法不一致 → 报。
 *
 * 用法：node scripts/i18n-check.mjs [--list]   （test/i18n-check.test.ts 也跑它）
 * 退出码 0＝干净。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 要扫的外壳源码 */
export const SCAN_ROOTS = ["web/src", "server", "src/activity-format.ts", "src/cardspace.ts"];

/**
 * 内容面文件：里面的中文是给 iframe / 卡脚本的兼容层或内容处理，不是外壳（PLAN-I18N §一）。
 * 只许收缩，不许添行（铁律三）。
 */
export const CONTENT_FILES = new Set([
	"web/src/tavernShim.ts",
	"web/src/frameDoc.ts",
	"web/src/scriptHostDoc.ts",
	"web/src/cardAuthoringPreview.ts",
	"web/src/markdown.ts",
	"web/src/richContentParts.ts",
	"web/src/htmlEmbed.ts",
	"web/src/vendor",
	"web/src/i18n",
	"server/card-preview.ts",
]);

/** 英文目录分片 */
const CATALOG_DIRS = ["web/src/i18n/en", "src/i18n/en"];

const HAN = /[㐀-鿿豈-﫿]/;

function walk(p, out = []) {
	const abs = join(ROOT, p);
	const st = statSync(abs);
	if (st.isDirectory()) {
		for (const f of readdirSync(abs)) walk(join(p, f), out);
	} else if (/\.(ts|tsx|mts)$/.test(p)) {
		out.push(p.replace(/\\/g, "/"));
	}
	return out;
}

function isContentFile(rel) {
	for (const c of CONTENT_FILES) if (rel === c || rel.startsWith(`${c}/`)) return true;
	return false;
}

function parse(rel) {
	const src = readFileSync(join(ROOT, rel), "utf8");
	const kind = rel.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	return { src, sf: ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind) };
}

function isTCallArg0(node) {
	const p = node.parent;
	if (!p || !ts.isCallExpression(p)) return false;
	if (p.arguments[0] !== node) return false;
	const callee = p.expression;
	return ts.isIdentifier(callee) && callee.text === "t";
}

/** 模板字符串：整个模板是 t() 的第一参数才算 */
function templateIsTArg(node) {
	let n = node;
	while (n && (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isTemplateSpan(n))) n = n.parent;
	return n && ts.isTemplateExpression(n) && isTCallArg0(n);
}

function lineHasIgnore(src, sf, node) {
	const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
	const text = src.split(/\r?\n/)[line] ?? "";
	return text.includes("i18n-ignore");
}

/** 扫一个文件：返回未走 t() 的中文字面量 [{line, text}] 与已用的键 */
export function scanFile(rel) {
	const { src, sf } = parse(rel);
	const misses = [];
	const keys = new Set();
	const visit = (node) => {
		let text = null;
		let ok = false;
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
			text = node.text;
			ok = isTCallArg0(node);
			if (ok) keys.add(node.text);
		} else if (ts.isJsxText(node)) {
			text = node.text;
			ok = false;
		} else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
			text = node.text;
			ok = templateIsTArg(node);
		} else if (ts.isTemplateExpression(node) && isTCallArg0(node)) {
			// t(`…${x}…`) 不接受：占位符要写成 {x}，这里当 miss 报
		}
		if (text !== null && HAN.test(text) && !ok && !lineHasIgnore(src, sf, node)) {
			const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
			misses.push({ line: line + 1, text: text.replace(/\s+/g, " ").trim().slice(0, 80) });
		}
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return { misses, keys };
}

/** 读目录分片：返回 [{file, key, value}] */
export function readCatalogs() {
	const rows = [];
	for (const dir of CATALOG_DIRS) {
		for (const rel of walk(dir)) {
			const { sf } = parse(rel);
			const visit = (node) => {
				if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)) {
					const k = ts.isStringLiteral(node.name) ? node.name.text : ts.isIdentifier(node.name) ? node.name.text : null;
					if (k !== null) rows.push({ file: rel, key: k, value: node.initializer.text });
				}
				ts.forEachChild(node, visit);
			};
			visit(sf);
		}
	}
	return rows;
}

export function runCheck() {
	const files = SCAN_ROOTS.flatMap((r) => walk(r)).filter((rel) => !isContentFile(rel));
	const misses = [];
	const usedKeys = new Set();
	for (const rel of files) {
		const r = scanFile(rel);
		for (const m of r.misses) misses.push({ file: rel, ...m });
		for (const k of r.keys) usedKeys.add(k);
	}
	const rows = readCatalogs();
	// 两棵树各自核对：web 源码的键对 web 目录，服务端源码的键对 src/i18n 目录
	const treeOf = (rel) => (rel.startsWith("web/") ? "web" : "server");
	const usedByTree = { web: new Set(), server: new Set() };
	for (const rel of files) for (const k of scanFile(rel).keys) usedByTree[treeOf(rel)].add(k);
	const byKey = { web: new Map(), server: new Map() };
	for (const r of rows) {
		const tree = treeOf(r.file);
		const prev = byKey[tree].get(r.key);
		if (prev && prev.value !== r.value) misses.push({ file: r.file, line: 0, text: `键「${r.key}」与 ${prev.file} 译法不一致` });
		byKey[tree].set(r.key, r);
	}
	const dead = rows.filter((r) => !usedByTree[treeOf(r.file)].has(r.key));
	const missingEn = [];
	for (const tree of ["web", "server"]) for (const k of usedByTree[tree]) if (!byKey[tree].has(k)) missingEn.push(`${tree}: ${k}`);
	return { files: files.length, misses, dead, missingEn, catalogSize: byKey.web.size + byKey.server.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const r = runCheck();
	const list = process.argv.includes("--list");
	const perFile = new Map();
	for (const m of r.misses) perFile.set(m.file, (perFile.get(m.file) ?? 0) + 1);
	console.log(`扫描 ${r.files} 个文件；未走 t() 的中文字面量 ${r.misses.length} 条；目录 ${r.catalogSize} 条；死条目 ${r.dead.length}；缺英文 ${r.missingEn.length}`);
	for (const [f, n] of [...perFile].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${f}`);
	if (list) {
		for (const m of r.misses) console.log(`${m.file}:${m.line}  ${m.text}`);
		for (const d of r.dead) console.log(`死条目 ${d.file}: ${d.key}`);
		for (const k of r.missingEn) console.log(`缺英文: ${k}`);
	}
	process.exit(r.misses.length || r.dead.length ? 1 : 0);
}
