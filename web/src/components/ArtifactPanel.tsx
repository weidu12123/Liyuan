/**
 * Agent 自建面板渲染（PLAN-PHASE4 柱 2）+ 用户源码编辑（方案 A）。
 *
 * 沙箱纪律（2026-07-10 用户定调：静态锁死）：
 * - markdown：本地 React 渲染——纯文本变换、零 innerHTML；
 * - svg / html：iframe sandbox="" + CSP；
 * - 编辑态：改 content 源码（全 kind 通用），不提供字段级固定 UI。
 */

import { useEffect, useState, type ReactNode } from "react";

import { apiPut } from "../api.ts";
import { t } from "../i18n/index.ts";
import { fillPanelTemplate } from "../../../src/panelTemplate.ts";
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

const KINDS = ["markdown", "svg", "html"] as const;
type PanelKind = (typeof KINDS)[number];

export function ArtifactPanel({
	panel,
	data,
	onSaved,
}: {
	panel: RpPanel;
	/** 该面板的数据树（WorldState.panelData[面板名]）；模板里的 {{路径}} 用它填 */
	data?: Record<string, unknown>;
	/** 保存成功后可选回调（父级可乐观更新；通常靠 WS panels 帧即可） */
	onSaved?: (p: { name: string; kind: string; content: string; updatedAt: number }) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(panel.content);
	const [kind, setKind] = useState<PanelKind>(
		KINDS.includes(panel.kind as PanelKind) ? (panel.kind as PanelKind) : "markdown",
	);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	// 外部 panels 帧更新时：非编辑态跟盘；编辑态不抢草稿
	useEffect(() => {
		if (editing) return;
		setDraft(panel.content);
		setKind(KINDS.includes(panel.kind as PanelKind) ? (panel.kind as PanelKind) : "markdown");
		setErr(null);
	}, [panel.name, panel.content, panel.kind, panel.updatedAt, editing]);

	const startEdit = () => {
		setDraft(panel.content);
		setKind(KINDS.includes(panel.kind as PanelKind) ? (panel.kind as PanelKind) : "markdown");
		setErr(null);
		setEditing(true);
	};

	const cancel = () => {
		setDraft(panel.content);
		setKind(KINDS.includes(panel.kind as PanelKind) ? (panel.kind as PanelKind) : "markdown");
		setErr(null);
		setEditing(false);
	};

	const save = async () => {
		if (saving) return;
		setSaving(true);
		setErr(null);
		try {
			const r = await apiPut<{ ok: boolean; name: string; kind: string; updatedAt: number }>("/api/panels", {
				name: panel.name,
				content: draft,
				kind,
			});
			setEditing(false);
			onSaved?.({ name: r.name, kind: r.kind, content: draft, updatedAt: r.updatedAt });
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const dirty = editing && (draft !== panel.content || kind !== panel.kind);

	/**
	 * 屏幕上显示的是**填过数据的外观**：面板里的 `{{路径}}` 换成 `panelData` 里的当前值。
	 * markdown 走 React 渲染（React 自己会转义），svg/html 拼进 srcDoc 故要转义标记字符。
	 * 编辑态显示原始模板——用户要改的是模板本身，不是填好的结果。
	 */
	const shown = fillPanelTemplate(panel.content, data, { escapeMarkup: panel.kind !== "markdown" });

	return (
		<div className="artifact-root">
			<div className="artifact-toolbar">
				<span className="artifact-kind-chip" title={t("面板类型")}>
					{editing ? (
						<select
							className="artifact-kind-select"
							value={kind}
							onChange={(e) => setKind(e.target.value as PanelKind)}
							aria-label={t("面板类型")}
						>
							{KINDS.map((k) => (
								<option key={k} value={k}>
									{k}
								</option>
							))}
						</select>
					) : (
						panel.kind
					)}
				</span>
				<span className="artifact-toolbar-hint">
					{editing ? t("编辑源码 · 保存后 agent 下轮可见") : t("agent 维护 · 可手改")}
				</span>
				<span className="artifact-toolbar-actions">
					{editing ? (
						<>
							<button type="button" className="drawer-btn" disabled={saving} onClick={cancel}>
								{t("取消")}
							</button>
							<button
								type="button"
								className="drawer-btn save-btn"
								disabled={saving || !draft.trim()}
								onClick={() => void save()}
								title={dirty ? t("保存修改") : t("内容未改，仍可保存刷新时间")}
							>
								{saving ? t("保存中…") : t("保存")}
							</button>
						</>
					) : (
						<button type="button" className="drawer-btn" onClick={startEdit}>
							{t("编辑")}
						</button>
					)}
				</span>
			</div>
			{err && <div className="artifact-err">{err}</div>}
			{editing ? (
				<textarea
					className="artifact-editor"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					spellCheck={false}
					aria-label={t("编辑面板 {name}", { name: panel.name })}
					placeholder={
						kind === "markdown"
							? t("Markdown 正文…")
							: kind === "svg"
								? "<svg viewBox=\"0 0 …\">…</svg>"
								: t("HTML 片段…")
					}
				/>
			) : panel.kind === "markdown" ? (
				<div className="panel-body artifact-md">{renderMarkdown(shown)}</div>
			) : (
				<div className="panel-body artifact-frame-wrap">
					<iframe
						className="artifact-frame"
						title={panel.name}
						sandbox=""
						srcDoc={`<!doctype html><html><head>${FRAME_HEAD}</head><body>${shown}</body></html>`}
					/>
				</div>
			)}
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
