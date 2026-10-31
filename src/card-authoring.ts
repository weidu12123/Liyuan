/**
 * 卡创作工程：原包快照 + 按原始位置展开的文本资源。
 * 只回写声明的字符串槽位；未知 JSON、插件元数据、条目 ID 与 PNG 图像留在原包。
 * 所有入口共用这一层。没有模型循环，也不读取卡 AGENTS.md 作为开发指令。
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Script } from "node:vm";
import { coverSidecarOf, normalizeCard, readCardRawBuffer, readCardRawJson, writeCardJsonToPng } from "./card.ts";
import { resolveCardSpace } from "./cardspace.ts";
import { CARD_AUTHORING_DIR, dir, insidePath as inside } from "./paths.ts";
import { buildCardFrontSnapshot } from "./cardfront.ts";
import { findInitVar, findSchemaDefaults } from "./mvu.ts";
import { buildCardOutline, isCardSectionId, type CardSectionDeclarations } from "./card-outline.ts";
import {
	applyMeta, draftView, emptyChanges, hasStructuralChanges, newNode, nodeKind, pathKey, pruneRemoved, record, reindexAdded,
	REMOVABLE, underAny, validateMeta, type AddKind, type CardChanges, type DraftView,
} from "./card-changes.ts";

import type { CardResourceKind, CardResource, CardProjectStatus, CardProjectBuild, CardProjectPreview, CardOutline } from "./card-authoring-types.ts";
export type { CardResourceKind, CardResource, CardProjectStatus, CardProjectBuild, CardProjectPreview, CardOutline } from "./card-authoring-types.ts";
interface Manifest {
	version: 1;
	original: string;
	base: string;
	previous?: string;
	/** 上一次应用前的结构账本，供撤回恢复稿件 */
	previousChanges?: CardChanges;
	/** 重新同步时保留的冲突资源（改过且基线也变了），由用户核对后清除 */
	conflicts?: string[];
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const cardSourceHash = (v: string | Buffer): string => createHash("sha256").update(v).digest("hex");
const manifestFile = (root: string) => join(root, "manifest.json");
const changesFile = (root: string) => join(root, "changes.json");

/** 也校验实际路径：工程目录、资源文件中的符号链接不能把写入带出作品目录。 */
function guardedPath(root: string, rel: string): string {
	const target = resolve(root, rel);
	if (!inside(resolve(root), target)) throw new Error("资源路径超出创作目录");
	let existing = target;
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) throw new Error("找不到创作目录");
		existing = parent;
	}
	if (!inside(realpathSync(root), realpathSync(existing))) throw new Error("资源链接超出创作目录");
	return target;
}

export function cardAuthoringDirectory(cwd: string, cardPath: string): string {
	const abs = resolve(cardPath);
	const space = resolveCardSpace(cwd, relative(cwd, abs));
	const root = space
		? join(space.dir, CARD_AUTHORING_DIR)
		: join(dir(cwd, "artifacts"), "card-authoring", cardSourceHash(abs).slice(0, 20));
	// 只在产品工作区建立工程；项目外原卡仍通过本地工程快照编辑。
	let existing = root;
	while (!existsSync(existing)) existing = dirname(existing);
	if (!inside(realpathSync(cwd), realpathSync(existing))) throw new Error("创作目录链接超出工作区");
	return root;
}

function atomicWrite(file: string, value: string | Buffer): void {
	const tmp = file + "." + randomUUID() + ".tmp";
	try {
		writeFileSync(tmp, value, { flag: "wx" });
		renameSync(tmp, file);
	} finally {
		if (existsSync(tmp)) unlinkSync(tmp);
	}
}

