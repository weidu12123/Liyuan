/**
 * 场记（scribe）：旁侧廉价模型——每轮结束后从正文抽取世界状态补丁（纯函数，零 pi 依赖）。
 *
 * 设计：记账从主演手里拿走（D10：产出是数据不是文字）。
 * 连续性/代打等事后审查已移除（费 token 且用户反馈无用）。
 */

import type { WorldState } from "./types.ts";
import { formatMvuTree, type MvuTree } from "./mvu.ts";

/**
 * MVU 记账上下文（仅 MVU 卡有；见 src/mvu.ts）。给场记看「这张卡还有棵状态树，当前长这样、
 * 更新规则如是」，让它读完本拍连树该改哪些值一起判断。判断在模型，落值由 applyMvuPatch 执行。
 */
export interface ScribeMvuContext {
	/** 当前 MVU 树（本拍开演前） */
	tree: MvuTree;
	/** 卡自带的「变量更新规则」原文（哪些字段何时该动；来自世界书条目，可空） */
	rules?: string;
}

export interface ScribePromptInput {
	/** 当前世界状态（JSON 序列化前的对象） */
	state: WorldState;
	/** 本轮用户输入文本 */
	userText: string;
	/** 本轮助手正文（最终叙事文本） */
	assistantText: string;
	/** 主要角色名（账本规范名提示） */
	charName: string;
	/** 用户角色名 */
	userName: string;
	/** MVU 卡的变量树上下文（非 MVU 卡不传 → prompt 不含 MVU 段，行为与旧版逐字一致） */
	mvu?: ScribeMvuContext;
	/**
	 * agent 自建面板的数据树（只列**声明了数据**的活跃面板；没有则不传 → prompt 不含面板段）。
	 * 与 mvu 是同一件事换个主人：那棵是卡的树，这些是梨园自己面板的树。
	 */
	panels?: Array<{ name: string; tree: MvuTree }>;
	/**
	 * @deprecated 已不再做先斩后奏检测；保留字段以免旧调用方报错，忽略。
	 */
	detectUnaskedTurn?: boolean;
}

export interface ScribeResult {
	/** 状态补丁（applyPatch 语义），无变化为 {} */
	patch: Record<string, unknown>;
	/**
	 * MVU 树补丁：平铺 `{ "路径.用点分隔": 新值 }`（applyMvuPatch 语义）。
	 * 非 MVU 卡 / 无变化时为 undefined 或 {}。模型只填「哪条路径→什么新值」，不碰任何卡方言。
	 */
	mvuPatch?: Record<string, unknown>;
	/**
	 * 面板数据补丁：`{ "面板名": { "路径.用点分隔": 新值 } }`。
	 * 按面板分层而不是把面板名拼进路径——面板名是用户/agent 起的，里面真有点号就会切错。
	 */
	panelPatch?: Record<string, Record<string, unknown>>;
	/** 恒为空：连续性审查已关闭 */
	warnings: string[];
	/** 恒为 null：先斩后奏审查已关闭 */
	unaskedTurn: string | null;
}

