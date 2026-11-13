/**
 * 对话流正文切分（RichContent 真路径，纯函数可测）。
 *
 * 顺序纪律（spec §7 P1 + skeptic fix）：
 * 1) 卡/预设皮肤正则先认领（applyCardSkin）→ 作者写的 HTML（状态栏/时间卡/选项栏…）
 * 2) 整页围栏 HTML 文档整段认领（程序卡等），禁止撕碎
 * 3) 顶层标准容器 / 短 ```html 围栏切出
 *
 * 8/15：梨园自制「统一状态卡」（按名字抠 <state1> 画灰框）整层退场。
 * 那是酒馆从来不做的事——酒馆没有标签名单，状态栏全靠作者正则换成标准 HTML（第 1 步）。
 * 作者写了正则 → 这里拿到的已是 HTML；作者没写 → 标签本就该显示成裸文字（对齐酒馆）。
 *
 * **禁止二次皮肤**：wire 侧 prepareDisplayText 已应用显示正则。
 * 程序卡的产物 HTML 里往往仍含它自己的触发占位串，再跑一遍会把整份脚本（实测有 2.6MB 的）
 * 再嵌一次 → `Identifier has already been declared` → 按钮全死。
 */

import type { DisplayRule } from "../../src/cardfront.ts";
import { isHtmlDisplayPayload } from "../../src/postprocess.ts";
import { applySkinKeepingBody } from "./cardSkin.ts";
import { findFencedHtmlDocument, looksLikeHtmlDocument, splitHtmlParts } from "./htmlEmbed.ts";

export type RichPart =
	| { kind: "text"; text: string }
	| { kind: "html"; html: string; scripts: boolean };

export type SkinMacros = { rules: DisplayRule[]; charName: string; userName: string };

/**
 * 正文是否已是皮肤/围栏产物（再套规则会二次替换）。
 *
 * 导出给 Messages.Bubble 的整楼判定复用——同一个「要不要上皮肤」的问题只许有一份判据，
 * 两处各写一份就会互相追赶（8/25 那次四处平行判据的教训）。
 */
export function alreadyDisplayHtml(text: string): boolean {
	if (!text) return false;
	if (isHtmlDisplayPayload(text)) return true;
	if (looksLikeHtmlDocument(text.trim())) return true;
	if (findFencedHtmlDocument(text)) return true;
	return false;
}

/**
 * 与 Messages.RichContent 同序：skin → HTML 块 → 状态标签 → 纯文本。
 * 返回可直接映射到 Paragraphs / StatusPanel / HtmlFrame 的序列。
 *
 * HTML 认领统一走 splitHtmlParts（含多份连续 ```html 文档各自成帧）。
 *
 * @param skin 仅在「原文尚未皮肤化」时使用（流式半截、或未走 wire 的本地文本）。
 *             已由 prepareDisplayText 处理过的消息务必仍可传入 skin，但会被跳过。
 */
export function splitRichContentParts(
	text: string,
	skin?: SkinMacros | null,
	opts?: { live?: boolean },
): RichPart[] {
	const needSkin = Boolean(skin && skin.rules.length > 0 && !alreadyDisplayHtml(text));
	const skinned = needSkin ? applySkinKeepingBody(text, skin!.rules, skin!) : text;

	// 围栏整页 / 短 ```html / 顶层 div —— 全由 splitHtmlParts 认领（可递归多帧）
	const htmlClaimed = splitHtmlParts(skinned);
	const out: RichPart[] = [];
	for (const p of htmlClaimed) {
		if (p.kind === "html") {
			out.push({ kind: "html", html: p.html, scripts: p.scripts });
			continue;
		}
		// 对非 HTML 正文部分隐去内联 HTML 草稿注释（流式期同时隐去尾部尚未闭合的 `<!-- ...` 避免闪现源码）
		let prose = p.text.replace(/<!--[\s\S]*?-->/g, "");
		if (opts?.live) {
			prose = prose.replace(/<!--[\s\S]*$/, "");
		}
		if (prose.trim()) out.push({ kind: "text", text: prose });
	}
	return out;
}
