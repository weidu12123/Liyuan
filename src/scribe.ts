/**
 * 场记（scribe）：旁侧廉价模型——每轮结束后从正文抽取世界状态补丁（纯函数，零 pi 依赖）。
 *
 * 设计：记账从主演手里拿走（D10：产出是数据不是文字）。
 * 连续性/代打等事后审查已移除（费 token 且用户反馈无用）。
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
	 * @deprecated 已不再做先斩后奏检测；保留字段以免旧调用方报错，忽略。
	 */
	detectUnaskedTurn?: boolean;
}

export interface ScribeResult {
	/** 状态补丁（applyPatch 语义），无变化为 {} */
	patch: Record<string, unknown>;
	/** 恒为空：连续性审查已关闭 */
	warnings: string[];
	/** 恒为 null：先斩后奏审查已关闭 */
	unaskedTurn: string | null;
}

export function buildScribeTurnPrompt(input: ScribePromptInput): { systemPrompt: string; userText: string } {
	const { state, userText, assistantText, charName, userName } = input;
	const knownCharacters = Object.keys(state.characters);
	const nameGuide = knownCharacters.length
		? `名字必须使用账本中已有的写法（当前已有：${knownCharacters.join("、")}；用户角色「${userName}」）`
		: `用户角色写作「${userName}」`;

	const systemPrompt = `你是一场角色扮演的场记。阅读【当前账本】与【本轮对话】，只做一件事：输出 JSON，更新需要记账的持久变化。

输出唯一字段：
"patch"：从本轮对话中提取需要记账的持久变化。字段语义：
- "time" / "location"：字符串，整体替换。剧内时间推移（入夜、次日清晨、数日后）必须更新 time。
- "characters"：{ "名字": { "affinity"?, "status"?, "notes"? } }，按字段合并。affinity 为 -100..100 的对${userName}态度值，基于账本当前值小步调整（通常 ±1~10）。${nameGuide}；只有全新出场的人物才建新条目，键用正文中的人名——不要把作品/剧本标题（如「${charName}」这类非人名）当作角色。
- "inventory"：字符串数组，整体替换——只在物品归属变化时给出变化后的完整清单，条目注明归属（如「黄铜怀表（${userName}持有）」）。
- "flags"：键值对，按键合并（值为字符串）。
- "plot_threads"：字符串数组，整体替换——新增或了结剧情线时给出完整清单。
要点：否定性事件也要记账（赠礼被拒→物品仍在原主处；承诺被收回→记入 flags）；新的承诺、约定、伏笔进 plot_threads；没有变化的字段不要出现在 patch 中；完全无变化则 "patch" 为 {}。

只输出 JSON 对象，例如 {"patch":{...}} 或 {"patch":{}}。不要输出 warnings、不要输出其他文字。`;

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
		// 审查字段一律丢弃（即使旧模型仍返回）
		return { patch, warnings: [], unaskedTurn: null };
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
