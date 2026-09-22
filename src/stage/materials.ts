/**
 * 台上素材装载（PLAN-RP-HARNESS M1）。
 *
 * 每拍开演前从磁盘现读：配置 / 角色卡 / 世界书 / 预设（宏求值）。
 * 引擎每回合调用一次——改卡、改预设、挂书即时生效，没有热重载缝隙。
 * 顺带刷新显示层折叠标签注册表（server 侧单实例，与扩展无共享）。
 *
 * 本模块只读盘、不写盘、零 pi 依赖。
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveCardSpace } from "../cardspace.ts";

import { loadCardFile, applyMacros, readCardRawJson } from "../card.ts";
import { promptRules, extractRegexScripts, type DisplayRule } from "../cardfront.ts";
import {
	applyDisabledLore,
	constantEntries,
	loadLorebookFile,
	mergeEntries,
	mountedLorebookPaths,
	overlayPathFor,
	setMountedLorebooks,
} from "../lorebook.ts";
import { addHistoryStripTags, resetDisplayTagExtras } from "../postprocess.ts";
import type { ProtocolDrop } from "../protocol-detect.ts";
import { applyDeclarations, declarationPathFor, readDeclaration } from "../lorebook-declare.ts";
import { agentRulesPath, cardRulesPath, globalRulesPath, readUserRules, type UserRules } from "../user-rules.ts";
import { renderForModel } from "../prompt-entries.ts";
import { CARD_AGENTS_FILE } from "../card-agents.ts";
import { stripMvuRuleEntries } from "../mvu.ts";
import { extractAuthorScripts } from "../authorScripts.ts";
import {
	type AssembledPiece,
	type AssembleReportItem,
	type DepthPiece,
	type MarkerMaterials,
} from "../preset-assemble.ts";
import { loadPresetDoc, type PresetDoc } from "../preset-doc.ts";
import { resolveConfigPath } from "../paths.ts";
import { DEFAULT_CONFIG, type CharacterCard, type LorebookEntry, type RpConfig } from "../types.ts";

/**
 * 预设格式栈的已知标签：**只在送模历史整块剥**（防往拍模仿），显示层照常渲染。
 * 这些是用户要看的产出（咪咪点评/选择框/变量面板），不是脚手架。
 */
const FORMAT_STACK_TAGS = ["w2g", "catsay", "UpdateVariable", "JSONPatch", "Analysis", "draft_notes", "wfeeling"];

/**
 * 预设装配产物的一片。marker 槽位填的是梨园材料（卡/世界书/人设的原文），
 * 预设块填的是宏求值后的原文——两者都不加 harness 引导语。
 */
export type { AssembledPiece } from "../preset-assemble.ts";

export interface StageMaterials {
	config: RpConfig;
	card: CharacterCard;
	cardAuthorScripts: ReturnType<typeof extractAuthorScripts>;
	/** 已挂载世界书 + 补充设定集 overlay，禁用项与外部插件协议条目已剔除 */
	entries: LorebookEntry[];
	/** 预设文档（原文 + 归一条目）；null＝未配置且无默认预设 */
	presetDoc: PresetDoc | null;
	/** 装配产物：chatHistory 槽位之前的片段（含已归位的 marker 材料），按预设作者原序 */
	presetBefore: AssembledPiece[];
	/** injection_position=1 的深度注入片段（数据层保真；消费待后续里程碑接入） */
	presetDepth: DepthPiece[];
	/**
	 * **真交了料**的 marker 槽位 id——梨园的材料确实进了预设作者指定的位置。
	 * 没进的槽位由梨园按兜底版式补，避免卡/人设内容丢失。
	 *
	 * 判据是「填了」不是「声明了」：预设声明槽位、梨园却没料可交（如人设正文为空）时，
	 * 那个位置是空的，兜底必须照常补。一名两义正是「用户身份整段消失」那个 bug 的成因。
	 */
	filledMarkers: Set<string>;
	/** skill 一等素材位（M-R2）：工作目录 skills/<name>/SKILL.md 扫描产物 */
	skillFiles: SkillFile[];
	/** 装配报告：每块去向（engine 落盘 .liyuan/preset-assembly.json） */
	presetAssembly: AssembleReportItem[];
	/** 历史前段全部求值后内容——机械规则提取（extractDraftRules）用 */
	presetRuleTexts: string[];
	/** marker 槽位材料（卡/世界书/人设）——引擎每拍重装历史后段时复用同一份 */
	markerMaterials: MarkerMaterials;
	/** 任一渠道有启用块——扮演规范让位给预设的判定依据 */
	presetActive: boolean;
	/** 宏求值遇到的清单外宏名（供引擎降级告警） */
	macroWarnings: string[];
	/** M-C2：被判死的外部插件协议条目（世界书通道 H 类退场，进装配报告） */
	protocolDrops: ProtocolDrop[];
	/** 用户规矩两级文件（刀2）：全局 <agentDir>/APPEND_SYSTEM.md + 卡级 cards/<卡>/APPEND_SYSTEM.md，每拍现读 */
	userRules: UserRules;
	/** 卡档案（刀3）：cards/<卡>/AGENTS.md 全文；不存在＝空串（装配走今天的投影） */
	cardAgents: string;
	/** 送模侧作者正则（promptOnly/破坏性，预设+卡）——rebuildHistory 应用，剥「作者不想让模型看」的块 */
	promptRules: DisplayRule[];
}