function snapshotFile(root: string, hash: string): string {
	if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("无效的原包版本");
	return guardedPath(root, "snapshots/" + hash + ".card");
}
function saveSnapshot(root: string, bytes: Buffer): string {
	const hash = cardSourceHash(bytes);
	const file = snapshotFile(root, hash);
	if (!existsSync(file)) writeFileSync(file, bytes, { flag: "wx" });
	else if (cardSourceHash(readFileSync(file)) !== hash) throw new Error("原包快照已被修改");
	return hash;
}
function loadManifest(root: string): Manifest {
	const m = JSON.parse(readFileSync(guardedPath(root, "manifest.json"), "utf8")) as Manifest;
	if (m.version !== 1) throw new Error("不支持的创作工程版本");
	return m;
}
function saveManifest(root: string, m: Manifest): void {
	atomicWrite(manifestFile(root), JSON.stringify(m, null, "\t"));
}
function loadChanges(root: string): CardChanges {
	const file = changesFile(root);
	if (!existsSync(file)) return emptyChanges();
	const c = JSON.parse(readFileSync(guardedPath(root, "changes.json"), "utf8")) as Partial<CardChanges>;
	if (c.version !== 1) throw new Error("不支持的结构账本版本");
	return { ...emptyChanges(), ...c, removed: Array.isArray(c.removed) ? c.removed : [], added: Array.isArray(c.added) ? c.added : [], meta: record(c.meta) as CardChanges["meta"] ?? {} };
}
function saveChanges(root: string, c: CardChanges): void {
	const file = changesFile(root);
	if (!hasStructuralChanges(c)) { if (existsSync(file)) unlinkSync(file); return; }
	atomicWrite(file, JSON.stringify(c, null, "\t"));
}
function loadSnapshot(root: string, hash: string) {
	const file = snapshotFile(root, hash);
	const bytes = readFileSync(file);
	if (cardSourceHash(bytes) !== hash) throw new Error("原包快照已被修改");
	return { ...readCardRawBuffer(bytes), bytes };
}
/** 已展开工程的草稿视图；未展开时就是原卡本身 */
function loadDraft(root: string, cardPath: string): { prepared: boolean; view: DraftView; changes: CardChanges; manifest: Manifest | null } {
	if (!existsSync(manifestFile(root))) {
		const { raw } = readCardRawJson(cardPath);
		return { prepared: false, view: { raw, removed: new Set(), added: new Set(), stale: [] }, changes: emptyChanges(), manifest: null };
	}
	const manifest = loadManifest(root);
	const changes = loadChanges(root);
	return { prepared: true, view: draftView(loadSnapshot(root, manifest.base).raw, changes), changes, manifest };
}
function valueAt(raw: Record<string, unknown>, path: string[]): unknown {
	let value: unknown = raw;
	for (const key of path) {
		if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("原包资源位置已变化");
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}
const tryValueAt = (raw: Record<string, unknown>, path: string[]): unknown => { try { return valueAt(raw, path); } catch { return undefined; } };

/** 资源身份＝类型＋原始 JSON 路径；同名同内容的资源各自保留身份 */
const resourceId = (kind: CardResourceKind, path: string[]) => kind + "-" + cardSourceHash(JSON.stringify(path)).slice(0, 16);
const sourceExt = (kind: CardResourceKind) => kind === "script" ? ".js" : kind === "regex-template" ? ".html" : ".txt";

/** 只识别公开卡格式的槽位；不按标题、角色名或正文词语推测资源类型。 */
export function cardResources(raw: Record<string, unknown>): CardResource[] {
	const resources: CardResource[] = [];
	const data = record(raw.data) ?? raw;
	const prefix = data === raw ? [] : ["data"];
	const add = (kind: CardResourceKind, name: string, path: string[], value: unknown) => {
		if (typeof value !== "string") return;
		const id = resourceId(kind, path);
		resources.push({ id, kind, name, path, file: "sources/" + id + sourceExt(kind), length: value.length, hash: cardSourceHash(value), changed: false });
	};
	const fields = {
		name: "卡名", description: "描述", personality: "性格", scenario: "场景",
		mes_example: "对话示例", system_prompt: "卡内系统提示", post_history_instructions: "卡内末端提示",
		creator_notes: "作者注", first_mes: "默认开场", creator: "作者", character_version: "版本",
	};
	for (const [field, label] of Object.entries(fields)) {
		const owner = Object.hasOwn(data, field) ? data : raw;
		add(field === "first_mes" ? "greeting" : "field", label, [...(owner === raw ? [] : prefix), field], owner[field]);
	}
	const greetingsOwner = Object.hasOwn(data, "alternate_greetings") ? data : raw;
	if (Array.isArray(greetingsOwner.alternate_greetings)) greetingsOwner.alternate_greetings.forEach((g, i) =>
		add("greeting", "备选开场 " + (i + 1), [...(greetingsOwner === raw ? [] : prefix), "alternate_greetings", String(i)], g));
	const groupOwner = Object.hasOwn(data, "group_only_greetings") ? data : raw;
	if (Array.isArray(groupOwner.group_only_greetings)) groupOwner.group_only_greetings.forEach((g, i) =>
		add("greeting", "群聊开场 " + (i + 1), [...(groupOwner === raw ? [] : prefix), "group_only_greetings", String(i)], g));
	const bookOwner = Object.hasOwn(data, "character_book") ? data : raw;
	const book = record(bookOwner.character_book);
	if (book?.entries && typeof book.entries === "object") {
		for (const [key, value] of Object.entries(book.entries)) {
			const e = record(value);
			if (e) add("lore", String(e.comment || e.name || "条目 " + key),
				[...(bookOwner === raw ? [] : prefix), "character_book", "entries", key, "content"], e.content);
		}
	}
	const extensions = record(data.extensions);
	if (Array.isArray(extensions?.regex_scripts)) extensions.regex_scripts.forEach((r, i) => {
		const item = record(r);
		if (!item) return;
		const path = [...prefix, "extensions", "regex_scripts", String(i)];
		const label = String(item.scriptName || "正则 " + (i + 1));
		add("regex-pattern", label + " · 匹配", [...path, "findRegex"], item.findRegex);
		add("regex-template", label + " · 替换", [...path, "replaceString"], item.replaceString);
	});
	for (const ns of ["TavernHelper", "tavern_helper"]) {
		const helper = record(extensions?.[ns]);
		if (Array.isArray(helper?.scripts)) helper.scripts.forEach((s, i) => {
			const item = record(s);
			if (item) add("script", String(item.name || "脚本 " + (i + 1)),
				[...prefix, "extensions", ns, "scripts", String(i), "content"], item.content);
		});
	}
	return resources;
}

/** 按草稿视图给资源打标：待删、新增；源文件缺失时从草稿值物化。 */
function draftResources(root: string, view: DraftView, materialize: boolean): CardResource[] {
	return cardResources(view.raw).map(r => {
		const flags = { ...(underAny(r.path, view.removed) ? { removed: true } : {}), ...(underAny(r.path, view.added) ? { addition: true } : {}) };
		if (!materialize) return { ...r, ...flags };
		const file = guardedPath(root, r.file);
		if (!existsSync(file)) writeFileSync(file, String(valueAt(view.raw, r.path) ?? ""), { flag: "w" });
		const text = readFileSync(file, "utf8");
		return { ...r, ...flags, length: text.length, hash: cardSourceHash(text), changed: text !== valueAt(view.raw, r.path) };
	});
}
function changeSummary(view: DraftView, changes: CardChanges): CardProjectStatus["changes"] {
	return { added: view.added.size, removed: view.removed.size, meta: Object.keys(changes.meta).length, cover: Boolean(changes.cover), stale: view.stale.length };
}

export function inspectCardProject(cwd: string, cardPath: string): CardProjectStatus {
	const directory = cardAuthoringDirectory(cwd, cardPath);
	const current = cardSourceHash(readFileSync(cardPath));
	const { prepared, view, changes, manifest: m } = loadDraft(directory, cardPath);
	const resources = draftResources(directory, view, prepared);
	return { prepared, directory, cardName: normalizeCard(view.raw).name, version: m?.base ?? current,
		conflict: m !== null && m.base !== current, canUndo: Boolean(m?.previous), resources,
		changes: changeSummary(view, changes), ...(m?.conflicts?.length ? { conflicts: m.conflicts } : {}) };
}

export function prepareCardProject(cwd: string, cardPath: string): CardProjectStatus {
	const root = cardAuthoringDirectory(cwd, cardPath);
	if (existsSync(manifestFile(root))) return inspectCardProject(cwd, cardPath);
	const bytes = readFileSync(cardPath);
	const { raw } = readCardRawBuffer(bytes);
	normalizeCard(raw);
	mkdirSync(root, { recursive: true });
	mkdirSync(guardedPath(root, "sources"), { recursive: true });
	mkdirSync(guardedPath(root, "snapshots"), { recursive: true });
	for (const r of cardResources(raw)) {
		const file = guardedPath(root, r.file);
		// 未完成的初始化不覆盖已经写过的源文件。
		if (!existsSync(file)) writeFileSync(file, String(valueAt(raw, r.path)), { flag: "wx" });
	}
	const base = saveSnapshot(root, bytes);
	saveManifest(root, { version: 1, original: base, base });
	return inspectCardProject(cwd, cardPath);
}

export function readCardResource(cwd: string, cardPath: string, id: string) {
	const root = cardAuthoringDirectory(cwd, cardPath);
	const m = loadManifest(root);
	if (id === "raw") {
		const text = JSON.stringify(loadSnapshot(root, m.base).raw, null, "\t");
		return { id, text, hash: cardSourceHash(text), file: snapshotFile(root, m.base) };
	}
	const { view } = loadDraft(root, cardPath);
	if (id === "draft") {
		const text = JSON.stringify(view.raw, null, "\t");
		return { id, text, hash: cardSourceHash(text), file: changesFile(root) };
	}
	const resource = draftResources(root, view, true).find(r => r.id === id);
	if (!resource) throw new Error("找不到资源：" + id);
	const file = guardedPath(root, resource.file);
	const text = readFileSync(file, "utf8");
	return { ...resource, file, text, hash: cardSourceHash(text) };
}

export function writeCardResource(cwd: string, cardPath: string, id: string, text: string, expectedHash: string) {
	if (id === "raw" || id === "draft") throw new Error("原包快照只读，请修改展开的资源");
	const resource = readCardResource(cwd, cardPath, id);
	if (!expectedHash || resource.hash !== expectedHash) throw new Error("资源已变化，请重新读取后修改");
	atomicWrite(resource.file, text);
	return { id, hash: cardSourceHash(text), length: text.length };
}

/** 语法检查不执行作者代码。HTML 内脚本的实际错误由预览报告。 */
function scriptSyntaxError(code: string, file: string): string | null {
	try { new Script(code, { filename: file }); return null; } catch { /* 再按 ES module 语法检查 */ }
	// Electron 宿主：execPath 是应用二进制，要带 RUN_AS_NODE 才能当纯 node 用（src/mcp.ts 同款）
	const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
		input: code, encoding: "utf8", timeout: 10_000, maxBuffer: 128_000, windowsHide: true,
		env: process.versions?.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" } : process.env,
	});
	return result.status === 0 ? null : (result.error?.message || result.stderr || "JavaScript 语法检查失败").trim();
}

