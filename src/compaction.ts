/**
 * 剧情向 compaction：RP 接力摘要的提示词构造（纯函数，不依赖 pi）。
 *
 * 背景（agent-run-02 P9 缺陷）：pi 默认摘要是 coding 模板（Goal/Progress/英文），
 * 会把陈旧的时间/场景写成 Critical Context，导致压缩后剧情场景回退。
 * 本模块产出剧情向摘要指令；LLM 调用由接线层完成（D3）。
 */

export interface RpSummaryPromptInput {
	/** 序列化后的待摘要对话文本 */
	conversationText: string;
	/** 当前世界状态快照（formatState 输出，辅助参考） */
	stateSnapshot: string;
	/** 上一次压缩的摘要（增量压缩时合并） */
	previousSummary?: string;
	/** 摘要输出语言 */
	language: string;
	/** 用户角色名 */
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

/**
 * 把会话消息序列化为摘要输入文本。只保留叙事正文（用户/助手/开场白），
 * 工具调用、工具结果与思考块一律不进入摘要输入（D9：工具残渣不是剧情）。
 * 消息结构按 pi 的 AgentMessage 形状鸭子类型处理，本模块保持零 pi 依赖。
 */
export function serializeForSummary(messages: unknown[], userLabel: string, charLabel: string): string {
	const textOf = (content: unknown): string => {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.map((p) =>
				p && typeof p === "object" && (p as { type?: string }).type === "text"
					? String((p as { text?: unknown }).text ?? "")
					: "",
			)
			.filter(Boolean)
			.join("\n");
	};

	const lines: string[] = [];
	for (const m of messages as Array<{ role?: string; content?: unknown; customType?: string }>) {
		const text = textOf(m.content).trim();
		if (!text) continue;
		if (m.role === "user") lines.push(`${userLabel}：${text}`);
		else if (m.role === "assistant") lines.push(`${charLabel}：${text}`);
		else if (m.role === "custom" && m.customType === "rp-greeting") lines.push(`${charLabel}：${text}`);
	}
	return lines.join("\n\n");
}
