/**
 * 输出后处理：应用于送往 LLM 的历史中的助手消息文本（记忆卫生，D10：不碰显示正文）。
 *
 * 结构块处理（实测依据 playtest-daqian）：ST 时代的卡会在常驻世界书里要求三段式输出
 * （<descriptive_analysis> 分析 + <normal_status> 状态栏 + <plot> 正文）。
 * 导演指令要求模型把分析放进思考通道，但指令是概率性的——这里是确定性地板：
 * 历史中剥掉分析/状态块、拆掉正文包装标签，防止 few-shot 自增殖。
 */

/** 整块剥离的结构标签（分析/状态类，正文不应包含） */
export const STRIP_BLOCK_TAGS = [
	"descriptive_analysis",
	"normal_status",
	"special_status",
	"thinking",
	"think",
	"status",
	"statusbar",
];

/** 只拆包装保留内容的标签（正文容器类） */
export const UNWRAP_BLOCK_TAGS = ["plot", "content", "narrative"];

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function cleanAssistantText(text: string): string {
	let t = text;
	for (const tag of STRIP_BLOCK_TAGS) {
		const k = escapeReg(tag);
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>[\\s\\S]*?</${k}>`, "gi"), "");
		// 悬挂开标签（截断输出的残留）：剥到末尾
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>[\\s\\S]*$`, "gi"), "");
	}
	for (const tag of UNWRAP_BLOCK_TAGS) {
		const k = escapeReg(tag);
		t = t.replace(new RegExp(`<${k}(?:\\s[^>]*)?>([\\s\\S]*?)</${k}>`, "gi"), "$1");
		t = t.replace(new RegExp(`</?${k}(?:\\s[^>]*)?>`, "gi"), "");
	}
	return t
		.replace(/[ \t]+$/gm, "") // 行尾空白
		.replace(/\n{3,}/g, "\n\n") // 3+ 连续空行收敛为 1 个空行
		.trim();
}