export function buildCardProject(cwd: string, cardPath: string): CardProjectBuild & { raw: Record<string, unknown> } {
	const root = cardAuthoringDirectory(cwd, cardPath);
	const { view, changes, manifest: m } = loadDraft(root, cardPath);
	if (!m) throw new Error("请先展开创作工程");
	const raw = view.raw;
	const report: CardProjectBuild = { base: m.base, hash: "", changed: [], errors: [], checkedScripts: [], checkedPatterns: [],
		added: [...view.added], removed: [...view.removed], meta: Object.keys(changes.meta), cover: Boolean(changes.cover), stale: view.stale };
	for (const key of view.stale) report.errors.push({ resource: key, message: "结构账本与当前基线对不上，请重新同步（rebase）或放弃该项" });
	for (const r of draftResources(root, view, true)) {
		if (r.removed) continue;
		const text = readFileSync(guardedPath(root, r.file), "utf8");
		if (text === valueAt(raw, r.path)) continue;
		report.changed.push(r.id);
		if (r.kind === "script") {
			report.checkedScripts.push(r.id);
			const error = scriptSyntaxError(text, r.file);
			if (error) report.errors.push({ resource: r.id, message: error });
		}
		if (r.kind === "regex-pattern") {
			report.checkedPatterns.push(r.id);
			try {
				const literal = text.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
				new RegExp(literal ? literal[1] : text, literal ? literal[2] : "");
			} catch (error) {
				report.errors.push({ resource: r.id, message: String(error) });
			}
		}
		const parent = valueAt(raw, r.path.slice(0, -1)) as Record<string, unknown>;
		parent[r.path[r.path.length - 1]] = text;
	}
	pruneRemoved(raw, view.removed);
	try { normalizeCard(raw); } catch (error) { report.errors.push({ resource: "card", message: String(error) }); }
	report.hash = cardSourceHash(m.base + "\n" + (changes.cover ?? "") + "\n" + JSON.stringify(raw));
	return { ...report, raw };
}

