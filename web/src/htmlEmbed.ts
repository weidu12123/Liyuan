/**
 * 对话流 HTML 底座：从正文中切出 ```html 代码块，供 Messages 渲染。
 * 与角色卡前端无关——只做展示通道。
 */

export type TextPart =
	| { kind: "text"; text: string }
	| { kind: "html"; html: string; /** 围栏标记 scripts / +js 时为 true */ scripts: boolean };

/**
 * 拆分：```html ... ``` / ```html scripts ... ``` / ```html+js ... ```
 * 未闭合的围栏当普通文本。
 */
export function splitHtmlParts(text: string): TextPart[] {
	if (!text) return [];
	// lang: html | html scripts | html+js | html+script
	const re = /```html(?:\s*\+?\s*(?:scripts?|js))?[ \t]*\r?\n([\s\S]*?)```/gi;
	const parts: TextPart[] = [];
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m.index > last) {
			const chunk = text.slice(last, m.index);
			if (chunk) parts.push({ kind: "text", text: chunk });
		}
		const fence = m[0].slice(0, m[0].indexOf("\n") >= 0 ? m[0].indexOf("\n") : 8);
		const scripts = /\bscripts?\b|\bjs\b|\+/i.test(fence);
		const html = m[1].replace(/^\uFEFF/, "").trim();
		if (html) parts.push({ kind: "html", html, scripts });
		last = m.index + m[0].length;
	}
	if (last < text.length) {
		const rest = text.slice(last);
		if (rest) parts.push({ kind: "text", text: rest });
	}
	// 整段就是 HTML 文档（无围栏）——常见于部分卡 first_mes
	if (parts.length === 1 && parts[0].kind === "text" && looksLikeHtmlDocument(parts[0].text)) {
		return [{ kind: "html", html: parts[0].text.trim(), scripts: false }];
	}
	return parts.length > 0 ? parts : [{ kind: "text", text }];
}

/** 粗判：整段以 doctype/html 开头的文档 */
export function looksLikeHtmlDocument(text: string): boolean {
	const t = text.trimStart().slice(0, 200).toLowerCase();
	return t.startsWith("<!doctype html") || t.startsWith("<html");
}
