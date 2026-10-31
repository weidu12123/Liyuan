/**
 * 卡的板块投影：把原包按 spec 结构判据分到作者心智的板块里。
 *
 * 判据只认公开格式与生态发行的协议（世界书的 position/constant/keys、正则的 placement/promptOnly/
 * markdownOnly、脚本声明、`<UpdateVariable>`/`[initvar]`、EJS 标签），全部复用既有模块，不认作者措辞。
 * 结构分不开的（人物 vs 世界观、状态栏 vs 消息前端）不猜：由声明落成数据覆盖默认板块。
 */
import { createHash } from "node:crypto";
import type { CardOutline, CardOutlineItem, CardOutlineSection, CardResource, CardSectionId } from "./card-authoring-types.ts";
import { CARD_SECTION_LABELS } from "./card-authoring-types.ts";
import { displayRules, promptRules } from "./cardfront.ts";
import { isMvuRulesEntry } from "./mvu.ts";
import { isProtocolContent } from "./protocol-detect.ts";

export type CardSectionDeclarations = Record<string, CardSectionId>;
const CARD_SECTION_ORDER: CardSectionId[] = [
	"settings", "greetings", "lore-knowledge", "lore-constant", "rules", "mvu", "ui", "prompt-regex", "scripts", "ejs", "deps", "other",
];
export const isCardSectionId = (v: unknown): v is CardSectionId => typeof v === "string" && Object.hasOwn(CARD_SECTION_LABELS, v);

type R = Record<string, unknown>;
const record = (v: unknown): R | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as R : null;
const str = (v: unknown): string => typeof v === "string" ? v : "";
const keyOf = (prefix: string, path: string[]) => prefix + "-" + createHash("sha256").update(JSON.stringify(path)).digest("hex").slice(0, 16);