const buildHasChanges = (b: CardProjectBuild) => b.changed.length > 0 || b.added.length > 0 || b.removed.length > 0 || b.meta.length > 0 || b.cover;
const undoFile = (root: string) => join(root, "undo-sources.json");
const coverFile = (root: string, hash: string) => {
	if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("无效的封面版本");
	return guardedPath(root, "snapshots/" + hash + ".cover");
};

/** sources 按给定视图整体重写（overlay 按资源 ID 覆盖文本），孤儿文件清掉。 */
function materializeSources(root: string, raw: Record<string, unknown>, overlay: Record<string, string> = {}): void {
	const keep = new Set<string>();
	for (const r of cardResources(raw)) {
		const file = guardedPath(root, r.file);
		keep.add(file);
		const text = overlay[r.id] ?? String(valueAt(raw, r.path));
		if (!existsSync(file) || readFileSync(file, "utf8") !== text) atomicWrite(file, text);
	}
	const sources = guardedPath(root, "sources");
	for (const name of readdirSync(sources)) {
		const file = join(sources, name);
		if (!keep.has(file) && !name.endsWith(".tmp")) unlinkSync(file);
	}
}

/** 回写与快照均使用原格式；外部变更、过期构建和语法错误均不会覆盖原卡。 */
export function applyCardProject(cwd: string, cardPath: string, expectedBuild: string): CardProjectStatus {
	const build = buildCardProject(cwd, cardPath);
	if (!expectedBuild || expectedBuild !== build.hash) throw new Error("创作稿已变化，请重新检查或预览");
	if (build.errors.length) throw new Error("创作稿有错误：" + build.errors.map(e => e.message).join("\n"));
	const root = cardAuthoringDirectory(cwd, cardPath);
	const m = loadManifest(root);
	const changes = loadChanges(root);
	const previous = readFileSync(cardPath);
	if (cardSourceHash(previous) !== m.base) throw new Error("原卡已被其他操作修改，未覆盖；请保留创作稿并重新同步（rebase）");
	if (!buildHasChanges(build)) return inspectCardProject(cwd, cardPath);
	const { isPng } = loadSnapshot(root, m.base);
	const shell = changes.cover ? readFileSync(coverFile(root, changes.cover)) : previous;
	const next = isPng ? writeCardJsonToPng(shell, build.raw) : Buffer.from(JSON.stringify(build.raw, null, "\t") + "\n");
	const hash = saveSnapshot(root, next);
	// 撤回要能恢复应用前的稿件：改过的源文本按旧资源 ID 存档，结构账本存进清单
	const { view } = loadDraft(root, cardPath);
	const drafts: Record<string, string> = {};
	for (const r of draftResources(root, view, true)) if (r.changed && !r.removed) drafts[r.id] = readFileSync(guardedPath(root, r.file), "utf8");
	atomicWrite(undoFile(root), JSON.stringify(drafts));
	// JSON 卡的封面＝侧挂文件（卡数据不嵌图）。应用前先把旧侧挂状态存档，撤回按它整张恢复
	const sidecar = isPng ? null : coverSidecarOf(cardPath);
	if (sidecar) {
		const existed = existsSync(sidecar);
		if (existed) writeFileSync(guardedPath(root, "undo-cover.png"), readFileSync(sidecar));
		else if (existsSync(guardedPath(root, "undo-cover.png"))) unlinkSync(guardedPath(root, "undo-cover.png"));
		atomicWrite(guardedPath(root, "undo-cover.json"), JSON.stringify({ existed }));
	}
	atomicWrite(cardPath, next);
	const restoreSidecar = () => {
		if (!sidecar) return;
		const meta = guardedPath(root, "undo-cover.json");
		if (!existsSync(meta)) return;
		const { existed } = JSON.parse(readFileSync(meta, "utf8")) as { existed?: boolean };
		const saved = guardedPath(root, "undo-cover.png");
		if (existed && existsSync(saved)) atomicWrite(sidecar, readFileSync(saved));
		else if (existsSync(sidecar)) unlinkSync(sidecar);
	};
	try {
		// 新侧挂只在真有封面改动时落盘（无改动不动用户既有的侧挂）
		if (sidecar && changes.cover) atomicWrite(sidecar, shell);
		saveManifest(root, { version: 1, original: m.original, base: hash, previous: m.base, previousChanges: changes });
	} catch (error) {
		atomicWrite(cardPath, previous);
		restoreSidecar();
		throw error;
	}
	saveChanges(root, emptyChanges());
	materializeSources(root, readCardRawBuffer(next).raw);
	return inspectCardProject(cwd, cardPath);
}