const resolvePath = (cwd: string, p: string): string => (isAbsolute(p) ? p : join(cwd, p));

/** 读配置（含旧字段迁移）；文件缺失/损坏回落默认 */
export function loadStageConfig(cwd: string): RpConfig {
	const configPath = resolveConfigPath(cwd);
	let raw: RpConfig = { ...DEFAULT_CONFIG };
	if (existsSync(configPath)) {
		try {
			raw = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configPath, "utf8")) as Partial<RpConfig>) };
		} catch {
			raw = { ...DEFAULT_CONFIG };
		}
	}
	return setMountedLorebooks(raw, mountedLorebookPaths(raw));
}

/** skill 文件（agentskills.io 布局：skills/<name>/SKILL.md，frontmatter name+description 必填） */
export interface SkillFile {
	name: string;
	/** 模型判断「何时该读这条」的唯一依据；随 skill_read 工具描述送达 */
	description: string;
	body: string;
	/** 存储目录名（skills/<dir>/SKILL.md；编辑器按它定位文件，通常与 name 一致） */
	dir?: string;
	root?: string;
	scope?: "global" | "card";
	shadowed?: boolean;
	/** frontmatter `disable-model-invocation: true`：对模型隐身（不上 skill_read 清单，也读不到正文）。
	 *  与办事笔记（src/skills.ts）同一个键、同一个语义；编辑器仍列出它，只有送模那一侧滤掉。 */
	disableModelInvocation?: boolean;
	/** frontmatter `mode: authoring`：只上工作模式的清单，扮演模式不见 */
	mode?: "authoring";
}

/**
 * 扫描 skills/ 目录（M-R2 §4.C）。frontmatter 缺 name/description 的包跳过（不猜）；
 * 解析是死板的数据读取——内容全部署名归包作者，harness 零改写。
 */
export function stageSkillRoot(cwd: string, scope?: "global" | "card"): string {
	const card = scope === "global" ? null : resolveCardSpace(cwd, loadStageConfig(cwd).card);
	if (scope === "card" && !card) throw new Error("当前没有卡级技能目录。");
	return card ? join(card.dir, "技能") : join(cwd, "skills");
}

