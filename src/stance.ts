/**
 * 场外发言检测——历史与楼层用（2026-07-18 起主框不再硬改道）。
 *
 * **路由变更（2026-07-18 合流）**：主输入框一律进剧情 agent；`//` / 整段括号**不再**作为
 * server 改道依据。
 *
 * isBackstageText 仍保留：
 * - wire/楼层：旧会话里曾被改道产生的戏外轮折叠渲染、不占楼层；
 * - 场记/swipe：跳过旧会话的戏外轮。
 *
 * 识别的标记（RP 社区通行习惯 / 历史兼容）：
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

/**
 * 剥掉场外标记，取用户真正想说的话（旧会话里被改道的戏外轮用）：
 * `//text`、`((text))`、`（（text））`、整条 `(text)` / `（text）` → text。
 * 剥完为空时返回原文（防御畸形输入）。
 */
export function stripBackstageMarker(text: string): string {
	const t = text.trim();
	if (!t) return t;
	let out = t;
	if (t.startsWith("//")) {
		out = t.slice(2);
	} else if (t.startsWith("((") || t.startsWith("（（")) {
		out = t.slice(2);
		const tail = out.trimEnd();
		if (tail.endsWith("))") || tail.endsWith("））")) out = tail.slice(0, -2);
	} else {
		const first = t[0];
		const last = t[t.length - 1];
		if ((first === "(" || first === "（") && (last === ")" || last === "）")) out = t.slice(1, -1);
	}
	const clean = out.trim();
	return clean || t;
}