/** 撤回最后一次应用；应用前的稿件（源文本与结构账本）恢复为待修改稿。 */
export function undoCardProject(cwd: string, cardPath: string): CardProjectStatus {
	const root = cardAuthoringDirectory(cwd, cardPath);
	const m = loadManifest(root);
	if (!m.previous) throw new Error("没有可撤回的应用");
	const current = readFileSync(cardPath);
	if (cardSourceHash(current) !== m.base) throw new Error("原卡已变化，不能撤回覆盖");
	const status = inspectCardProject(cwd, cardPath);
	if (status.resources.some(r => r.changed) || hasStructuralChanges(loadChanges(root))) throw new Error("当前有未应用的修改，撤回会丢弃它们；请先应用或放弃（discard）");
	const previous = loadSnapshot(root, m.previous);
	const drafts = existsSync(undoFile(root)) ? JSON.parse(readFileSync(undoFile(root), "utf8")) as Record<string, string> : {};
	atomicWrite(cardPath, previous.bytes);
	// JSON 卡撤回：侧挂封面一并回到应用前（存档在时还原图，不在时移除后落的）
	if (!previous.isPng) {
		const sidecar = coverSidecarOf(cardPath);
		const meta = guardedPath(root, "undo-cover.json");
		if (existsSync(meta)) {
			const { existed } = JSON.parse(readFileSync(meta, "utf8")) as { existed?: boolean };
			const saved = guardedPath(root, "undo-cover.png");
			if (existed && existsSync(saved)) atomicWrite(sidecar, readFileSync(saved));
			else if (existsSync(sidecar)) unlinkSync(sidecar);
		}
	}
	try {
		saveManifest(root, { version: 1, original: m.original, base: m.previous });
	} catch (error) {
		atomicWrite(cardPath, current);
		throw error;
	}
	const changes = m.previousChanges ?? emptyChanges();
	saveChanges(root, changes);
	materializeSources(root, draftView(previous.raw, changes).raw, drafts);
	if (existsSync(undoFile(root))) unlinkSync(undoFile(root));
	for (const f of [guardedPath(root, "undo-cover.json"), guardedPath(root, "undo-cover.png")]) if (existsSync(f)) unlinkSync(f);
	return inspectCardProject(cwd, cardPath);
}

/** 放弃全部未应用的稿件：源文本回到基线，结构账本与冲突清空。 */
export function discardCardProject(cwd: string, cardPath: string): CardProjectStatus {
	const root = cardAuthoringDirectory(cwd, cardPath);
	const m = loadManifest(root);
	saveChanges(root, emptyChanges());
	materializeSources(root, loadSnapshot(root, m.base).raw);
	const { conflicts: _c, ...rest } = m;
	saveManifest(root, rest);
	return inspectCardProject(cwd, cardPath);
}

/**
 * 原卡被其他入口改动后，把当前原卡设为新基线。未改的源文件按新基线重写；改过且基线同位置未变的保留；
 * 改过且基线也变了、或位置已不存在的列为冲突（文本另存在 conflicts/）。账本里失效的删除与元数据丢弃并报告，追加项重排下标。
 */
