/**
 * 场外发言检测——单一事实来源（扩展、server、wire 翻译共用）。
 *
 * 分层设计（2026-07-09 用户定调）：本函数只识别**显式标记**（harness 的确定性部分，
 * 决定显示通道与末端姿态注入）；无标记的场外话由模型自行判断（system prompt 给予
 * 自由度）——agent 分得清哪句是戏、哪句是话，harness 不越俎代庖。
 *
 * 识别的标记（均为 RP 社区通行习惯）：
 * - `//` 开头（CLI 习惯）
 * - `((` / `（（` 开头（ST 社区 OOC 双括号）
 * - 整条消息被单层括号包裹（`(…)` / `（…）`）
 */
export function isBackstageText(text: string): boolean {
	const t = text.trim();
	if (!t) return false;
	if (t.startsWith("//") || t.startsWith("((") || t.startsWith("（（")) return true;
	const first = t[0];
	const last = t[t.length - 1];
	return (first === "(" || first === "（") && (last === ")" || last === "）");
}
