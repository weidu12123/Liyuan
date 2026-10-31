/** srcdoc 组装(纯函数,供 HtmlFrame 与测试):seamless 模式样式主权让位给卡(spec §4) */

import { IFRAME_TAVERN_BRIDGE_SNIPPET, IFRAME_TAVERN_GLOBALS_SNIPPET } from "./tavernShim.ts";

/**
 * HTML 规范里「声明文档结构」的根元素。出现其一即这份内容是一份**文档**，不是一段正文。
 * 与 postprocess 的 HTML_NON_PROSE_TAGS 同源同理（判据取自 HTML 规范，非卡作者措辞）：
 * 那边管「不许剥壳」，这边管「不许灌片段 CSS」。刻意**不含** `style`/`script`——
 * `<style>` 打头的多半是自带样式的状态栏片段，它仍需片段语义。
 */
const DOC_ROOT_RE = /^\s*<(?:!doctype\s+html|(?:html|head|body)(?=[\s>]))/i;

/**
 * 这份内容该按「整页文档」还是「正文片段」灌基底 CSS。
 *
 * 8/25 第二刀把四处「是不是界面」收成一份判据，**漏了此处第五处**：原先只认
 * `<!doctype>` / `<html>` 打头，于是根标签是 `<head>`（省掉 `<html>` 外壳、收尾只到
 * `</body>`，合法但非常规）的作者界面被当成正文片段，灌进 SEAMLESS_FRAGMENT_CSS 的
 * `white-space:pre-wrap` —— 作者源码里的缩进与换行全部变成可见空白：头部与页签之间
 * 撑出整屏死白、双栏被顶得错位（真 iframe 实测容器高 455px → 1706px、body 白空高 1876px）。
 * 片段 CSS 是给「状态栏纯文本一行一项」用的，一份完整文档绝不能吃。
 *
 * 判据只问「有没有文档结构根元素」，不按界面标签名列举，故 `<head>` 之外
 * （只写 `<body>`、只写 doctype 的下一张卡）同样落在正确一侧。
 */
function looksLikeDocument(html: string): boolean {
	return DOC_ROOT_RE.test(html);
}

/** 程序卡默认高度：约 78vh，夹在 480–2400（fixed 全屏 UI 不能靠内容盒量高） */
export function programViewportHeight(win?: { innerHeight: number } | null): number {
	const vh = win && typeof win.innerHeight === "number" ? win.innerHeight : 800;
	return Math.max(480, Math.min(2400, Math.floor(vh * 0.78)));
}

/**
 * html/body 根级 CSS 是否「视口接管」：同时声明 overflow:hidden 与 height:100%/100*vh。
 * 只认 html/body 选择器块（含 JS 模板串里的，某卡整页在模板串内）；
 * min-height:100vh 不算——那是「至少一屏」的内容流写法，正需要量高覆盖。
 */
