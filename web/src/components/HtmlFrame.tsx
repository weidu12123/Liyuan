/**
 * 对话流 HTML 沙箱帧（底层展示通道）。
 *
 * - 默认：sandbox 禁止脚本（静态 HTML/CSS）
 * - scripts=true：allow-scripts，仍无 allow-same-origin → 无法读写父页面
 * - 与侧栏 ArtifactPanel 锁死策略不同：此处按消息/工具显式开关脚本，服务「中途渲染 UI」
 */

import { useEffect, useRef, useState } from "react";

const BASE_CSS =
	`html,body{margin:0;padding:0;background:transparent;color:#3f3f3f;` +
	`font:13.5px/1.55 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Noto Sans SC","Segoe UI",sans-serif}` +
	`img,video{max-width:100%;height:auto}` +
	`* {box-sizing:border-box}`;

function buildSrcDoc(html: string, scripts: boolean): string {
	const trimmed = html.trim();
	const isFull = /^\s*<(!doctype|html[\s>])/i.test(trimmed);
	// 有脚本时放宽 CSP（内联 + 外链脚本/样式/图/字体）；无脚本时更严
	const csp = scripts
		? `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:; style-src 'unsafe-inline' https: http: data:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:; connect-src https: http: ws: wss:; frame-src 'none'`
		: `default-src 'none'; style-src 'unsafe-inline' https: http: data:; img-src data: blob: https: http:; font-src data: https: http:; media-src data: blob: https: http:`;
	const head =
		`<meta charset="utf-8">` +
		`<meta http-equiv="Content-Security-Policy" content="${csp}">` +
		`<style>${BASE_CSS}</style>`;
	if (isFull) {
		// 完整文档：尽量在已有 head 里插 CSP（简陋但够用）
		if (/<head[\s>]/i.test(trimmed)) {
			return trimmed.replace(/<head([^>]*)>/i, `<head$1>${head}`);
		}
		return trimmed;
	}
	return `<!doctype html><html><head>${head}</head><body>${trimmed}</body></html>`;
}

export function HtmlFrame({
	html,
	title,
	scripts = false,
	minHeight = 120,
	maxHeight = 560,
}: {
	html: string;
	title?: string;
	scripts?: boolean;
	minHeight?: number;
	maxHeight?: number;
}) {
	const ref = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(minHeight);
	const [showSource, setShowSource] = useState(false);

	const srcDoc = buildSrcDoc(html, scripts);
	const sandbox = scripts ? "allow-scripts" : "";

	// 静态页尽量按内容撑高；有脚本的交互页用 maxHeight，内部自滚
	useEffect(() => {
		if (scripts) {
			setHeight(maxHeight);
			return;
		}
		const el = ref.current;
		if (!el) return;
		const fit = () => {
			try {
				const doc = el.contentDocument;
				const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || minHeight;
				setHeight(Math.min(maxHeight, Math.max(minHeight, h + 4)));
			} catch {
				/* opaque origin */
			}
		};
		el.addEventListener("load", fit);
		const t = window.setTimeout(fit, 50);
		return () => {
			el.removeEventListener("load", fit);
			window.clearTimeout(t);
		};
	}, [srcDoc, scripts, minHeight, maxHeight]);

	return (
		<figure className={`msg-html ${scripts ? "msg-html-scripts" : ""}`}>
			<div className="msg-html-bar">
				<span className="msg-html-title">{title?.trim() || (scripts ? "交互界面" : "HTML")}</span>
				<span className="msg-html-tags">
					{scripts ? <span className="chip chip-html-js">脚本</span> : <span className="chip chip-html-static">静态</span>}
					<button type="button" className="act" onClick={() => setShowSource((v) => !v)}>
						{showSource ? "收起源码" : "源码"}
					</button>
				</span>
			</div>
			<iframe
				ref={ref}
				className="msg-html-frame"
				title={title || "HTML"}
				sandbox={sandbox}
				srcDoc={srcDoc}
				style={{ height }}
			/>
			{showSource && <pre className="msg-html-source">{html}</pre>}
			{title?.trim() && !showSource && <figcaption className="msg-html-cap">{title}</figcaption>}
		</figure>
	);
}