export function rebaseCardProject(cwd: string, cardPath: string): CardProjectStatus & { dropped: string[] } {
	const root = cardAuthoringDirectory(cwd, cardPath);
	const m = loadManifest(root);
	const bytes = readFileSync(cardPath);
	if (cardSourceHash(bytes) === m.base) return { ...inspectCardProject(cwd, cardPath), dropped: [] };
	const nextRaw = readCardRawBuffer(bytes).raw;
	normalizeCard(nextRaw);
	const old = loadDraft(root, cardPath);
	const oldResources = draftResources(root, old.view, true);
	const dropped: string[] = [];
	const conflicts: string[] = [];
	const overlay: Record<string, string> = {};
	const changes = old.changes;
	const oldAdded = changes.added.map(a => a.path);
	changes.added = reindexAdded(nextRaw, changes.added);
	changes.removed = changes.removed.filter(k => { const ok = tryValueAt(nextRaw, JSON.parse(k) as string[]) !== undefined; if (!ok) dropped.push(k); return ok; });
	for (const k of Object.keys(changes.meta)) if (!record(tryValueAt(nextRaw, JSON.parse(k) as string[]))) { dropped.push(k); delete changes.meta[k]; }
	const nextView = draftView(nextRaw, changes);
	const nextIds = new Set(cardResources(nextView.raw).map(r => r.id));
	// 追加项的资源随下标重排：旧路径前缀换成新路径前缀
	const relocate = (r: CardResource): { id: string; path: string[] } => {
		const i = oldAdded.findIndex(p => pathKey(r.path.slice(0, p.length)) === pathKey(p));
		if (i < 0) return { id: r.id, path: r.path };
		const path = [...changes.added[i].path, ...r.path.slice(oldAdded[i].length)];
		return { id: resourceId(r.kind, path), path };
	};
	mkdirSync(guardedPath(root, "conflicts"), { recursive: true });
	for (const r of oldResources) {
		if (!r.changed || r.removed) continue;
		const text = readFileSync(guardedPath(root, r.file), "utf8");
		const oldBase = valueAt(old.view.raw, r.path);
		const next = relocate(r);
		const nextBase = nextIds.has(next.id) ? tryValueAt(nextView.raw, next.path) : undefined;
		if (nextBase !== undefined && (nextBase === oldBase || nextBase === text)) { overlay[next.id] = text; continue; }
		conflicts.push(next.id);
		atomicWrite(guardedPath(root, "conflicts/" + next.id + sourceExt(r.kind)), text);
		if (nextBase !== undefined) overlay[next.id] = text;
	}
	const base = saveSnapshot(root, bytes);
	saveManifest(root, { version: 1, original: m.original, base, ...(conflicts.length ? { conflicts } : {}) });
	saveChanges(root, changes);
	materializeSources(root, nextView.raw, overlay);
	return { ...inspectCardProject(cwd, cardPath), dropped };
}

function requirePrepared(root: string): void {
	if (!existsSync(manifestFile(root))) throw new Error("请先展开创作工程");
}
function outlineItem(cwd: string, cardPath: string, key: string) {
	const item = outlineCardProject(cwd, cardPath).sections.flatMap(s => s.items).find(i => i.key === key);
	if (!item) throw new Error("找不到目录项：" + key);
	return item;
}

/** 新增一项：服务端给公开格式的最小完整载荷，落点由草稿视图决定；返回新目录项。 */
export function addCardNode(cwd: string, cardPath: string, kind: AddKind, fields: Record<string, unknown>) {
	const root = cardAuthoringDirectory(cwd, cardPath);
	requirePrepared(root);
	const { view, changes } = loadDraft(root, cardPath);
	const node = newNode(view.raw, kind, fields);
	changes.added.push({ path: node.path, payload: node.payload });
	saveChanges(root, changes);
	const item = outlineCardProject(cwd, cardPath).sections.flatMap(s => s.items).find(i => i.path && pathKey(i.path) === pathKey(node.path));
	if (!item) throw new Error("新增项没有出现在目录里");
	return { item, status: inspectCardProject(cwd, cardPath) };
}

/** 标记删除 / 撤销删除。尾部的新增项直接从账本移除，其余新增项同样只做标记以保持下标稳定。 */
export function removeCardNode(cwd: string, cardPath: string, key: string, restore: boolean) {
	const root = cardAuthoringDirectory(cwd, cardPath);
	requirePrepared(root);
	const item = outlineItem(cwd, cardPath, key);
	if (!item.path) throw new Error("该目录项没有可删除的节点");
	const kind = nodeKind(item.path);
	if (!kind || !REMOVABLE.has(kind)) throw new Error("该类型不支持删除：" + item.label);
	const k = pathKey(item.path);
	const changes = loadChanges(root);
	const parentKey = pathKey(item.path.slice(0, -1));
	if (restore) changes.removed = changes.removed.filter(x => x !== k);
	else if (item.addition && changes.added.findIndex(a => pathKey(a.path) === k) === changes.added.map(a => pathKey(a.path.slice(0, -1))).lastIndexOf(parentKey)) {
		changes.added = changes.added.filter(a => pathKey(a.path) !== k);
		delete changes.meta[k];
		saveChanges(root, changes);
		// 该项的源文件成了孤儿：按当前草稿重排一次，其余稿件文本原样保留
		const view = loadDraft(root, cardPath).view;
		materializeSources(root, view.raw, Object.fromEntries(draftResources(root, view, false).map(r => {
			const file = guardedPath(root, r.file);
			return [r.id, existsSync(file) ? readFileSync(file, "utf8") : String(valueAt(view.raw, r.path))];
		})));
		return { item: null, status: inspectCardProject(cwd, cardPath) };
	} else if (!changes.removed.includes(k)) changes.removed.push(k);
	saveChanges(root, changes);
	return { item: outlineItem(cwd, cardPath, key), status: inspectCardProject(cwd, cardPath) };
}