function hasRootViewportCss(html: string): boolean {
	const blocks = html.match(/(?:^|[\s,{}>;"'`])(?:html|body)\s*(?:,\s*(?:html|body)\s*)?\{[^{}]*\}/gi);
	if (!blocks) return false;
	const joined = blocks.join(" ");
	return (
		/overflow(?:-y)?\s*:\s*hidden/i.test(joined) && /(?<!min-)height\s*:\s*100(?:%|[dsl]?vh)/i.test(joined)
	);
}

/**
 * 是否「视口接管型程序卡」（某卡主 UI、某卡开局创建器等）——iframe 须锁视口高，
 * 且 **不得** 注入 height:auto/overflow 覆盖、不注入高度上报（见 buildSrcDoc）。
 *
 * **不要**按体积一刀切：某卡 MVU 状态栏 182KB / XML 状态栏 88KB 都是完整 HTML+JS，
 * 却是透明内容流（零 vh、根级无接管 CSS）；按体积锁 78vh 就是「大块黑空 + 抖动」事故本身。
 * 某卡 状态栏（~11KB doctype+script，折叠态 ~200px）同理。
 *
 * 判定（满足其一，均要求 scripts）：
 * - 根级接管 CSS：html/body 同时 overflow:hidden + height:100%（某卡「开局创造角色」126KB 无 fixed，全靠这条）
 * - fixed 铺满 + 视口单位：position:fixed 与 100vh/100dvh 并存（body 内联样式等根级 CSS 缺席的形态）
 */
export function looksLikeProgramApp(html: string, scripts: boolean): boolean {
	if (!scripts || !html) return false;
	if (!/<script[\s>]/i.test(html)) return false;
	if (hasRootViewportCss(html)) return true;
	// fixed 铺满判定：要求 fixed 与 100vh 在同一样式块内（真全屏 UI），
	// 而非文档任意两处各出现一次（某卡欢迎卡有 fixed 装饰 + 某处 100vh，但整体是内容流）
	if (/\bposition\s*:\s*fixed[^}]*100[dsl]?vh|\b100[dsl]?vh[^}]*position\s*:\s*fixed/i.test(html)) return true;
	return false;
}

/**
 * 把作者样式里的视口高度单位按**真窗口高**折成 px。
 *
 * 为什么必须折：静态无痕帧的高度是按内容量出来的，而 `76vh` 之类的内容高度又取决于帧有多高——
 * 两者互为因果。帧从 minHeight=120 起步，`76vh` 只有 91px，量出来自然矮，`fit` 三趟停在 244px
 * （真浏览器实测；再迭代十趟也只爬到 336，不动点本身就不对），屏上是内容被裁 + 内外两条滚动条
 * （v1.4.1 用户反馈的图鉴卡实锤）。
 *
 * 为什么这不算改作者样式：作者是照酒馆写的，酒馆里 `vh` 就是**浏览器视口**。iframe 自动量高时
 * 没有一个有意义的"视口"，折成真窗口高的 px 才是对作者本意的忠实翻译。实测同一张卡：折算后帧高
 * 538px、内层 `pages` 高度等于内容高度（**无内层滚动条、无死白**）；不折则 409/457 被压掉 48px。
 *
 * 只在 `<style>` 块与 `style="…"` 属性内替换：正文文字里出现"76vh"这种字样不受影响。
 * 只对静态无痕帧做：视口接管型帧（TAKEOVER）本身按视口锁高，vh 已有确定含义，碰它就是越权。
 */
export function resolveViewportUnits(html: string, viewportPx: number): string {
	if (!html || !(viewportPx > 0)) return html;
	const px = (n: number) => `${Math.round((viewportPx * n) / 100)}px`;
	const sub = (css: string) => css.replace(/(\d+(?:\.\d+)?)[dsl]?vh\b/gi, (_m, n: string) => px(Number.parseFloat(n)));
	let out = html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_m, open: string, body: string, close: string) =>
		`${open}${sub(body)}${close}`,
	);
	out = out.replace(/\bstyle\s*=\s*"([^"]*)"/gi, (m, body: string) => (/[dsl]?vh\b/i.test(body) ? `style="${sub(body)}"` : m));
	out = out.replace(/\bstyle\s*=\s*'([^']*)'/gi, (m, body: string) => (/[dsl]?vh\b/i.test(body) ? `style='${sub(body)}'` : m));
	return out;
}

/**
 * 酒馆全局基底的一条：`public/style.css:135` 的 `* { box-sizing: border-box }`。
 *
 * 作者是照酒馆写的，`width:100%` + `padding` + `border` 在 border-box 下正好铺满；
 * 浏览器默认的 content-box 会把内边距与边框**加到** 100% 之外（实卡状态栏实测
 * 1280 视口下容器宽 1316px → 横向滚动条 + 右侧内容被切）。补这条不是改作者样式，
 * 是把作者写作时的宿主前提补齐——与 resolveViewportUnits 折 vh 同一个道理。
 * 用不带 !important 的裸 `*`：作者自己写了 box-sizing 的地方仍以作者为准。
 */
const TAVERN_BOX_SIZING = `*{box-sizing:border-box}`;

const LEGACY_BASE_CSS = `html,body{margin:0;padding:0;background:transparent;color:#3f3f3f;` +
	`font:13.5px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Noto Sans SC","Segoe UI",sans-serif}` +
	`img,video{max-width:100%;height:auto}` +
	`* {box-sizing:border-box}`;

/**
 * 无痕·片段(状态栏 div 等):透明底 + **保留换行**(纯文本字段一行一项)。
 * 整页文档不可用 pre-wrap，否则 某卡 等 flex/绝对布局会被毁掉。
 */
const SEAMLESS_FRAGMENT_CSS =
	`html,body{margin:0;padding:0;background:transparent;` +
	`white-space:pre-wrap;word-wrap:break-word;overflow-wrap:break-word}` +
	`img,video{max-width:100%;height:auto;vertical-align:middle}` +
	TAVERN_BOX_SIZING;