export function buildScribeTurnPrompt(input: ScribePromptInput): { systemPrompt: string; userText: string } {
	const { state, userText, assistantText, charName, userName, mvu } = input;
	const panels = input.panels?.filter((p) => p.tree && typeof p.tree === "object") ?? [];
	const knownCharacters = Object.keys(state.characters);
	const nameGuide = knownCharacters.length
		? `名字必须使用账本中已有的写法（当前已有：${knownCharacters.join("、")}；用户角色「${userName}」）`
		: `用户角色写作「${userName}」`;

	// MVU 段：仅 MVU 卡追加。非 MVU 卡两处均为空串 → prompt 与旧版逐字一致（守回归）。
	const mvuSystemSection = mvu
		? `

这张卡另有一棵**状态树**（驱动卡上的状态栏面板）。多输出一个字段：
"mvu_patch"：从本轮对话提取该树需要更新的值，形如 { "路径.用点分隔": 新值 }（如 {"user.背包.金币":480,"世界.当前地点":"裂谷城"}）。
- 路径照抄下面【状态树·当前值】里出现的写法；只列**发生变化**的路径，值给变化后的完整新值（数字给数字、字符串给字符串、整段替换就给对象）。
- 判断依据是本轮剧情**真的发生了什么**，不是凭空推进；无变化则 "mvu_patch" 为 {}。
- 只填路径与新值，不要写 op/JSONPatch/UpdateVariable 之类任何指令语法。`
		: "";

	// 面板段：仅在有「声明了数据的面板」时追加。没有则为空串 → prompt 与旧版逐字一致（守回归）。
	const panelSystemSection = panels.length
		? `

剧中还有 ${panels.length} 个展示面板，各自带一棵数据树（面板的外观是写死的模板，屏幕上显示的值来自这些树）。多输出一个字段：
"panel_patch"：形如 { "面板名": { "路径.用点分隔": 新值 } }。
- 面板名与路径都照抄下面【面板数据·当前值】里的写法；只列**发生变化**的面板与路径。
- 判断依据同上：本轮剧情真的发生了什么；无变化则 "panel_patch" 为 {}。`
		: "";

	const systemPrompt = `你是一场角色扮演的场记。阅读【当前账本】与【本轮对话】，只做一件事：输出 JSON，更新需要记账的持久变化。

输出唯一字段：
"patch"：从本轮对话中提取需要记账的持久变化。字段语义：
- "time" / "location"：字符串，整体替换。剧内时间推移（入夜、次日清晨、数日后）必须更新 time。
- "characters"：{ "名字": { "affinity"?, "status"?, "notes"?, "at"? } }，按字段合并。affinity 为 -100..100 的对${userName}态度值，基于账本当前值小步调整（通常 ±1~10）。"at" 是该角色此刻所在地，与 location 同一写法；离开当前场景的人写他去了哪。${nameGuide}；只有全新出场的人物才建新条目，键用正文中的人名——不要把作品/剧本标题（如「${charName}」这类非人名）当作角色。
- "inventory"：字符串数组，整体替换——只在物品归属变化时给出变化后的完整清单，条目注明归属（如「黄铜怀表（${userName}持有）」）。
- "flags"：键值对，按键合并（值为字符串）。
- "plot_threads"：字符串数组，整体替换——新增或了结剧情线时给出完整清单。
要点：否定性事件也要记账（赠礼被拒→物品仍在原主处；承诺被收回→记入 flags）；新的承诺、约定、伏笔进 plot_threads；没有变化的字段不要出现在 patch 中；完全无变化则 "patch" 为 {}。${mvuSystemSection}${panelSystemSection}

只输出 JSON 对象，例如 {"patch":{...}${mvu ? `,"mvu_patch":{...}` : ""}${panels.length ? `,"panel_patch":{...}` : ""}} 或 {"patch":{}${mvu ? `,"mvu_patch":{}` : ""}${panels.length ? `,"panel_patch":{}` : ""}}。不要输出 warnings、不要输出其他文字。`;

	// MVU 树当前值 + 更新规则：放 user 段（数据不是指令），供场记判断哪些值该动。
	const mvuUserSection = mvu
		? `

【状态树·当前值】
${formatMvuTree(mvu.tree)}${mvu.rules ? `\n\n【状态树·更新规则（卡作者所写）】\n${mvu.rules.trim()}` : ""}`
		: "";

	// 面板当前值同样放 user 段（数据不是指令）
	const panelUserSection = panels.length
		? `

【面板数据·当前值】
${panels.map((p) => `〔${p.name}〕\n${formatMvuTree(p.tree)}`).join("\n\n")}`
		: "";

	// agent 模式（章写入触发）没有「用户这一拍的话」——讨论不是剧情，不进场记；只给章原文。
	const exchange = userText.trim() ? `${userName}：${userText}\n\n${charName}：${assistantText}` : assistantText;
	const user = `【当前账本】
${JSON.stringify(state, null, 2)}${mvuUserSection}${panelUserSection}

【本轮对话】
${exchange}`;

	return { systemPrompt, userText: user };
}

/**
 * 宽容解析场记输出：剥代码围栏后，从头逐个候选尝试解析 JSON 对象
 * （模型常在最前写一句「以下是账本更新：」之类的前言——若前言里恰好有
 * 「{」，旧逻辑按首个 { 切分会从错位开始 → 整个解析失败。2026-08-03 实测）。
 * 解析失败返回 null（调用方静默跳过本轮）。
 */
export function parseScribeResult(text: string): ScribeResult | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	// 逐个「{」为起点试切：首个能完整解析出 patch 的对象即命中
	let idx = 0;
	while (true) {
		const start = t.indexOf("{", idx);
		if (start === -1) break;
		// 从候选起点向后找平衡的右括号（跳过字符串里的「}」）
		let depth = 0;
		let inStr = false;
		let esc = false;
		let end = -1;
		for (let i = start; i < t.length; i++) {
			const ch = t[i];
			if (inStr) {
				if (esc) esc = false;
				else if (ch === "\\") esc = true;
				else if (ch === '"') inStr = false;
				continue;
			}
			if (ch === '"') inStr = true;
			else if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end === -1) break;
		try {
			const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
			if (obj && typeof obj === "object" && !Array.isArray(obj)) {
				const patch =
					obj.patch && typeof obj.patch === "object" && !Array.isArray(obj.patch)
						? (obj.patch as Record<string, unknown>)
						: {};
				const mvuPatch =
						obj.mvu_patch && typeof obj.mvu_patch === "object" && !Array.isArray(obj.mvu_patch)
							? (obj.mvu_patch as Record<string, unknown>)
							: undefined;
				// 面板补丁必须是两层对象（面板名 → {路径:值}）；模型给成一层就整个丢弃，
				// 宁可这拍不更新，也别把 {"路径":值} 当成一个叫「路径」的面板凭空建出来。
				const rawPanel =
					obj.panel_patch && typeof obj.panel_patch === "object" && !Array.isArray(obj.panel_patch)
						? (obj.panel_patch as Record<string, unknown>)
						: undefined;
				let panelPatch: Record<string, Record<string, unknown>> | undefined;
				if (rawPanel) {
					const acc: Record<string, Record<string, unknown>> = {};
					for (const [name, v] of Object.entries(rawPanel)) {
						if (v && typeof v === "object" && !Array.isArray(v)) acc[name] = v as Record<string, unknown>;
					}
					if (Object.keys(acc).length) panelPatch = acc;
				}
					// 审查字段一律丢弃（即使旧模型仍返回）
				return {
					patch,
					...(mvuPatch ? { mvuPatch } : {}),
					...(panelPatch ? { panelPatch } : {}),
					warnings: [],
					unaskedTurn: null,
				};
			}
		} catch {
			// 本候选不成（前言里的孤 {），试下一个
		}
		idx = start + 1;
	}
	return null;
}

