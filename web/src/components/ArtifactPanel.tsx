/**
 * Agent 自建面板渲染（PLAN-PHASE4 柱 2）。
 *
 * 沙箱纪律（2026-07-10 用户定调：静态锁死）：
 * - markdown：本地 React 渲染——纯文本变换、零 innerHTML，天然无注入面；
 *   原文里的 HTML 一律按字面文本呈现。
 * - svg / html：iframe sandbox=""（无脚本、无同源、无导航）+ 文档内
 *   CSP default-src 'none' 双保险——sandbox 拦脚本执行，CSP 拦外链资源加载。
 *   卡片素材里的注入指令即使骗过 agent，也写不出能作恶的面板。
 */

import type { ReactNode } from "react";

import type { RpPanel } from "../wire.ts";

/** srcdoc 文档头：CSP 锁死一切外部加载（只留内联样式），加一段与主题同调的基础排版 */
const FRAME_HEAD =
	`<meta charset="utf-8">` +
	`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
	`<style>` +
	`html,body{margin:0;padding:10px;background:#fff;color:#3f3f3f;` +
	`font:13.5px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Noto Sans SC","Segoe UI",sans-serif}` +
	`svg{max-width:100%;height:auto;display:block}` +
	`table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:4px 10px;text-align:left}` +
	`img{display:none}` + // CSP 已拦外链图；彻底不显示避免碎图标
	`</style>`;

export function ArtifactPanel({ panel }: { panel: RpPanel }) {
	if (panel.kind === "markdown") {
		return <div className="panel-body artifact-md">{renderMarkdown(panel.content)}</div>;
	}
	// svg / html：统一走全锁沙箱 iframe
	return (
		<div className="panel-body artifact-frame-wrap">
			<iframe
				className="artifact-frame"
				title={panel.name}
				sandbox=""
				srcDoc={`<!doctype html><html><head>${FRAME_HEAD}</head><body>${panel.content}</body></html>`}
			/>
		</div>
	);
}

// ---------- 极简 markdown 渲染（面板够用的子集，输出 React 元素、不碰 innerHTML） ----------

/** 行内标记：**粗体**、*斜体*、`代码`；[文字](链接) 只呈现文字（静态锁死，不给导航面） */
function inline(text: string) {
	const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g);
	return parts.map((p, i) => {
		if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
		if (p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
		if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
		const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(p);
		if (link) return <span key={i} className="md-link-text">{link[1]}</span>;
		return <span key={i}>{p}</span>;
	});
}

function renderMarkdown(src: string) {
	const lines = src.split(/\r?\n/);
	const out: ReactNode[] = [];
	let key = 0;
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i++;
			continue;
		}
		// 代码块 ```…```
		if (line.trim().startsWith("```")) {
			const buf: string[] = [];
			i++;
			while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
			i++; // 收尾 ```
			out.push(<pre key={key++}>{buf.join("\n")}</pre>);
			continue;
		}
		// 标题 # ~ ####
		const h = /^(#{1,4})\s+(.*)$/.exec(line);
		if (h) {
			const level = h[1].length;
			const Tag = (["h1", "h2", "h3", "h4"] as const)[level - 1];
			out.push(<Tag key={key++}>{inline(h[2])}</Tag>);
			i++;
			continue;
		}
		// 分割线
		if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
			out.push(<hr key={key++} />);
			i++;
			continue;
		}
		// 引用块（> 行的连续块）
		if (/^\s*>\s?/.test(line)) {
			const buf: string[] = [];
			while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
			out.push(
				<blockquote key={key++}>
					{buf.map((l, li) => (
						<span key={li}>
							{inline(l)}
							{li < buf.length - 1 && <br />}
						</span>
					))}
				</blockquote>,
			);
			continue;
		}
		// 表格：| a | b | 行的连续块（第二行是 |---|--- 分隔时按表头处理）
		if (/^\s*\|.*\|\s*$/.test(line)) {
			const rows: string[] = [];
			while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
			const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
			const hasHead = rows.length > 1 && /^[\s|:-]+$/.test(rows[1]);
			const head = hasHead ? cells(rows[0]) : null;
			const body = (hasHead ? rows.slice(2) : rows).map(cells);
			out.push(
				<table key={key++}>
					{head && (
						<thead>
							<tr>{head.map((c, ci) => <th key={ci}>{inline(c)}</th>)}</tr>
						</thead>
					)}
					<tbody>
						{body.map((r, ri) => (
							<tr key={ri}>{r.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>
						))}
					</tbody>
				</table>,
			);
			continue;
		}
		// 列表（- / * / 1. 连续块；两个空格一级的简单嵌套按同级呈现）
		if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
			const ordered = /^\s*\d+\./.test(line);
			const items: string[] = [];
			while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
				items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
				i++;
			}
			const L = ordered ? "ol" : "ul";
			out.push(<L key={key++}>{items.map((it, ii) => <li key={ii}>{inline(it)}</li>)}</L>);
			continue;
		}
		// 普通段落：连续非空行合并
		const buf: string[] = [];
		while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*]|\d+\.)\s|\s*\||\s*>|```|\s*-{3,}\s*$)/.test(lines[i])) {
			buf.push(lines[i++]);
		}
		if (buf.length === 0) {
			// 防御：当前行被上面的所有分支拒收时至少消费一行，避免死循环
			buf.push(lines[i++]);
		}
		out.push(
			<p key={key++}>
				{buf.map((l, li) => (
					<span key={li}>
						{inline(l)}
						{li < buf.length - 1 && <br />}
					</span>
				))}
			</p>,
		);
	}
	return out;
}