/**
 * 无痕·整页文档:透明兜底。
 * **禁止**让 html/body 吃满 100vh——iframe 量高时 100vh 会跟着父高涨，形成白底无限向下扩的反馈环。
 * 仅用于**内容流**文档；视口接管型（looksLikeProgramApp）绝不可注入：
 * height:auto!important 会打断卡自己的 height:100% 链 → 容器全塌陷只剩 fixed 层（某卡开局创建器事故）。
 */
const SEAMLESS_DOC_CSS =
	`html,body{margin:0;padding:0;background:transparent;` +
	`min-height:0!important;height:auto!important;overflow:visible!important}` +
	`img,video{max-width:100%;height:auto}` +
	TAVERN_BOX_SIZING;

/**
 * 视口接管型整页文档:只给透明兜底，样式主权完全归卡——
 * iframe 高度由父页按视口锁定（programViewportHeight），不量内容，无需也不能改 height/overflow。
 */
const TAKEOVER_DOC_CSS =
	`html,body{margin:0;padding:0;background:transparent}` + `img,video{max-width:100%;height:auto}`;

/**
 * 高度上报：量「内容盒子」而不是 documentElement.scrollHeight。
 * 后者在 min-height:100vh / height:100% 时会跟着 iframe 外高一起涨（每轮 +4px 白边）。
 * 只报 body 直接子元素的底部；忽略 script/style；稳定后不再 setInterval 狂刷。
 */
export const HEIGHT_REPORTER_SNIPPET =
	`<script>(function(){` +
	`var last=0,stable=0;` +
	`function contentH(){` +
	`var b=document.body;if(!b)return 0;` +
	`var h=0,kids=b.children;` +
	`for(var i=0;i<kids.length;i++){` +
	`var el=kids[i],tag=el.tagName;` +
	`if(tag==="SCRIPT"||tag==="STYLE"||tag==="LINK"||tag==="META")continue;` +
	`var r=el.getBoundingClientRect();` +
	`var bottom=Math.ceil(r.bottom+(window.scrollY||window.pageYOffset||0));` +
	`var oh=el.offsetTop+el.offsetHeight;` +
	`h=Math.max(h,bottom,oh);` +
	`}` +
	`/* 计入 body 下内边距（如为底部 fixed 状态栏预留的 padding-bottom），避免出现内层滚动条 */` +
	`if(h>0&&typeof getComputedStyle==="function"){try{var pb=Math.ceil(parseFloat(getComputedStyle(b).paddingBottom)||0);if(pb>0)h+=pb;}catch(e){}}` +
	`/* 无可见子节点时退回 offsetHeight，仍避免 documentElement 的 100vh */` +
	`if(h<1)h=b.offsetHeight||0;` +
	`return h;` +
	`}` +
	`function post(){` +
	`var h=contentH();` +
	`if(h<1)return;` +
	`if(h===last){stable++;return;}` +
	`last=h;stable=0;` +
	`parent.postMessage({liyuanFrameHeight:h,frameId:window.name},"*");` +
	`}` +
	`if(typeof ResizeObserver!=="undefined"){` +
	`try{new ResizeObserver(post).observe(document.body);` +
	`var kids=document.body?document.body.children:[];` +
	`for(var i=0;i<kids.length;i++){` +
	`var t=kids[i].tagName;if(t==="SCRIPT"||t==="STYLE")continue;` +
	`try{new ResizeObserver(post).observe(kids[i]);}catch(e){}}` +
	`}catch(e){}` +
	`}` +
	`window.addEventListener("load",post);` +
	`/* 前几秒兜底轮询，之后停掉，避免反馈环长期抖动 */` +
	`var n=0,iv=setInterval(function(){post();if(++n>8||stable>3)clearInterval(iv);},400);` +
	`setTimeout(post,0);setTimeout(post,100);setTimeout(post,300);` +
	`})();</script>`;

/**
 * 在脚本正文中找「真正的」</script> 结束位置。
 * 跳过 JS 字符串/模板/注释里的字面量 `</script`（某卡把整页 HTML 塞进模板字符串，
 * 内含 `</script></body></html>`，HTML 解析器会在此截断 → 主脚本只剩 ~36KB → 按钮无监听）。
 */