// ---------- 世界书中文别名（修复：专有名词中译后英文关键词地板失效） ----------

export interface AliasEntryInput {
	uid: number;
	keys: string[];
	comment: string;
	/** 正文摘录（截断后），供理解条目指代什么 */
	excerpt: string;
}

export function buildLoreAliasPrompt(
	entries: AliasEntryInput[],
	language: string,
): { systemPrompt: string; userText: string } {
	const systemPrompt = `你为角色扮演世界书条目生成${language}检索别名。这些别名用于在${language}叙事文本中做关键词匹配，因此要覆盖该事物在${language}叙事中最可能被写出的称呼：常见意译、音译、职称（每条目 2~5 个，单个别名 2~6 字为宜）。不要生成过于宽泛的词（如「建筑」「怪物」这类单独出现会误触发的通用词，除非条目本身就是该范畴）。
只输出 JSON 对象：{ "<uid>": ["别名1", "别名2", ...], ... }，不要输出任何其他文字。`;

	const userText = entries
		.map((e) => `uid=${e.uid} keys=[${e.keys.join(", ")}] 标题=${e.comment || "（无）"}\n摘要：${e.excerpt}`)
		.join("\n\n");

	return { systemPrompt, userText };
}

/** 解析别名输出：{ uid: string[] }；解析失败返回 null */
export function parseLoreAliases(text: string): Map<number, string[]> | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
		const map = new Map<number, string[]>();
		for (const [k, v] of Object.entries(obj)) {
			const uid = Number(k);
			if (!Number.isFinite(uid) || !Array.isArray(v)) continue;
			const aliases = v.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim());
			if (aliases.length) map.set(uid, aliases);
		}
		return map;
	} catch {
		return null;
	}
}

// ---------- 前情接力摘要（原 src/compaction.ts，2026-08-02 随 harness 重做移入） ----------

export interface RpSummaryPromptInput {
	/** 被裁早期剧情的对话原文（序列化后） */
	conversationText: string;
	/** 工具账本快照（辅助参考，可能滞后于正文） */
	stateSnapshot: string;
	/** 更早剧情的既有摘要（二次压缩时传入，合并进本次摘要） */
	previousSummary?: string;
	language: string;
	userName: string;
}

export interface RpSummaryPrompt {
	systemPrompt: string;
	userText: string;
}

export function buildRpSummaryPrompt(input: RpSummaryPromptInput): RpSummaryPrompt {
	const { conversationText, stateSnapshot, previousSummary, language, userName } = input;

	const systemPrompt = `你是一场长篇角色扮演的场记。你的任务是为即将从上下文中裁掉的早期剧情写一份接力摘要——它将成为主演模型唯一能看到的「前情」，后续剧情将基于「本摘要 + 保留的最近对话」继续演出。

用${language}输出，按以下结构：

## 前情提要
按时间顺序概述关键事件（谁做了什么、结果如何）。保留剧内时间刻度（如「第一天黄昏」「第三天清晨」）。

## 人物
每位出场人物：性格要点、说话习惯、对${userName}的称呼、与${userName}的关系温度及演变轨迹。

## 承诺与伏笔
逐条列出所有未兑现的约定、只被提过一次的线索、悬而未决的问题。这一节宁多勿漏——漏掉一条，后续剧情就永远丢失它。

## 事实账
物品归属（谁持有什么）、伤势与身体状态、重要数值、时间线（现在是剧内第几天）。

## 当前场景
剧内此刻：第几天、什么时段、什么地点、谁在场、正在进行什么动作。必须以对话记录中**最新**的场景为准——这是续演点，写成更早的场景会导致剧情倒退。

规则：只记录对话中实际发生的事；不虚构、不评论、不续写剧情；人名地名保持剧中写法。`;

	const parts: string[] = [`<conversation>\n${conversationText}\n</conversation>`];
	if (previousSummary) {
		parts.push(
			`<previous-summary>\n${previousSummary}\n</previous-summary>\n\n（上面是更早剧情的既有摘要：把它的内容合并进本次摘要，不要丢弃其中的承诺、伏笔与事实。）`,
		);
	}
	parts.push(`【工具账本快照】（辅助参考；记账可能滞后于正文，与对话记录冲突时以对话记录为准）\n${stateSnapshot}`);
	parts.push("请按系统指令输出接力摘要。");

	return { systemPrompt, userText: parts.join("\n\n") };
}