/** 元数据覆盖：字段按节点类型白名单校验；新增项直接改载荷，其余累积进账本。 */
export function setCardMeta(cwd: string, cardPath: string, key: string, fields: Record<string, unknown>) {
	const root = cardAuthoringDirectory(cwd, cardPath);
	requirePrepared(root);
	const item = outlineItem(cwd, cardPath, key);
	if (!item.path) throw new Error("该目录项没有可改的元数据");
	const kind = nodeKind(item.path);
	if (!kind) throw new Error("该目录项不支持元数据修改");
	const valid = validateMeta(kind, fields);
	if (!Object.keys(valid).length) throw new Error("没有要修改的字段");
	const changes = loadChanges(root);
	const k = pathKey(item.path);
	const addition = changes.added.find(a => pathKey(a.path) === k);
	if (addition && record(addition.payload)) applyMeta(kind, addition.payload as Record<string, unknown>, valid);
	else changes.meta[k] = { ...(changes.meta[k] ?? {}), ...valid };
	saveChanges(root, changes);
	return { item: outlineItem(cwd, cardPath, key), status: inspectCardProject(cwd, cardPath) };
}

/** 换封面：PNG 卡换内嵌图像，JSON 卡落到侧挂文件（同名 .png），都在应用时写盘；传空清除。 */
export function setCardCover(cwd: string, cardPath: string, data: string | null) {
	const root = cardAuthoringDirectory(cwd, cardPath);
	requirePrepared(root);
	const changes = loadChanges(root);
	if (data === null) { delete changes.cover; saveChanges(root, changes); return inspectCardProject(cwd, cardPath); }
	const bytes = Buffer.from(data, "base64");
	if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("封面必须是 PNG");
	const hash = cardSourceHash(bytes);
	const file = coverFile(root, hash);
	if (!existsSync(file)) writeFileSync(file, bytes, { flag: "wx" });
	changes.cover = hash;
	saveChanges(root, changes);
	return inspectCardProject(cwd, cardPath);
}
/** 待换封面的字节（面板预览用） */
export function readCardCover(cwd: string, cardPath: string): Buffer | null {
	const root = cardAuthoringDirectory(cwd, cardPath);
	const changes = existsSync(manifestFile(root)) ? loadChanges(root) : emptyChanges();
	return changes.cover ? readFileSync(coverFile(root, changes.cover)) : null;
}

/** 板块声明：资源键 → 板块。是数据，不是判据；投影时覆盖结构默认值。 */
const sectionsFile = (root: string) => join(root, "sections.json");
function loadSections(root: string): CardSectionDeclarations {
	const file = sectionsFile(root);
	if (!existsSync(file)) return {};
	const parsed = JSON.parse(readFileSync(file, "utf8")) as { version?: number; items?: Record<string, unknown> };
	const out: CardSectionDeclarations = {};
	for (const [key, value] of Object.entries(parsed.items ?? {})) if (isCardSectionId(value)) out[key] = value;
	return out;
}

/** 目录：按板块投影当前基线（已展开用快照，否则读原卡）。不改资源身份，不需要先建立工程。 */
export function outlineCardProject(cwd: string, cardPath: string): CardOutline {
	const root = cardAuthoringDirectory(cwd, cardPath);
	const { prepared, view } = loadDraft(root, cardPath);
	return buildCardOutline(view.raw, draftResources(root, view, prepared), prepared ? loadSections(root) : {}, { removed: view.removed, added: view.added });
}

/** 把一项归入板块；传空板块＝撤销声明回到默认。声明落在工程目录，需要先展开。 */
function assignCardSection(cwd: string, cardPath: string, key: string, section: string | null): CardOutline {
	const root = cardAuthoringDirectory(cwd, cardPath);
	if (!existsSync(manifestFile(root))) throw new Error("请先展开创作工程再归位");
	const outline = outlineCardProject(cwd, cardPath);
	const item = outline.sections.flatMap(s => s.items).find(i => i.key === key);
	if (!item) throw new Error("找不到目录项：" + key);
	if (section !== null && !isCardSectionId(section)) throw new Error("未知板块：" + section);
	const items = loadSections(root);
	if (section === null || section === item.defaultSection) delete items[key];
	else items[key] = section;
	atomicWrite(sectionsFile(root), JSON.stringify({ version: 1, items }, null, "\t"));
	return outlineCardProject(cwd, cardPath);
}