export function findScriptCloseIndex(html: string, bodyStart: number): number {
	let i = bodyStart;
	type St = "code" | "s" | "d" | "t" | "line" | "block";
	let state: St = "code";
	let escape = false;
	/** template 字面量里 ${...} 的花括号深度；>0 表示仍在表达式中 */
	const exprDepth: number[] = [];

	while (i < html.length) {
		const c = html[i];
		const n = html[i + 1];

		if (state === "line") {
			if (c === "\n" || c === "\r") state = "code";
			i++;
			continue;
		}
		if (state === "block") {
			if (c === "*" && n === "/") {
				state = "code";
				i += 2;
				continue;
			}
			i++;
			continue;
		}

		if (state === "s" || state === "d" || state === "t") {
			if (escape) {
				escape = false;
				i++;
				continue;
			}
			if (c === "\\") {
				escape = true;
				i++;
				continue;
			}
			// JS 单/双引号字符串不能未转义跨行；若遇换行说明起点实为正则字面量（如 /'/g）或注释，立即归位
			if ((state === "s" || state === "d") && (c === "\n" || c === "\r")) {
				state = "code";
				i++;
				continue;
			}
			if (state === "s" && c === "'") {
				state = "code";
				i++;
				continue;
			}
			if (state === "d" && c === '"') {
				state = "code";
				i++;
				continue;
			}
			if (state === "t") {
				if (c === "`") {
					state = "code";
					i++;
					continue;
				}
				if (c === "$" && n === "{") {
					exprDepth.push(1);
					state = "code";
					i += 2;
					continue;
				}
			}
			i++;
			continue;
		}

		// code
		if (c === "/" && n === "/") {
			state = "line";
			i += 2;
			continue;
		}
		if (c === "/" && n === "*") {
			state = "block";
			i += 2;
			continue;
		}
		if (c === "'") {
			state = "s";
			escape = false;
			i++;
			continue;
		}
		if (c === '"') {
			state = "d";
			escape = false;
			i++;
			continue;
		}
		if (c === "`") {
			state = "t";
			escape = false;
			i++;
			continue;
		}
		if (exprDepth.length > 0) {
			if (c === "{") {
				exprDepth[exprDepth.length - 1]!++;
				i++;
				continue;
			}
			if (c === "}") {
				exprDepth[exprDepth.length - 1]!--;
				if (exprDepth[exprDepth.length - 1] === 0) {
					exprDepth.pop();
					state = "t";
				}
				i++;
				continue;
			}
		}
		// 仅在顶层 code（非 template 表达式）认真正的闭合标签
		if (exprDepth.length === 0 && c === "<" && /^<\/script/i.test(html.slice(i))) {
			return i;
		}
		i++;
	}
	return -1;
}

/**
 * 仅转义 **脚本正文** 内的 `</script` → `<\/script`，真实闭合标签不动。
 * 必须在拼我们自己的 bridge/height 垫片 **之前** 对用户 HTML 调用。
 */
export function escapeScriptEndTags(html: string): string {
	const openRe = /<script(\s[^>]*)?>/gi;
	let out = "";
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = openRe.exec(html)) !== null) {
		// 跳过已处理区间内的「脚本串里的 <script」假开口
		if (m.index < last) continue;
		const openEnd = m.index + m[0].length;
		out += html.slice(last, openEnd);
		let closeAt = findScriptCloseIndex(html, openEnd);
		// 状态机失败时：退回「本段最后一个 </script」（整页程序卡常见）
		if (closeAt < 0) {
			const rest = html.toLowerCase();
			const fallback = rest.lastIndexOf("</script");
			closeAt = fallback >= openEnd ? fallback : -1;
		}
		if (closeAt < 0) {
			out += html.slice(openEnd).replace(/<\/script/gi, "<\\/script");
			return out;
		}
		const body = html.slice(openEnd, closeAt);
		out += body.replace(/<\/script/gi, "<\\/script");
		last = closeAt;
		openRe.lastIndex = closeAt;
	}
	out += html.slice(last);
	return out;
}

/**
 * 脚本帧 CSP：程序卡需拉 CDN(dexie/echarts 等) + 跑内联脚本；connect 放宽到 https/ws。
 * 页面级脚本宿主（scriptHostDoc）用的是同一份——两处若各写一份，放开一处忘另一处
 * 就是「同一判据多处平行」的老病（8/25 三刀的病根）。
 */
export const SCRIPT_FRAME_CSP =
	`default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:; style-src 'unsafe-inline' https: http: data:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:; connect-src https: http: ws: wss: data: blob:; worker-src blob: data:; frame-src 'none'`;

