/**
 * 场外发言检测——单一事实来源（扩展、server、wire 翻译共用）。
 *
 * **硬规则（2026-07-13）**：
 * - 剧情相关永远戏内（含「我该怎么办」）；戏外不处理剧情。
 * - harness 层：仅显式标记 → 可能进戏外通道；无标记一律戏内。
 * - 模型层：即使有标记，若内容是剧情走向/抉择，仍应按戏内（ask_director 或续演），见 director 提示词。
 *
 * 识别的标记（RP 社区通行习惯）：
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