export function previewCardProject(cwd: string, cardPath: string, userName: string): CardProjectPreview {
	const { raw, ...build } = buildCardProject(cwd, cardPath);
	const card = normalizeCard(raw);
	const front = buildCardFrontSnapshot({ card: cardPath, userName }, raw, card.name);
	return { build, front, greetings: [card.firstMes, ...card.alternateGreetings],
		variables: findInitVar(card.book) ?? findSchemaDefaults(front.scripts) ?? {} };
}

/**
 * 写卡手册：全局技能根里的 card-authoring（用户可改），缺失时读发行版。
 * file 是包内相对路径（如 references/mvu.md，省略读 SKILL.md）；SKILL.md 去掉 frontmatter，参考文件原样。
 */
function readAuthoringGuide(cwd: string, file?: string): string {
	if (file !== undefined && (isAbsolute(file) || file.includes("\\") || file.includes(":") || file.split("/").some(p => p === ".." || p === "." || p === ""))) {
		throw new Error("手册文件必须是包内相对路径，例如 references/mvu.md");
	}
	const rel = file ?? "SKILL.md";
	for (const root of [join(cwd, "skills", "card-authoring"), join(cwd, "assets", "skills", "card-authoring")]) {
		const path = resolve(root, rel);
		if (!inside(resolve(root), path) || !existsSync(path)) continue;
		const raw = readFileSync(path, "utf8");
		if (rel !== "SKILL.md") return raw;
		const lines = raw.split(/\r?\n/);
		if (lines[0]?.trim() === "---") {
			const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
			if (end > 0) return lines.slice(end + 1).join("\n").trim();
		}
		return raw.trim();
	}
	return file ? `没有找到手册文件：${rel}` : "没有找到写卡手册。";
}

/** REST 与助手共用操作，避免两套读写语义。源码可直接用原生 read/edit/write 修改。 */
export function cardProjectOperation(cwd: string, cardPath: string, args: Record<string, unknown>): unknown {
	const requiredString = (key: string) => {
		if (typeof args[key] !== "string") throw new Error("缺少参数：" + key);
		return args[key] as string;
	};
	switch (args.action) {
		case "inspect": return inspectCardProject(cwd, cardPath);
		case "outline": {
			const outline = outlineCardProject(cwd, cardPath);
			if (typeof args.section === "string") {
				const section = outline.sections.find(s => s.id === args.section);
				if (!section) throw new Error("未知板块：" + args.section);
				return { ...outline, sections: [section] };
			}
			if (args.full === true) return outline;
			// 默认只给板块概览；E 类卡的条目上百，逐板块再读
			return { ...outline, sections: outline.sections.map(s => ({ id: s.id, label: s.label, size: s.size, count: s.items.length, disabled: s.items.filter(i => !i.enabled).length })) };
		}
		case "assign": return assignCardSection(cwd, cardPath, requiredString("key"), typeof args.section === "string" && args.section ? args.section : null);
		case "prepare": return prepareCardProject(cwd, cardPath);
		case "add": {
			const kind = requiredString("kind");
			if (!["lore", "greeting", "regex", "script"].includes(kind)) throw new Error("kind 只能是 lore / greeting / regex / script");
			return addCardNode(cwd, cardPath, kind as AddKind, record(args.fields) ?? {});
		}
		case "remove": return removeCardNode(cwd, cardPath, requiredString("key"), false);
		case "restore": return removeCardNode(cwd, cardPath, requiredString("key"), true);
		case "meta": {
			const fields = record(args.fields);
			if (!fields) throw new Error("缺少参数：fields");
			return setCardMeta(cwd, cardPath, requiredString("key"), fields);
		}
		case "cover": return setCardCover(cwd, cardPath, args.data === null || args.data === undefined ? null : requiredString("data"));
		case "rebase": return rebaseCardProject(cwd, cardPath);
		case "discard": return discardCardProject(cwd, cardPath);
		case "guide": return { text: readAuthoringGuide(cwd, typeof args.file === "string" && args.file ? args.file : undefined) };
		case "read": {
			const result = readCardResource(cwd, cardPath, requiredString("resource"));
			if (args.offset === undefined && args.limit === undefined) return result;
			const lines = result.text.split("\n");
			const offset = typeof args.offset === "number" ? Math.max(1, Math.floor(args.offset)) : 1;
			const limit = typeof args.limit === "number" ? Math.max(1, Math.min(2000, Math.floor(args.limit))) : 200;
			return { ...result, text: lines.slice(offset - 1, offset - 1 + limit).join("\n"), offset,
				totalLines: lines.length, nextOffset: offset - 1 + limit < lines.length ? offset + limit : null };
		}
		case "write": return writeCardResource(cwd, cardPath, requiredString("resource"), requiredString("text"), requiredString("version"));
		case "check": {
			const { raw: _raw, ...report } = buildCardProject(cwd, cardPath);
			return report;
		}
		case "apply": return applyCardProject(cwd, cardPath, requiredString("buildHash"));
		case "undo": return undoCardProject(cwd, cardPath);
		default: throw new Error("未知创作操作");
	}
}