function scanSkillRoot(root: string, scope: "global" | "card"): SkillFile[] {
	if (!existsSync(root)) return [];
	const out: SkillFile[] = [];
	for (const dir of readdirSync(root, { withFileTypes: true })) {
		if (!dir.isDirectory()) continue;
		const file = join(root, dir.name, "SKILL.md");
		if (!existsSync(file)) continue;
		let raw = "";
		try {
			const rel = relative(realpathSync(root), realpathSync(file));
			if (isAbsolute(rel) || rel.startsWith("..")) continue;
			raw = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		// frontmatter: --- fence, key: value lines (no regex; line-based)
		const rawLines = raw.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
		if ((rawLines[0] ?? "").trim() !== "---") continue;
		const endIdx = rawLines.findIndex((l, i) => i > 0 && l.trim() === "---");
		if (endIdx < 0) continue;
		const meta = new Map<string, string>();
		for (const line of rawLines.slice(1, endIdx)) {
			const colon = line.indexOf(":");
			if (colon > 0) meta.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
		}
		const name = meta.get("name") ?? "";
		const description = meta.get("description") ?? "";
		if (!name || !description) continue;
		out.push({
			name,
			description: description.slice(0, 1024),
			body: rawLines.slice(endIdx + 1).join("\n").trim(),
			dir: dir.name,
			root, scope,
			...(meta.get("disable-model-invocation") === "true" ? { disableModelInvocation: true } : {}),
			...(meta.get("mode") === "authoring" ? { mode: "authoring" as const } : {}),
		});
	}
	return out;
}

export function scanSkillFiles(cwd: string, includeShadowed = false): SkillFile[] {
	const global = stageSkillRoot(cwd, "global"), active = stageSkillRoot(cwd);
	const all = [...scanSkillRoot(global, "global"), ...(active !== global ? scanSkillRoot(active, "card") : [])];
	const effective = new Map(all.map((s) => [s.name, s]));
	return includeShadowed ? all.map((s) => ({ ...s, shadowed: effective.get(s.name) !== s })) : [...effective.values()];
}

export function readStageSkill(cwd: string, name: string, file = "SKILL.md", start = 0, end?: number): string | undefined {
	const skill = modelVisibleSkillFiles(cwd).find((s) => s.name === name);
	if (!skill?.root || !skill.dir) return undefined;
	const base = realpathSync(join(skill.root, skill.dir));
	if (isAbsolute(file) || file.includes("\\") || file.includes(":")) throw new Error("skill 引用必须是包内相对路径。");
	const absolute = realpathSync(resolve(base, file));
	const rel = relative(base, absolute);
	if (isAbsolute(rel) || rel.startsWith("..")) throw new Error("skill 引用超出包目录。");
	const content = file === "SKILL.md" ? skill.body : readFileSync(absolute, "utf8");
	const to = end ?? content.length;
	if (!Number.isInteger(start) || !Number.isInteger(to) || start < 0 || to < start || to > content.length) throw new Error("skill 读取范围无效。");
	return JSON.stringify({ name, scope: skill.scope, file, start, end: to, total: content.length, content: content.slice(start, to) });
}

/** 送模那一侧看得见的 skill：关掉的整条不存在（不进 skill_read 清单，也读不到正文）。
 *  编辑器与助手管理工具照旧走 scanSkillFiles，要能看见关掉的那些才改得动。 */
export function modelVisibleSkillFiles(cwd: string): SkillFile[] {
	return scanSkillFiles(cwd).filter((s) => !s.disableModelInvocation);
}

/** 装载一拍所需全部素材；卡缺失/损坏时抛错（引擎转告用户，不演） */
/**
 * 素材缓存（8/22）：按输入文件的 (mtime, size) 指纹缓存解析结果。
 *
 * **为什么值得**：本函数是「每拍现读」的——引擎里 7 个调用点（装配 1 处，
 * 外加每个工具依赖闭包各 1 处：searchLore / listLore / overlayOf / readCard / getSkill）。
 * 最贵的一步是整读并解析用户预设：狐神抚那份 5.1 MB，单次全量 ~27ms，
 * 一拍跑满 20 轮光这一件就 500ms+。会话「打开一次、新建一次」各触发一次全量装载，
 * 用户实测「加载太频繁」。
 *
 * **键**：全部输入文件的 (mtime, size)。文件新建/删除也算（不存在记 `-`），
 * 所以 `lorebook_write` 落 overlay、面板改预设、编辑器存 skill 都会在下一次调用时
 * 自动看到新内容——**没有任何调用方需要记得手动失效**（手动失效的通道必然被忘掉）。
 *
 * ⚠ 两条不进缓存：
 * 1. `resetDisplayTagExtras()` / `addHistoryStripTags()` 改的是 postprocess 的模块级注册表，
 *    扩展侧 session_start 也会重置它——**命中缓存时照样执行**，否则显示层标签随缓存漂移。
 * 2. `skillFiles` 每次现扫（scanSkillFiles ~0.4ms），skill 编辑器存盘立刻可见。
 *
 * ⚠ 不变量：**返回的对象不许被调用方原地改**（现在没人改：constantEntries/withAliases
 * 都是 map/filter 出新数组）。要改先复制。
 */
interface MaterialsCacheEntry {
	stamp: string;
	/** overlay 路径要卡名才推得出，缓存下来免得为算指纹再解析一次卡 */
	overlayFile: string;
	value: StageMaterials;
}
let materialsCache: { cwd: string; entry: MaterialsCacheEntry } | null = null;

/** 单文件指纹；不存在记 `-`（否则「删掉」会被当成「没变」） */
function fileStamp(abs: string): string {
	try {
		const s = statSync(abs);
		return `${s.mtimeMs}:${s.size}`;
	} catch {
		return "-";
	}
}

/** 除 overlay 外的全部输入指纹（overlay 单独拼，见 MaterialsCacheEntry.overlayFile） */
function inputStamp(cwd: string, config: RpConfig): string {
	const parts = [fileStamp(resolveConfigPath(cwd)), fileStamp(resolvePath(cwd, config.card))];
	for (const rel of mountedLorebookPaths(config)) {
		const abs = resolvePath(cwd, rel);
		parts.push(fileStamp(abs), fileStamp(declarationPathFor(abs)));
	}
	parts.push(fileStamp(join(cwd, ".liyuan", "preset-override.json")));
	if (config.preset) parts.push(fileStamp(resolvePath(cwd, config.preset)));
	// 用户规矩两级文件（刀2）：改完下一拍即生效，靠的就是这两个指纹
	parts.push(fileStamp(globalRulesPath()));
	parts.push(fileStamp(agentRulesPath()));
	parts.push(fileStamp(cardRulesPath(dirname(resolvePath(cwd, config.card)))));
	// 卡档案（刀3）：生成/编辑/删除下一拍即生效
	parts.push(fileStamp(join(dirname(resolvePath(cwd, config.card)), CARD_AGENTS_FILE)));
	// disabledLore 住在 config 里，已被 config 指纹覆盖
	return parts.join("|");
}

export function loadStageMaterials(cwd: string): StageMaterials {
	const config = loadStageConfig(cwd);

	// 缓存命中：指纹一致即内容一致。副作用与 skill 扫描照常走（见上方 ⚠）。
	const cached = materialsCache?.cwd === cwd ? materialsCache.entry : null;
	if (cached) {
		const stamp = `${inputStamp(cwd, config)}|${fileStamp(cached.overlayFile)}`;
		if (stamp === cached.stamp) {
			resetDisplayTagExtras();
			if (cached.value.presetDoc) addHistoryStripTags(FORMAT_STACK_TAGS);
			return { ...cached.value, skillFiles: modelVisibleSkillFiles(cwd) };
		}
	}

	const cardAbs = resolvePath(cwd, config.card);
	const card = loadCardFile(cardAbs);
	// 卡原文（含 extensions.regex_scripts）：显示/送模两侧与 cardfront 快照同源
	const cardRegexScripts = (() => {
		try {
			return extractRegexScripts(readCardRawJson(cardAbs).raw);
		} catch {
			return [];
		}
	})();
	// 卡自带运行时脚本：MVU 初值的第二种声明形式（Zod schema 的 prefault）住在这儿，
	// 场记开演前的懒建播种要用（见 src/mvu.ts seedMvuIfNeeded）。与上面同一份原文，坏卡不拖垮装载。
	const cardAuthorScripts = (() => {
		try {
			return extractAuthorScripts(readCardRawJson(cardAbs).raw, "card");
		} catch {
			return [];
		}
	})();

	// 世界书：已挂载独立书（0..N）+ 补充设定集 overlay；卡内 character_book 不自动进上下文。
	// 协议判死（刀4）＝只执行**判定数据**（书旁 <书名>.判定.json，可见可改可删）；
	// 没有判定文件的书不过滤——正则已在运行时退场，只在导入/手动检查时生产数据
	// （src/lorebook-declare.ts）。按书应用（uid 是书内的，跨书合并后再套会误杀同号）。
	const fileGroups: LorebookEntry[][] = [];
	const declarationDrops: ProtocolDrop[] = [];
	for (const rel of mountedLorebookPaths(config)) {
		const abs = resolvePath(cwd, rel);
		if (!existsSync(abs)) continue;
		const declared = applyDeclarations(loadLorebookFile(abs), readDeclaration(abs));
		declarationDrops.push(...declared.dropped);
		fileGroups.push(declared.entries);
	}
	const fileEntries = mergeEntries(...fileGroups);
	const overlayFile = overlayPathFor(cwd, card.name, config.card);
	const overlayEntries = (() => {
		if (!existsSync(overlayFile)) return [];
		const declared = applyDeclarations(loadLorebookFile(overlayFile), readDeclaration(overlayFile));
		declarationDrops.push(...declared.dropped);
		return declared.entries;
	})();
	// 用户级停用。
	const disabledApplied = applyDisabledLore(mergeEntries(fileEntries, overlayEntries), config.disabledLore);
	// 归属剥离：MVU 变量更新规则条目已被 src/mvu.ts 认领、读者是场记，主模型不该再收到同一份。
	// 判据是归属不是签名（铁律三不禁），无树的书一律不动——见 stripMvuRuleEntries 的头注。
	const mvuFiltered = stripMvuRuleEntries(disabledApplied);
	const entries = mvuFiltered.entries;
	const protocolDrops = [
		...declarationDrops,
		...mvuFiltered.dropped.map((d) => ({
			title: d.title,
			channel: "lorebook" as const,
			chars: d.chars,
			family: "mvu",
			label: "MVU 变量更新规则（归属：场记）",
			signals: ["own:mvu-rules"],
		})),
	];

	// 预设：工作草稿（preset-override.json）优先，与预设页签热编辑一致。落盘即原文，这里只读不转换。
	const readDoc = (abs: string, name: string): PresetDoc | null => {
		if (!existsSync(abs)) return null;
		try {
			return loadPresetDoc(JSON.parse(readFileSync(abs, "utf8")), name);
		} catch {
			return null;
		}
	};
	let presetDoc: PresetDoc | null = null;
	if (config.preset) {
		const name = (config.preset.split(/[\\/]/).pop() ?? config.preset).replace(/\.json$/i, "");
		presetDoc =
			readDoc(join(cwd, ".liyuan", "preset-override.json"), name) ?? readDoc(resolvePath(cwd, config.preset), name);
	}
	// 无预设＝真的无预设（2026-09-08，docs/PLAN-AGENT-SLOTS.md §三）。
	// 曾有一份 presets/默认.json 在这里兜底文风（7 块 299 字），已整份删除：
	// 「用户主权」那句与「用户输入本身就是替角色行动」结构性互斥——实测同卡同输入
	// 两拍，low 档 47%(514/1104 字)、high 档 39%(1965/4986 字) 的思考耗在跟它谈判边界上。
	// 其余六句是文风要求：无预设态平淡是**条件不是回归**，要文风写 APPEND_SYSTEM.md（用户自己的槽）。

	// 卡档案（刀3，src/card-agents.ts）：文件在场 ⇒ 卡常驻内容以文件为准，
	// marker 材料里的卡字段/蓝灯同步让位（预设作者的位置留着，但不双份喂卡内容）。
	const cardAgentsFile = join(dirname(cardAbs), CARD_AGENTS_FILE);
	let cardAgents = "";
	try {
		if (existsSync(cardAgentsFile)) cardAgents = readFileSync(cardAgentsFile, "utf8");
	} catch {
		cardAgents = "";
	}
	// 条目引擎：卡档案的关闭节（如不要某个状态栏）与备注注释不进送模面；
	// 「文件存在」的判据看原文（全关也是用户的明确选择）。
	// 档案里带 `（世界书·书名）` 的条目是挂载书蓝灯的镜像，由 server/rest.ts syncLorebookMirror
	// 在每次配置刷新时重写（挂上就有、卸下就没、书改了跟着改）——文件本身就是实时的，这里不另判。
	const cardAgentsRaw = cardAgents;
	cardAgents = renderForModel(cardAgents);
	const agentsActive = cardAgentsRaw.trim().length > 0;

	// marker 材料：梨园按酒馆的槽位交货，**位置由预设作者的 prompt_order 决定**。
	// 填的是原文——包装（标题/小节名）归预设作者，梨园不替他们加话（铁律一）。
	const macroCtx = { charName: card.name, userName: config.userName };
	const markerMaterials: MarkerMaterials = {};
	const putSlot = (slot: keyof MarkerMaterials, text: string | undefined): void => {
		if (text && text.trim()) markerMaterials[slot] = applyMacros(text, macroCtx);
	};
	if (!agentsActive) putSlot("charDescription", card.description);
	if (!agentsActive) putSlot("charPersonality", card.personality);
	if (!agentsActive) putSlot("scenario", card.scenario);
	if (!agentsActive) putSlot("dialogueExamples", card.mesExample);
	putSlot("personaDescription", config.userPersona);
	// 梨园的 LorebookEntry 没有 ST 的 before/after position，常驻条目整份交 worldInfoBefore
	const constantLore = constantEntries(entries);
	if (!agentsActive && constantLore.length > 0) {
		putSlot(
			"worldInfoBefore",
			constantLore.map((e) => `- ${e.comment ? `【${e.comment}】` : ""}${e.content}`).join("\n"),
		);
	}

	// 装载的预设**不再直接进提示词**（2026-09-12 用户定序：装载即转译）：它经引擎按开关编译、
	// 声明分流后已落成卡文件里的（预设）条目（server/rest.ts syncPresetTranslation），模型看到的
	// 就是 userRules / cardAgents 那两份。这里再装配一遍就是双份喂。预设文档仍装载着——
	// samplers、作者正则、名字要从它取；marker 材料照旧准备（梨园自己的兜底槽位用得着）。
	const presetBefore: AssembledPiece[] = [];
	const presetDepth: DepthPiece[] = [];
	const filledMarkers = new Set<string>();
	const presetAssembly: AssembleReportItem[] = [];
	const presetRuleTexts: string[] = [];
	const presetActive = false;
	const unsupported = new Set<string>();

	// 显示层折叠标签：**猜名单已退役（8/19）**。
	//
	// 原本这里扫预设正文、猜「哪些标签是思维链脚手架」，猜中的登记成 fold ⇒ 显示层整块删。
	// 实测它对狐神抚预设猜出 11 个：`draft fox_front fox_front_insert fox-front-view`
	// **`content`** `ft_clock Fox正文前思考 think html head meta`——其中 `content` 正是
	// 作者装**正文**的标签，于是每一拍的正文都被梨园自己整块删掉（用户实测「正文被删」的
	// 真因，与作者正则无关）；`html/head/meta` 更说明这类猜测的污染面。
	//
	// 铁律三：识别「别人发明的名字」的名单只许冻结、收缩、删除。折不折叠归作者的
	// regex_scripts（本预设自带：depth≤2 做成思维链卡、depth≥3 整块删），梨园不猜。
	// 名称模式 FOLD_NAME_RE 仍在（thinking/draft/思考… 那批公有名，冻结不动）。
	//
	// 格式栈标签（catsay/w2g…）仍只注册到**历史剥**通道——它们是用户要看的产出，
	// 混进 extraFold 会让显示层连内容一起删（8/05：模型写了咪咪点评，屏上没有）。
	resetDisplayTagExtras();
	if (presetDoc) {
		addHistoryStripTags(FORMAT_STACK_TAGS);
	}

	const materials: StageMaterials = {
		config,
		card,
		cardAuthorScripts,
		entries,
		presetDoc,
		presetBefore,
		presetDepth,
		filledMarkers,
		skillFiles: modelVisibleSkillFiles(cwd),
		presetAssembly,
		presetRuleTexts,
		markerMaterials,
		presetActive,
		macroWarnings: [...unsupported],
		protocolDrops,
		// 条目引擎只作用送模面：readUserRules 给原文（REST/编辑器往返要无损），
		// 这里渲染成开启条目＋零注释的送模文本
		userRules: ((r) => ({ global: renderForModel(r.global), agent: renderForModel(r.agent), card: renderForModel(r.card) }))(readUserRules(dirname(cardAbs))),
		cardAgents,
		// 送模侧作者正则：预设 + 卡（与 cardfront 显示侧同源；promptOnly/破坏性规则）
		promptRules: promptRules([...(presetDoc?.raw?.extensions?.regex_scripts ?? []), ...cardRegexScripts]),
	};

	// 指纹在**装载之后**取：装载期间若有人改文件，这次算出的指纹属于旧内容，
	// 下一次调用会因指纹不符重算（宁可多算一次，不可缓存一份读了一半的世界）。
	materialsCache = {
		cwd,
		entry: {
			stamp: `${inputStamp(cwd, config)}|${fileStamp(overlayFile)}|${fileStamp(declarationPathFor(overlayFile))}`,
			overlayFile,
			value: materials,
		},
	};
	return materials;
}

/**
 * 历史后段：装载的预设已转译成卡文件条目（见 loadStageMaterials 里的说明），历史后段随之
 * 并入常驻——每拍不再重装。保留签名给 engine 的调用点；恒为 undefined。
 */
export function assemblePresetAfter(_m: StageMaterials, _userText: string): AssembledPiece[] | undefined {
	return undefined;
}

/** 常驻世界书条目（enabled+constant，按 order 排序）——system prompt 素材 */
export function constantLoreOf(m: StageMaterials): LorebookEntry[] {
	return constantEntries(m.entries);
}
