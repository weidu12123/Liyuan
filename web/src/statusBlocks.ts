/**
 * 角色卡常见「状态栏」标签的展示层拆分。
 *
 * 大乾风华录等卡用 <normal_status> / <special_status> / <plot> 包 YAML 或正文；
 * 卡作者偶发写错闭合标签（如 <plot>…</splot>），解析需容忍。
 * 不改写进模型的原文——只在 Web 渲染时拆段。
 */

export type StatusPart =
	| { kind: "text"; text: string }
	| { kind: "status"; tag: string; body: string };

/** 已知标签 → 中文标题 */
export const STATUS_LABELS: Record<string, string> = {
	normal_status: "场景状态",
	special_status: "人物状态",
	plot: "剧情",
	splot: "支线",
	descriptive_analysis: "描写分析",
	NextCharacterPanel: "角色登场",
};

const KNOWN_TAGS = [
	"normal_status",
	"special_status",
	"plot",
	"splot",
	"descriptive_analysis",
	"NextCharacterPanel",
] as const;

const OPEN_RE = new RegExp(`<(${KNOWN_TAGS.join("|")})>`, "gi");

/** plot / splot 闭合标签互通（卡面常见笔误） */
function closePattern(tag: string): RegExp {
	const t = tag.toLowerCase();
	if (t === "plot" || t === "splot") return /<\/(?:plot|splot)>/i;
	return new RegExp(`</${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`, "i");
}

/**
 * 顺序扫描：开标签 → 匹配闭合（含 plot/splot 互通）→ 否则截到下一个已知开标签或文末。
 */
export function splitStatusParts(text: string): StatusPart[] {
	if (!text) return [];
	const parts: StatusPart[] = [];
	let cursor = 0;
	OPEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = OPEN_RE.exec(text)) !== null) {
		const openStart = m.index;
		const openEnd = m.index + m[0].length;
		const tag = m[1];
		if (openStart > cursor) {
			const chunk = text.slice(cursor, openStart);
			if (chunk) parts.push({ kind: "text", text: chunk });
		}

		const rest = text.slice(openEnd);
		const closeRe = closePattern(tag);
		const closeM = closeRe.exec(rest);
		let body: string;
		let nextCursor: number;

		if (closeM && closeM.index >= 0) {
			body = rest.slice(0, closeM.index);
			nextCursor = openEnd + closeM.index + closeM[0].length;
		} else {
			// 无闭合：吃到下一个已知开标签，或文末
			OPEN_RE.lastIndex = openEnd;
			const nextOpen = OPEN_RE.exec(text);
			if (nextOpen && nextOpen.index >= openEnd) {
				body = text.slice(openEnd, nextOpen.index);
				nextCursor = nextOpen.index;
			} else {
				body = text.slice(openEnd);
				nextCursor = text.length;
			}
		}

		body = body.replace(/^\uFEFF/, "").trim();
		if (tag.toLowerCase() !== "descriptive_analysis") {
			parts.push({ kind: "status", tag, body });
		}
		cursor = nextCursor;
		OPEN_RE.lastIndex = cursor;
	}
	if (cursor < text.length) {
		const rest = text.slice(cursor);
		if (rest) parts.push({ kind: "text", text: rest });
	}
	return parts.length > 0 ? parts : [{ kind: "text", text }];
}

export function statusLabel(tag: string): string {
	return STATUS_LABELS[tag] ?? tag;
}

/** 是否像 YAML 状态块（整段用 pre 呈现更清晰） */
export function looksLikeYamlBlock(body: string): boolean {
	const t = body.trim();
	if (/^```ya?ml\b/i.test(t)) return true;
	const lines = t.split(/\r?\n/).filter((l) => l.trim());
	if (lines.length < 2) return false;
	const kv = lines.filter((l) => /[:：]/.test(l)).length;
	return kv >= Math.ceil(lines.length * 0.5);
}

/** 去掉包裹的 ```yaml 围栏，便于面板内干净展示 */
export function stripYamlFence(body: string): string {
	const t = body.trim();
	const m = /^```ya?ml\s*\r?\n([\s\S]*?)```\s*$/i.exec(t);
	return m ? m[1].trim() : t;
}
