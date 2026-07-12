/**
 * 场记（scribe）+ 一致性审计器：旁侧廉价模型的提示词构造与输出解析（纯函数，零 pi 依赖）。
 *
 * 设计（PLAN.md Phase 2 / D10）：
 * - 记账职责从主演模型手里拿走：每轮结束后场记从正文抽取状态变更（产出是数据不是文字）；
 * - 审计只做两件事：向用户标注告警、向下一轮输入侧注入提醒——绝不改写已显示正文；
 * - 两项工作合并为一次调用（输入完全相同，省一半延迟与成本）。
 *
 * 实证依据（assets/ab-test/ 三轮跑测）：
 * - 「拒收物品」等否定性事件主演不记账（怀表两连败）→ 记账必须旁侧化；
 * - 输入侧硬约束拦不住生成时的叙事惯性 → 矛盾只能事后检测。
 */

import type { WorldState } from "./types.ts";

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
	/**
	 * 决策门禁 ask 档且本轮未调用 ask_director 时为 true：让场记额外检测
	 * 「本应征询用户却先斩后奏的重大转折」（PLAN-PHASE4 柱 1 第二层地板）。
	 */
	detectUnaskedTurn?: boolean;
}

export interface ScribeResult {
	/** 状态补丁（applyPatch 语义），无变化为 {} */
	patch: Record<string, unknown>;
	/** 正文与账本的硬矛盾告警，无则 [] */
	warnings: string[];
	/**
	 * 本轮正文里发生了「本应先征询用户」的重大转折却未询问（先斩后奏）时的说明；
	 * 无或未开启检测为 null。与 warnings 分开：这是决策门禁的违规地板，附带 rewind 建议。
	 */
	unaskedTurn: string | null;
}

export function buildScribeTurnPrompt(input: ScribePromptInput): { systemPrompt: string; userText: string } {
	const { state, userText, assistantText, charName, userName, detectUnaskedTurn } = input;
	const knownCharacters = Object.keys(state.characters);
	const nameGuide = knownCharacters.length
		? `名字必须使用账本中已有的写法（当前已有：${knownCharacters.join("、")}；用户角色「${userName}」）`
		: `用户角色写作「${userName}」`;

	const unaskedSection = detectUnaskedTurn
		? `

3. "unasked_turn"：字符串或 null。本场扮演开启了「重大剧情决策需先征询用户」的规则。判断本轮正文是否单方面推进了一个**本应先问用户**的重大、难以回头的转折——例如：一个将持续登场的重要新角色被凭空定型（定下名字/身份/性格），重要角色的死亡/背叛/关系性质根本改变，大的时间跳跃，把此前未定的世界观设定钉成既定事实。若有这类先斩后奏，用一句话说明是什么转折（如「未经询问即让盟友背叛并杀死了${charName}」）；若本轮只是正常推进日常剧情、氛围铺陈、小的互动，则为 null。判断从严：只报确实重大到不该由 AI 独断的转折，日常剧情一律 null。`
		: "";

	const systemPrompt = `你是一场角色扮演的场记兼连续性审查员。阅读【当前账本】与【本轮对话】，输出一个 JSON 对象完成${detectUnaskedTurn ? "三" : "两"}项工作。

1. "patch"：从本轮对话中提取需要记账的持久变化。字段语义：
- "time" / "location"：字符串，整体替换。剧内时间推移（入夜、次日清晨、数日后）必须更新 time。
- "characters"：{ "名字": { "affinity"?, "status"?, "notes"? } }，按字段合并。affinity 为 -100..100 的对${userName}态度值，基于账本当前值小步调整（通常 ±1~10）。${nameGuide}；只有全新出场的人物才建新条目，键用正文中的人名——不要把作品/剧本标题（如「${charName}」这类非人名）当作角色。
- "inventory"：字符串数组，整体替换——只在物品归属变化时给出变化后的完整清单，条目注明归属（如「黄铜怀表（${userName}持有）」）。
- "flags"：键值对，按键合并（值为字符串）。
- "plot_threads"：字符串数组，整体替换——新增或了结剧情线时给出完整清单。
要点：否定性事件也要记账（赠礼被拒→物品仍在原主处；承诺被收回→记入 flags）；新的承诺、约定、伏笔进 plot_threads；没有变化的字段不要出现在 patch 中；完全无变化则 "patch" 为 {}。

2. "warnings"：正文问题清单（字符串数组）。只报确定的问题：
- 与账本的硬矛盾：物品凭空出现/转移/消失、时间倒流、地点无过渡跳变、称呼或关系突变、与账本记录直接冲突的事实（说清「正文说了什么 vs 账本记录是什么」）；
- 代打用户角色：正文代替${userName}做出决定、执行动作或说出成段对白（${userName}只能由用户本人驱动；简短的环境性带过不算）。
没有则 []。不报猜测性问题。${unaskedSection}

只输出 JSON 对象，不要输出任何其他文字。`;

	const user = `【当前账本】
${JSON.stringify(state, null, 2)}

【本轮对话】
${userName}：${userText}

${charName}：${assistantText}`;

	return { systemPrompt, userText: user };
}

/** 宽容解析场记输出：剥代码围栏、截取首个 JSON 对象；解析失败返回 null（调用方静默跳过本轮） */
export function parseScribeResult(text: string): ScribeResult | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
		const patch =
			obj.patch && typeof obj.patch === "object" && !Array.isArray(obj.patch)
				? (obj.patch as Record<string, unknown>)
				: {};
		const warnings = Array.isArray(obj.warnings)
			? obj.warnings.filter((w): w is string => typeof w === "string" && w.trim().length > 0)
			: [];
		const unaskedTurn =
			typeof obj.unasked_turn === "string" && obj.unasked_turn.trim().length > 0 ? obj.unasked_turn.trim() : null;
		return { patch, warnings, unaskedTurn };
	} catch {
		return null;
	}
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
	const systemPrompt = `你为角色扮演世界书条目生成${language}检索别名。这些别名用于在${language}叙事文本中做关键词匹配，因此要覆盖该事物在${language}叙事中最可能被写出的称呼：常见意译、音译、俗称（每条目 2~5 个，单个别名 2~6 字为宜）。不要生成过于宽泛的词（如「森林」「怪物」这类单独出现会误触发的通用词，除非条目本身就是该概念）。

只输出 JSON 对象：{ "<uid>": ["别名1", "别名2", ...], ... }，不要输出任何其他文字。`;

	const userText = entries
		.map((e) => `uid=${e.uid} keys=[${e.keys.join(", ")}] 标题=${e.comment || "（无）"}\n摘录：${e.excerpt}`)
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