export function buildSrcDoc(html: string, scripts: boolean, seamless: boolean, viewportPx?: number): string {
	// 先修用户 HTML 内脚本截断，再注入带真实 </script> 的垫片
	const raw = escapeScriptEndTags(html.trim());
	// 静态无痕帧：作者样式里的 vh 折成真窗口高的 px。帧高按内容量，而 vh 的内容高又取决于帧高，
	// 不折就互为因果、量不出正确高度（见 resolveViewportUnits）。脚本帧走上报器、接管帧锁视口，都不折。
	const trimmed = seamless && !scripts && viewportPx ? resolveViewportUnits(raw, viewportPx) : raw;
	const isFull = looksLikeDocument(trimmed);
	// 与 HtmlFrame 的高度策略同源：同一函数、同一入参，保证 CSS 注入与定高策略永不打架
	const takeover = seamless && looksLikeProgramApp(html, scripts);
	// 程序卡需拉 CDN(dexie/echarts 等) + 内联脚本；connect 放宽到 https
	const csp = scripts
		? SCRIPT_FRAME_CSP
		: `default-src 'none'; style-src 'unsafe-inline' https: http: data:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:`;
	const seamlessCss = isFull ? (takeover ? TAKEOVER_DOC_CSS : SEAMLESS_DOC_CSS) : SEAMLESS_FRAGMENT_CSS;
	// 脚本帧：垫片桥必须先于卡脚本，保证 eventOn / TavernHelper / jQuery / 变量系统在初始化时已存在
	const bridge = scripts ? IFRAME_TAVERN_BRIDGE_SNIPPET + IFRAME_TAVERN_GLOBALS_SNIPPET : "";
	const head =
		`<meta charset="utf-8">` +
		`<meta http-equiv="Content-Security-Policy" content="${csp}">` +
		`<style>${seamless ? seamlessCss : LEGACY_BASE_CSS}</style>` +
		bridge;
	// 高度：脚本+seamless 用 postMessage；接管型不上报——父页锁视口高不收内容量高，
	// 上报器与卡内 ResizeObserver 互踩正是「收拢/涨高」乒乓抖动的源头
	const tail = scripts && seamless && !takeover ? HEIGHT_REPORTER_SNIPPET : "";
	if (isFull) {
		let withHead: string;
		// 注入必须走「替换函数」而非替换字符串：head 里嵌着整份 minified jQuery，含大量 `$1`/`$&`/`$'`
		// 等序列。若放进 String.replace 的替换串，JS 会把它们当**替换模式**解释——jQuery 的
		// `t.replace(rtrimCSS,"$1")`（选择器去空白）会被改成 `t.replace(rtrimCSS,"")`，
		// 破坏带尾随空白选择器的解析 → 委托事件（`.on(evt, sel, fn)`）的 seed 匹配全废、页签点不动。
		// 函数返回值按字面写入，`$` 不被解释（8/27 某卡 7 页签状态栏实证）。
		if (/<head[\s>]/i.test(trimmed)) {
			// 只改第一个 <head>（文档真 head；脚本字符串里的 <head> 通常更靠后）
			withHead = trimmed.replace(/<head([^>]*)>/i, (_m, attrs: string) => `<head${attrs}>${head}`);
		} else if (/<html[\s>]/i.test(trimmed)) {
			// 缺 head 时插入，保证 CSP/量高用 CSS（含打断 100vh）能生效
			withHead = trimmed.replace(/<html([^>]*)>/i, (_m, attrs: string) => `<html${attrs}><head>${head}</head>`);
		} else {
			withHead = `<!doctype html><html><head>${head}</head><body>${trimmed}</body></html>`;
		}
		// 高度脚本必须插在**最后一个** </body> 前。
		// 某卡主脚本模板里有 `</body></html>` 字符串；replace 第一个会把
		// <script>height...</script> 插进 JS 模板 → 主脚本在 ~36KB 被截断 → 按钮无监听。
		if (tail) {
			const lower = withHead.toLowerCase();
			const lastBody = lower.lastIndexOf("</body>");
			if (lastBody >= 0) {
				return withHead.slice(0, lastBody) + tail + withHead.slice(lastBody);
			}
			return withHead + tail;
		}
		return withHead;
	}
	return `<!doctype html><html><head>${head}</head><body>${trimmed}${tail}</body></html>`;
}