const HTML_RE = /<\s*(div|span|style|script|table|details|summary|img|p|h[1-6]|body|html)\b/i;
const EJS_RE = /<%[\s\S]*?%>/;
const INITVAR_RE = /\[\s*initvar\s*\]/i;
const URL_RE = /https?:\/\/[^\s'"`<>()]+/g;
const POSITION = ["before_char", "after_char", "an_top", "an_bottom", "at_depth", "em_top", "em_bottom"];

/** 酒馆 v3 条目：`extensions.position` 是数字枚举（4＝指定深度，此时 depth 才有意义），`position` 字段是 v2 的字符串 */
function entryPosition(e: R): { position: string; depth?: number; role?: number } {
	const ext = record(e.extensions) ?? {};
	const p = typeof ext.position === "number" ? POSITION[ext.position] ?? "p" + ext.position : str(e.position) || "?";
	if (p !== "at_depth") return { position: p };
	return { position: p, depth: typeof ext.depth === "number" ? ext.depth : undefined, role: typeof ext.role === "number" ? ext.role : undefined };
}

function loreSection(e: R): CardSectionId {
	const content = str(e.content);
	const comment = str(e.comment);
	if (!content.trim()) return "other";
	if (EJS_RE.test(content)) return "ejs";
	if (INITVAR_RE.test(comment) || INITVAR_RE.test(content) || isProtocolContent(content, comment) || isMvuRulesEntry({ comment, content })) return "mvu";
	const keyed = Array.isArray(e.keys) && e.keys.some(k => str(k).trim());
	if (keyed) return "lore-knowledge";
	if (e.constant === true) return "lore-constant";
	return "other";
}

/**
 * 正则角色复用 cardfront 的两个筛选，不另写判据。停用的按启用时的角色归类，enabled 单独记。
 * 显示侧且替换体带 HTML 才是「界面」；其余（裁剪、送模、纯文本替换）都是文本正则。
 */
function regexSection(r: R): CardSectionId {
	const probe = { ...r, disabled: false };
	if (displayRules([probe]).length && HTML_RE.test(str(r.replaceString))) return "ui";
	if (displayRules([probe]).length || promptRules([probe]).length) return "prompt-regex";
	return "other";
}

function collectUrls(text: string, into: Map<string, number>) {
	for (const m of text.matchAll(URL_RE)) {
		let host: string;
		try { host = new URL(m[0]).host; } catch { continue; }
		if (host) into.set(host, (into.get(host) ?? 0) + 1);
	}
}

interface OutlineMarks { removed: Set<string>; added: Set<string> }
const underAny = (path: string[], marks: Set<string>) => {
	for (let i = path.length; i >= 1; i--) if (marks.has(JSON.stringify(path.slice(0, i)))) return true;
	return false;
};

export function buildCardOutline(raw: R, resources: CardResource[], declarations: CardSectionDeclarations = {}, marks?: OutlineMarks): CardOutline {
	const data = record(raw.data) ?? raw;
	const prefix = data === raw ? [] : ["data"];
	const byPath = new Map<string, CardResource>();
	for (const r of resources) byPath.set(JSON.stringify(r.path), r);
	const resourceAt = (path: string[]) => byPath.get(JSON.stringify(path));
	const items: CardOutlineItem[] = [];
	const push = (item: Omit<CardOutlineItem, "section" | "declared">) => {
		const declared = declarations[item.key];
		const flags = item.path && marks
			? { ...(underAny(item.path, marks.removed) ? { removed: true } : {}), ...(underAny(item.path, marks.added) ? { addition: true } : {}) }
			: {};
		items.push({ ...item, ...flags, section: declared ?? item.defaultSection, declared: declared !== undefined && declared !== item.defaultSection });
	};
	const owner = (field: string) => Object.hasOwn(data, field) ? data : raw;
	const pathOf = (field: string, ...rest: string[]) => [...(owner(field) === raw ? [] : prefix), field, ...rest];
	const urls = new Map<string, number>();

	// 作品设置：卡名、封面、作者信息与 spec 的人物字段（用户定案：人物＝卡名，并入设置）
	const settingsFields: Array<[string, string]> = [
		["name", "卡名"], ["description", "描述"], ["personality", "性格"], ["scenario", "场景"], ["mes_example", "对话示例"], ["creator_notes", "作者注"],
	];
	for (const [field, label] of settingsFields) {
		const value = owner(field)[field];
		const resource = resourceAt(pathOf(field));
		push({ key: resource?.id ?? keyOf("field", pathOf(field)), defaultSection: "settings", label, resources: resource ? [resource.id] : [],
			size: str(value).length, enabled: true, facts: { field } });
	}
	const meta = { creator: str(data.creator), version: str(data.character_version), tags: Array.isArray(data.tags) ? data.tags.length : 0, spec: (str(raw.spec) + " " + str(raw.spec_version)).trim() };
	push({ key: "settings-meta", defaultSection: "settings", label: "作者 / 版本 / 标签", resources: [], path: prefix, size: 0, enabled: true, facts: meta });
	const depthPrompt = record(record(data.extensions)?.depth_prompt);
	if (depthPrompt && str(depthPrompt.prompt).trim()) push({ key: "settings-depth-prompt", defaultSection: "settings", label: "深度提示", resources: [],
		path: [...prefix, "extensions", "depth_prompt"], size: str(depthPrompt.prompt).length, enabled: true, facts: { depth: Number(depthPrompt.depth ?? 0), role: str(depthPrompt.role) } });

	// 创作规则：spec 自带的两个指令槽位
	for (const [field, label] of [["system_prompt", "卡内系统提示"], ["post_history_instructions", "卡内末端提示"]] as const) {
		const resource = resourceAt(pathOf(field));
		push({ key: resource?.id ?? keyOf("field", pathOf(field)), defaultSection: "rules", label, resources: resource ? [resource.id] : [],
			size: str(owner(field)[field]).length, enabled: true, facts: { field } });
	}

	// 开场白
	const greeting = (path: string[], label: string, value: unknown) => {
		const text = str(value);
		const resource = resourceAt(path);
		collectUrls(text, urls);
		push({ key: resource?.id ?? keyOf("greeting", path), defaultSection: "greetings", label, resources: resource ? [resource.id] : [], ...(path[path.length - 1] === "first_mes" ? {} : { path }), size: text.length, enabled: true,
			facts: { html: HTML_RE.test(text), script: /<script\b/i.test(text), placeholder: /<StatusPlaceHolderImpl\/>/.test(text), macro: /\{\{[^}]+\}\}/.test(text) } });
	};
	greeting(pathOf("first_mes"), "默认开场", owner("first_mes").first_mes);
	const alts = owner("alternate_greetings").alternate_greetings;
	if (Array.isArray(alts)) alts.forEach((g, i) => greeting(pathOf("alternate_greetings", String(i)), "备选开场 " + (i + 1), g));
	const groupOnly = owner("group_only_greetings").group_only_greetings;
	if (Array.isArray(groupOnly)) groupOnly.forEach((g, i) => greeting(pathOf("group_only_greetings", String(i)), "群聊开场 " + (i + 1), g));

	// 世界书：书本身的字段是一项，条目各一项
	const book = record(owner("character_book").character_book);
	if (book) {
		const bookFacts: CardOutlineItem["facts"] = {};
		for (const f of ["name", "description"] as const) if (str(book[f])) bookFacts[f] = str(book[f]);
		for (const f of ["scan_depth", "token_budget"] as const) if (typeof book[f] === "number") bookFacts[f] = book[f] as number;
		if (typeof book.recursive_scanning === "boolean") bookFacts.recursive_scanning = book.recursive_scanning;
		push({ key: "book", defaultSection: "settings", label: "世界书设置", resources: [], path: pathOf("character_book"), size: 0, enabled: true, facts: bookFacts });
	}
	if (book?.entries && typeof book.entries === "object") {
		for (const [key, value] of Object.entries(book.entries)) {
			const e = record(value);
			if (!e) continue;
			const path = pathOf("character_book", "entries", key, "content");
			const resource = resourceAt(path);
			const content = str(e.content);
			const pos = entryPosition(e);
			const ext = record(e.extensions) ?? {};
			collectUrls(content, urls);
			const facts: CardOutlineItem["facts"] = { position: pos.position, constant: e.constant === true, keys: Array.isArray(e.keys) ? e.keys.length : 0 };
			if (pos.depth !== undefined) facts.depth = pos.depth;
			if (pos.role !== undefined) facts.role = pos.role;
			if (typeof e.insertion_order === "number") facts.order = e.insertion_order;
			if (typeof ext.probability === "number" && ext.probability !== 100) facts.probability = ext.probability;
			if (e.selective === true && Array.isArray(e.secondary_keys) && e.secondary_keys.length) facts.secondaryKeys = e.secondary_keys.length;
			if (HTML_RE.test(content)) facts.html = true;
			if (typeof e.id === "number" || typeof e.id === "string") facts.id = e.id;
			push({ key: resource?.id ?? keyOf("lore", path), defaultSection: loreSection(e), label: str(e.comment || e.name) || "条目 " + key,
				resources: resource ? [resource.id] : [], path: path.slice(0, -1), size: content.length, enabled: e.enabled !== false, facts });
		}
	}

	const extensions = record(data.extensions);
	// 作者正则
	if (Array.isArray(extensions?.regex_scripts)) extensions.regex_scripts.forEach((value, i) => {
		const r = record(value);
		if (!r) return;
		const path = [...prefix, "extensions", "regex_scripts", String(i)];
		const pattern = resourceAt([...path, "findRegex"]);
		const template = resourceAt([...path, "replaceString"]);
		const replace = str(r.replaceString);
		collectUrls(replace, urls);
		const placement = Array.isArray(r.placement) ? r.placement.map(Number).join(",") : "";
		const find = str(r.findRegex).trim();
		// 绑定子集：find 是一个字面标签/占位符（无正则元字符），可无损解为「标签 → 模板」
		const literalTag = /^<[A-Za-z][\w:-]*\s*\/?>$/.test(find) || /^<[A-Za-z][\w:-]*>[\s\S]*<\/[A-Za-z][\w:-]*>$/.test(find) && !/[\\^$.*+?()[\]{}|]/.test(find);
		const facts: CardOutlineItem["facts"] = { placement, markdownOnly: r.markdownOnly === true, promptOnly: r.promptOnly === true,
			html: HTML_RE.test(replace), script: /<script\b/i.test(replace), placeholder: find === "<StatusPlaceHolderImpl/>", literalTag };
		if (typeof r.minDepth === "number") facts.minDepth = r.minDepth;
		if (typeof r.maxDepth === "number") facts.maxDepth = r.maxDepth;
		push({ key: keyOf("regex", path), defaultSection: regexSection(r), label: str(r.scriptName) || "正则 " + (i + 1),
			resources: [pattern?.id, template?.id].filter((id): id is string => Boolean(id)), path, size: str(r.findRegex).length + replace.length,
			enabled: r.disabled !== true, facts });
	});
	// 助手脚本与卡级变量
	for (const ns of ["TavernHelper", "tavern_helper"]) {
		const helper = record(extensions?.[ns]);
		if (!helper) continue;
		if (Array.isArray(helper.scripts)) helper.scripts.forEach((value, i) => {
			const s = record(value);
			if (!s) return;
			const path = [...prefix, "extensions", ns, "scripts", String(i), "content"];
			const resource = resourceAt(path);
			const content = str(s.content);
			const before = new Map(urls);
			collectUrls(content, urls);
			const remote = [...urls.keys()].filter(h => (urls.get(h) ?? 0) > (before.get(h) ?? 0));
			const button = record(s.button);
			const buttons = Array.isArray(button?.buttons) ? button.buttons.length : 0;
			const importOnly = content.trim().split("\n").every(line => !line.trim() || /^\s*import\b/.test(line));
			push({ key: resource?.id ?? keyOf("script", path), defaultSection: "scripts", label: str(s.name) || "脚本 " + (i + 1),
				resources: resource ? [resource.id] : [], path: path.slice(0, -1), size: content.length, enabled: s.enabled !== false,
				facts: { type: str(s.type), buttons, importOnly, remote: remote.length, data: Object.keys(record(s.data) ?? {}).length } });
		});
		const variables = record(helper.variables);
		if (variables) push({ key: keyOf("variables", [...prefix, "extensions", ns, "variables"]), defaultSection: "mvu", path: [...prefix, "extensions", ns, "variables"],
			label: "卡级变量初值", resources: [], size: JSON.stringify(variables).length, enabled: true, facts: { keys: Object.keys(variables).length, namespace: ns } });
	}
	// 外部依赖：按主机汇总
	for (const [host, count] of [...urls.entries()].sort((a, b) => b[1] - a[1])) push({ key: keyOf("dep", [host]), defaultSection: "deps", label: host,
		resources: [], size: 0, enabled: true, facts: { references: count } });

	const sections: CardOutlineSection[] = CARD_SECTION_ORDER.map(id => ({ id, label: CARD_SECTION_LABELS[id], items: [], size: 0 }));
	const bySection = new Map(sections.map(s => [s.id, s]));
	for (const item of items) {
		const section = bySection.get(item.section)!;
		section.items.push(item);
		section.size += item.size;
	}
	return { sections, declared: items.filter(i => i.declared).length };
}
