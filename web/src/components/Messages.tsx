/**
 * 聊天区消息渲染：ST 式文档流（名字行 + 正文，无左右对齐）+ 过程条。
 *
 * D10 显示层纪律：narrative/thinking 文本原样呈现，排版（*动作*斜体、"对白"着色）
 * 只是 CSS 级装饰，不改写任何字符；前端绝不生成正文。
 * 过程条是元信息层（agent 工作过程），与正文明确区隔。
 */

import { useEffect, useMemo, useState } from "react";
import { attachmentUrl, splitAttachments } from "../attachments.ts";
import { applySkinKeepingBody } from "../cardSkin.ts";
import { isFullInterface } from "../htmlEmbed.ts";
import { splitRichContentParts, alreadyDisplayHtml, type SkinMacros } from "../richContentParts.ts";
import { splitMarkdownParts, splitRpInline } from "../markdown.ts";
import type { WireActivity, WireChoice, WireMsg } from "../wire.ts";
import { lineDiff } from "../diff.ts";
import { estimateTokens, formatTokenCount, type TurnSegment } from "../timeline.ts";
import { HtmlFrame } from "./HtmlFrame.tsx";
import { t } from "../i18n/index.ts";

/** 一档卡皮肤：显示向规则 + 宏名（Task 7 由 App 注入） */
export type SkinProp = SkinMacros;
import {
	IconChevronLeft,
	IconChevronRight,
	IconCopy,
	IconEdit,
	IconPin,
	IconRedo,
	IconSpeaker,
	IconTrash,
	IconUndo,
} from "./icons.tsx";

/** 点击页内放大的图片（lightbox）：点图开遮罩、点遮罩或 Esc 关闭；不跳新窗口 */
export function ZoomImg({ src, alt, title }: { src: string; alt: string; title?: string }) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);
	return (
		<>
			<img src={src} alt={alt} title={title} loading="lazy" className="zoomable" onClick={() => setOpen(true)} />
			{open && (
				<div className="lightbox" onClick={() => setOpen(false)}>
					<img src={src} alt={alt} />
				</div>
			)}
		</>
	);
}

/** 本地消息：wire 消息 + 客户端挂载的当轮过程活动（v0 不持久化，刷新即失） */
export interface ChatMsg extends WireMsg {
	activities?: WireActivity[];
	/**
	 * 回合时间线（思考/工具/正文按发生顺序）。存在时取代 thinking+activities+text
	 * 的三分区渲染；历史重放/旧消息无此字段，走 segmentsFromLegacy 兜底。
	 * 与 activities 同样是客户端态，不持久化。
	 */
	segments?: TurnSegment[];
}

/** 工具的中文显示名：值经 toolLabel() 用时再翻（英文在 i18n/en/messages.ts） */
export const TOOL_LABELS: Record<string, string> = {
	lorebook_search: "检索设定", // i18n-ignore
	world_state_get: "核对账本", // i18n-ignore
	world_state_update: "记下变化", // i18n-ignore
	lorebook_write: "固化设定", // i18n-ignore
	knowledge_create: "建知识库", // i18n-ignore
	knowledge_mount: "挂/卸知识库", // i18n-ignore
	knowledge_list: "列知识库", // i18n-ignore
	knowledge_delete: "删知识库条目", // i18n-ignore
	knowledge_write: "写入知识库", // i18n-ignore
	show_image: "展示插图", // i18n-ignore
	show_audio: "展示音频", // i18n-ignore
	show_video: "展示视频", // i18n-ignore
	show_html: "嵌入界面", // i18n-ignore
	tts: "配音", // i18n-ignore
	skill_save: "沉淀技能", // i18n-ignore
	panel_write: "更新面板", // i18n-ignore
	panel_read: "查看面板", // i18n-ignore
	panel_close: "收起面板", // i18n-ignore
	ask_director: "请你定夺", // i18n-ignore
	bash: "执行命令", // i18n-ignore
	read: "查阅", // i18n-ignore
	write: "写入", // i18n-ignore
	edit: "改写", // i18n-ignore
	grep: "检索文件", // i18n-ignore
	find: "查找文件", // i18n-ignore
	ls: "列目录", // i18n-ignore
	conversation_mode: "切换模式", // i18n-ignore
	card_project: "卡片资源", // i18n-ignore
};

export const toolLabel = (name: string) => {
	if (TOOL_LABELS[name]) return t(TOOL_LABELS[name]);
	// MCP：mcp__server__tool → MCP · tool
	if (name.startsWith("mcp__")) {
		const rest = name.slice("mcp__".length);
		const i = rest.indexOf("__");
		const tool = i >= 0 ? rest.slice(i + 2) : rest;
		return tool ? `MCP · ${tool}` : name;
	}
	return name;
};

/** 原始 JSON 参数不应出现在过程条主文案里 */
function looksLikeRawArgs(detail: string): boolean {
	const t = detail.trim();
	if (!t) return false;
	return (t.startsWith("{") || t.startsWith("[")) && /"\w+"\s*:/.test(t);
}

/** RP 排版：**粗体**、*动作*斜体、"对白"/“对白”/「对白」着色。纯呈现，切分归 splitRpInline。 */
function renderRp(text: string) {
	return splitRpInline(text).map((t, i) => {
		if (t.kind === "strong") return <strong key={i}>{t.text}</strong>;
		if (t.kind === "em") return <em key={i}>{t.text}</em>;
		if (t.kind === "quote") return <span key={i} className="q">{t.text}</span>;
		return <span key={i}>{t.text}</span>;
	});
}

/** 纯文本段：空行分段 + 行内 RP 装饰 */
function TextBlocks({ text }: { text: string }) {
	const t = text.replace(/^\n+/, "").replace(/\n+$/, "");
	if (!t) return null;
	return (
		<>
			{t.split(/\n{2,}/).map((para, i) => (
				<p key={i}>
					{para.split("\n").map((line, j, arr) => (
						<span key={j}>
							{renderRp(line)}
							{j < arr.length - 1 && <br />}
						</span>
					))}
				</p>
			))}
		</>
	);
}

/**
 * 正文段落：先切 markdown 围栏代码块（Options 等与正文区分），再 RP 排版。
 * 代码块不显示围栏字符，浅底预格式，对齐酒馆 markdown 观感。
 * 表格/选项列表来自 splitMarkdownParts 的二次细分（纯预设「角色表」「他人推动」等）。
 */
export function Paragraphs({ text }: { text: string }) {
	const parts = splitMarkdownParts(text);
	return (
		<>
			{parts.map((p, i) => {
				if (p.kind === "code") {
					return (
						<pre key={i} className="msg-md-code" data-lang={p.lang || undefined}>
							<code>{p.code}</code>
						</pre>
					);
				}
				if (p.kind === "table") {
					return (
						<div key={i} className="msg-md-tablewrap">
							<table className="msg-md-table">
								<thead>
									<tr>
										{p.header.map((h, j) => (
											<th key={j}>{renderRp(h)}</th>
										))}
									</tr>
								</thead>
								<tbody>
									{p.rows.map((row, j) => (
										<tr key={j}>
											{row.map((cell, k) => (
												<td key={k}>{renderRp(cell)}</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				}
				if (p.kind === "blockquote") {
					return (
						<blockquote key={i} className="msg-md-quote">
							{p.lines.map((line, j, arr) => (
								<span key={j}>
									{renderRp(line)}
									{j < arr.length - 1 && <br />}
								</span>
							))}
						</blockquote>
					);
				}
				if (p.kind === "options") {
					return (
						<ul key={i} className="msg-options">
							{p.items.map((it) => (
								<li key={it.key}>
									<span className="msg-option-key">{it.key}</span>
									<span className="msg-option-text">{renderRp(it.text)}</span>
								</li>
							))}
						</ul>
					);
				}
				return <TextBlocks key={i} text={p.text} />;
			})}
		</>
	);
}

/**
 * 正文渲染（真路径 = splitRichContentParts）：
 * 作者正则皮肤 → HTML 块（seamless 帧）→ 其余 RP 排版。
 * 状态栏是作者正则产出的 HTML，走 html 分支；梨园不再按标签名抠「统一状态卡」。
 */
export function RichContent({ text, skin }: { text: string; skin?: SkinProp | null }) {
	// 缓存切分（8/19）：每次重渲染都重跑一遍作者正则＋HTML 切分是白花钱——
	// 流式期间父组件每个增量都会重渲染整列消息，未缓存时全列消息逐条重跑
	const parts = useMemo(() => splitRichContentParts(text, skin), [text, skin]);
	const first = parts[0];
	if (parts.length === 1 && first.kind === "text") {
		return <Paragraphs text={first.text} />;
	}
	return (
		<>
			{parts.map((p, i) => {
				// 皮肤/正文内嵌 HTML：无痕 seamless；agent show_html 通道不经此路径
				if (p.kind === "html") return <HtmlFrame key={i} html={p.html} scripts={p.scripts} seamless />;
				if (p.kind === "text" && p.text.trim()) return <Paragraphs key={i} text={p.text} />;
				return null;
			})}
		</>
	);
}

/**
 * 模型思维链：**默认折叠**，摘要只给「思考中…／已思考 · 12K tokens」。
 *
 * 思考是过程不是成品——展开态会把正文挤到屏外，最终态该干净。
 * 生成中也不自动展开（旧行为 live=true 强制 open）：想看的人点开，
 * 折叠态的 token 数已经说明它在动。defaultOpen 只留给中断残稿
 * （正文未流出时思维链是唯一线索）。
 */
export function ThinkingBlock({ text, live, defaultOpen }: { text: string; live?: boolean; defaultOpen?: boolean }) {
	const tokens = formatTokenCount(estimateTokens(text));
	return (
		<details className="thinking" open={defaultOpen ? true : undefined}>
			<summary className={live ? "pulse" : undefined}>
				<span className="thinking-label">{live ? t("思考中") : t("已思考")}</span>
				{text.trim() && <span className="thinking-count">{tokens} tokens</span>}
			</summary>
			<div className="thinking-body">
				<Paragraphs text={text} />
			</div>
		</details>
	);
}

/**
 * 一段工具步骤（时间线内联）：连续调用聚成一组，默认折叠成一行摘要。
 * 与 ActivityBar 的差别是它按发生位置**内联**在思考与正文之间，
 * 而不是整轮收尾时挂在末端。
 */
export function ToolSegment({ activities, live }: { activities: WireActivity[]; live?: boolean }) {
	const calls = activities.filter((a) => a.kind === "tool_start");
	const names = [...new Set(calls.map((a) => toolLabel(a.name)))];
	const summary = names.length === 0 ? t("过程") : names.length <= 3 ? names.join(t("、")) : t("{names} 等 {n} 项", { names: names.slice(0, 3).join(t("、")), n: names.length });
	return (
		<details className="turn-activity turn-activity-inline">
			<summary className={live ? "pulse" : undefined}>
				{summary}
				{calls.length > 1 && t(" · {n} 步", { n: calls.length })}
			</summary>
			<ul>
				{activities.map((a, i) => (
					<ActivityItem key={i} a={a} />
				))}
			</ul>
		</details>
	);
}

/**
 * 回合时间线渲染（8/09 两层折叠）：
 *
 * **定稿态（live=false）**——成品优先：正文段（稿段+尾巴）连续平铺，全部思考与
 * 工具段收进末尾**一个**「本轮历程」折叠（第二层汇总折叠）。过程不删除——点开
 * 历程按原时序看完整思考与调用；历程内思考默认展开（用户点开历程就是要读它）。
 * 旧的按时序平铺会把正文切碎——续写段与前一段之间隔着 ask/重拟/思考一长串。
 *
 * **扮演中（live=true）**——跟读优先：正文段平铺（故事在长），正文之间连续的
 * 思考/工具段聚成「扮演中」折叠组（第一层），只占一行、轮次间距收紧；最新一组
 * 默认展开（正在动的过程可跟读），出新正文段后自动收起。
 */
export function TurnTimeline({
	segments,
	skin,
	live,
	plain,
}: {
	segments: TurnSegment[];
	skin?: SkinProp | null;
	live?: boolean;
	/** Authoring code remains text; it never mounts a live card runtime iframe. */
	plain?: boolean;
}) {
	const countOf = (segs: TurnSegment[]) => {
		const thinks = segs.filter((s) => s.kind === "thinking").length;
		const calls = segs.reduce(
			(n, s) => (s.kind === "tool" ? n + s.activities.filter((a) => a.kind === "tool_start").length : n),
			0,
		);
		return { thinks, calls };
	};

	if (!live) {
		const texts = segments.filter((s) => s.kind === "text");
		const process = segments.filter((s) => s.kind !== "text");
		const { thinks, calls } = countOf(process);
		return (
			<>
				{texts.map((seg, i) => (
					plain ? <Paragraphs key={i} text={(seg as Extract<TurnSegment, { kind: "text" }>).text} /> : <RichContent key={i} text={(seg as Extract<TurnSegment, { kind: "text" }>).text} skin={skin} />
				))}
				{process.length > 0 && (
					<details className="turn-process">
						<summary>
							{t("本轮历程")}
							{thinks > 0 && t(" · 思考 {n} 段", { n: thinks })}
							{calls > 0 && t(" · {n} 步", { n: calls })}
						</summary>
						<div className="turn-process-body">
							{segments.map((seg, i) => {
								if (seg.kind === "thinking") return <ThinkingBlock key={i} text={seg.text} defaultOpen />;
								if (seg.kind === "tool") return <ToolSegment key={i} activities={seg.activities} />;
								return null; // 正文已平铺在外，历程里不重复
							})}
						</div>
					</details>
				)}
			</>
		);
	}

	// 扮演中：正文之间的连续过程段聚组
	type Group = { kind: "text"; seg: Extract<TurnSegment, { kind: "text" }> } | { kind: "process"; segs: TurnSegment[] };
	const groups: Group[] = [];
	for (const seg of segments) {
		if (seg.kind === "text") groups.push({ kind: "text", seg });
		else {
			const last = groups[groups.length - 1];
			if (last && last.kind === "process") last.segs.push(seg);
			else groups.push({ kind: "process", segs: [seg] });
		}
	}
	return (
		<>
			{groups.map((g, gi) => {
				if (g.kind === "text") return plain ? <Paragraphs key={gi} text={g.seg.text} /> : <RichContent key={gi} text={g.seg.text} skin={skin} />;
				const active = gi === groups.length - 1; // 最新过程组=正在动的，展开跟读
				const { thinks, calls } = countOf(g.segs);
				return (
					<details key={gi} className="turn-process turn-process-live" open={active ? true : undefined}>
						<summary className={active ? "pulse" : undefined}>
							{active ? plain ? t("工作中") : t("扮演中") : t("过程")}
							{thinks > 0 && t(" · 思考 {n} 段", { n: thinks })}
							{calls > 0 && t(" · {n} 步", { n: calls })}
						</summary>
						<div className="turn-process-body">
							{g.segs.map((seg, i) => {
								const isLast = active && i === g.segs.length - 1;
								if (seg.kind === "thinking") return <ThinkingBlock key={i} text={seg.text} live={isLast} />;
								if (seg.kind === "tool") return <ToolSegment key={i} activities={seg.activities} live={isLast} />;
								return null;
							})}
						</div>
					</details>
				);
			})}
		</>
	);
}

/** 过程条单项：旁白优先；工具步骤用中文标签 + 人话 detail（藏 JSON） */
function ActivityItem({ a }: { a: WireActivity }) {
	if (a.kind === "note") {
		return <li className="ta-note">{a.detail}</li>;
	}
	if (a.kind === "tool_start") {
		const label = toolLabel(a.name);
		const detail = (a.detail ?? "").trim();
		const human = detail && !looksLikeRawArgs(detail) ? detail : "";
		const change = a.change;
		const file = change?.path.split(/[\\/]/).pop() ?? "";
		return (
			<li className="ta-call">
				<span className="ta-label">{label}</span>
				{change ? <span className="ta-detail">{file}</span> : human ? <span className="ta-detail">{human}</span> : <span className="ta-detail ta-detail-muted">{t("进行中…")}</span>}
				{change && <FileChangeView change={change} />}
			</li>
		);
	}
	const detail = (a.detail ?? "").trim();
	const human = detail && !looksLikeRawArgs(detail) ? detail : "";
	return (
		<li className={`ta-result ${a.isError ? "ta-error" : ""}`}>
			<span className="ta-label">{a.isError ? t("未办成") : t("已办完")}</span>
			{human ? <span className="ta-detail">{human}</span> : null}
		</li>
	);
}

/** 原生 edit / write 的回显：像 coding agent 改代码那样按行红绿铺开；write 只列内容行（都是新增） */
function FileChangeView({ change }: { change: NonNullable<WireActivity["change"]> }) {
	const blocks = change.edits
		? change.edits.map((e) => lineDiff(e.old, e.new))
		: [(change.content ?? "").split("\n").map((text) => ({ op: "+" as const, text }))];
	const isWrite = !change.edits;
	return (
		<details className="ta-change" open={!isWrite}>
			<summary>{isWrite ? t("写入整文件 · {n} 字", { n: (change.content ?? "").length }) : t("{n} 处替换", { n: change.edits!.length })}</summary>
			{blocks.map((lines, i) => (
				<pre key={i} className="ta-change-pre">
					{lines.map((l, j) => (
						<span key={j} className={`ta-change-line ${l.op === "+" ? "add" : l.op === "-" ? "del" : "ctx"}`}>{l.op} {l.text}{"\n"}</span>
					))}
				</pre>
			))}
		</details>
	);
}

/** 过程条（收尾态）：整轮步骤收进一个折叠（codex 式过程-成品分离，成品平铺在外） */
export function ActivityBar({ activities }: { activities: WireActivity[] }) {
	if (activities.length === 0) return null;
	const steps = activities.filter((a) => a.kind === "tool_start" || a.kind === "note").length;
	return (
		<details className="turn-activity">
			<summary>
				{t("过程")}
				{steps > 0 && t(" · {n} 步", { n: steps })}
			</summary>
			<ul>
				{activities.map((a, i) => (
					<ActivityItem key={i} a={a} />
				))}
			</ul>
		</details>
	);
}

/** 过程清单（进行中态）：每一步实时追加、全程平铺可见；定稿后由 ActivityBar 收进折叠 */
export function LiveSteps({ activities }: { activities: WireActivity[] }) {
	if (activities.length === 0) return null;
	return (
		<ul className="live-steps">
			{activities.map((a, i) => (
				<ActivityItem key={i} a={a} />
			))}
		</ul>
	);
}

/** 戏外中间步骤（正文+活动，折叠区内使用） */
function BackstageStep({ msg }: { msg: ChatMsg }) {
	return (
		<div className="bs-step">
			{msg.thinking && <ThinkingBlock text={msg.thinking} />}
			<RichContent text={msg.text} />
			{msg.activities && msg.activities.length > 0 && <ActivityBar activities={msg.activities} />}
		</div>
	);
}

/**
 * 戏外轮分组（codex 式过程-成品分离，2026-07-10 用户定调）：
 * 同一轮的中间步骤全部折进「过程」，只露最终报告；最终报告本身可折叠——
 * 最新一轮默认展开，翻历史时旧轮默认收起。
 */
export function BackstageGroup({
	msgs,
	fallbackName,
	open,
	avatarUrl,
}: {
	msgs: ChatMsg[];
	fallbackName: string;
	open: boolean;
	avatarUrl?: string | null;
}) {
	const final = msgs[msgs.length - 1];
	const mid = msgs.slice(0, -1);
	const toolCount = msgs.reduce((n, m) => n + (m.activities?.filter((a) => a.kind === "tool_start").length ?? 0), 0);
	const name = final.name || fallbackName;
	return (
		<div className="msg msg-backstage">
			<div className="msg-head">
				<MsgAvatar src={avatarUrl} name={name} kind="char" />
				<span className="msg-name">{name}</span>
				<span className="chip chip-backstage">{t("助手")}</span>
			</div>
			{mid.length > 0 && (
				<details className="turn-activity">
					<summary>
						{t("过程 · 中间步骤 ×{n}", { n: mid.length })}
						{toolCount > 0 && t(" · 工具调用 ×{n}", { n: toolCount })}
					</summary>
					{mid.map((m, i) => (
						<BackstageStep key={i} msg={m} />
					))}
				</details>
			)}
			<details className="bs-final" open={open}>
				<summary>{open ? t("回复") : t("回复：{line}", { line: firstLine(final.text) })}</summary>
				{final.thinking && <ThinkingBlock text={final.thinking} />}
				<RichContent text={final.text} />
				{final.activities && final.activities.length > 0 && <ActivityBar activities={final.activities} />}
			</details>
		</div>
	);
}

const firstLine = (text: string) => {
	const line = text.split("\n").find((l) => l.trim()) ?? "";
	return line.length > 60 ? `${line.slice(0, 60)}…` : line;
};

/**
 * 剧情决策选择卡（Phase 4 柱 1）。两种形态同一组件：
 * - live（onReply 传入且未决）：可点选项、自由输入、停止；
 * - 留痕（choice.answer / choice.stopped，或无 onReply）：置灰只读，标注结果。
 * D10 合规：选择卡是"事前参与"的创作决策界面，不是正文——岔路口本身也是剧情资产。
 */
export function ChoiceCard({ choice, onReply }: { choice: WireChoice; onReply?: (r: { value?: string; stop?: boolean }) => void }) {
	const [custom, setCustom] = useState("");
	const resolved = choice.answer !== undefined || choice.stopped === true;
	const live = !!onReply && !resolved;

	return (
		<div className={`choice-card ${resolved ? "choice-done" : ""}`}>
			<div className="choice-q">{choice.question}</div>
			{choice.options.length > 0 && (
				<div className="choice-options">
					{choice.options.map((opt, i) => {
						const picked = choice.answer === opt;
						return (
							<button
								key={i}
								className={`choice-opt ${picked ? "picked" : ""}`}
								disabled={!live}
								onClick={live ? () => onReply?.({ value: opt }) : undefined}
							>
								<span className="choice-idx">{i + 1}</span>
								{opt}
							</button>
						);
					})}
				</div>
			)}
			{live ? (
				<div className="choice-custom">
					<input
						type="text"
						value={custom}
						placeholder={choice.placeholder ?? t("或自己写一个…")}
						onChange={(e) => setCustom(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.nativeEvent.isComposing && custom.trim()) {
								e.preventDefault();
								onReply?.({ value: custom.trim() });
							}
						}}
					/>
					<button className="choice-send" disabled={!custom.trim()} onClick={() => onReply?.({ value: custom.trim() })}>
						{t("提交")}
					</button>
					<button className="choice-stop" onClick={() => onReply?.({ stop: true })} title={t("停止本回合，收回主导权")}>
						{t("停止")}
					</button>
				</div>
			) : (
				<div className="choice-result">
					{choice.stopped ? (
						<span className="choice-stopped">{t("已停止本回合")}</span>
					) : choice.answer !== undefined && !choice.options.includes(choice.answer) ? (
						<span className="choice-answered">{t("你的回答：{answer}", { answer: choice.answer })}</span>
					) : choice.answer !== undefined ? (
						<span className="choice-answered">{t("已选择")}</span>
					) : (
						<span className="choice-answered">{t("已应答")}</span>
					)}
				</div>
			)}
		</div>
	);
}

/** 消息头像：有图用图，否则字首圆形 */
export function MsgAvatar({
	src,
	name,
	kind = "char",
}: {
	src?: string | null;
	name: string;
	kind?: "user" | "char";
}) {
	const letter = (name || "？").trim().slice(0, 1) || "？";
	if (src) {
		return (
			<span className={`msg-avatar msg-avatar-${kind} has-img`} aria-hidden="true">
				<img src={src} alt="" />
			</span>
		);
	}
	return (
		<span className={`msg-avatar msg-avatar-${kind}`} aria-hidden="true">
			{letter}
		</span>
	);
}

export interface BubbleEditState {
	draft: string;
	/** 用户改稿后点「重新生成」；agent 改稿后点「重新生成」= 采用改写 / 再生成 */
	onChange: (v: string) => void;
	onCancel: () => void;
	onSubmit: () => void;
	/** 提交按钮文案旁注 */
	submitLabel?: string;
}

/** ST 式回复变体：左右箭头；在末条点右 = 再生成（保留旧变体） */
export interface BubbleSwipe {
	index: number;
	total: number;
	onPrev: () => void;
	onNext: () => void;
}

export interface BubbleProps {
	msg: ChatMsg;
	floor?: number;
	fallbackName: string;
	/** 角色卡立绘 / 用户身份头像 URL */
	avatarUrl?: string | null;
	/** 尾部操作 */
	onReroll?: () => void;
	onEdit?: () => void;
	/** 回退到本条之前（含本条之后的剧情） */
	onRewind?: () => void;
	/** 删除本轮 / 删除最后角色回复 */
	onDelete?: () => void;
	onCopy?: (text: string) => void;
	/** 在当前剧情点存档（世界线钉） */
	onStore?: () => void;
	/** 为这段正文文生音 */
	onTts?: (text: string) => void;
	ttsBusy?: boolean;
	/** 开场白切换（仅会话未开聊时） */
	greetingSwitch?: { index: number; total: number; onPrev: () => void; onNext: () => void };
	/** 角色回复变体（ST 箭头；与 greetingSwitch 可同时存在于不同消息） */
	swipe?: BubbleSwipe;
	/** 本条正处于编辑：正文区变输入框，下方「放弃 / 重新生成」 */
	edit?: BubbleEditState;
	/** 一档卡皮肤（显示层；缺省 null=与旧行为一致） */
	skin?: SkinProp | null;
	/** agent 模式：检查点卡片点击 → 稿子视图的历史里展开它 */
	onChapter?: (checkpointId: string) => void;
}

export function Bubble({
	msg,
	floor,
	fallbackName,
	avatarUrl,
	onReroll,
	onEdit,
	onRewind,
	onDelete,
	onCopy,
	onStore,
	onTts,
	ttsBusy,
	greetingSwitch,
	swipe,
	edit,
	skin,
	onChapter,
}: BubbleProps) {
	if (msg.channel === "info") {
		return <div className="info-line">{msg.text}</div>;
	}
	if (msg.channel === "chapter") {
		// agent 模式：一轮的稿子改动（检查点）留痕成一张内联卡片（不用弹窗），点击到稿子视图的历史里看 diff
		const c = msg.checkpoint;
		const ch = c?.changed;
		const parts = ch ? [
			...ch.added.map((n) => t("新增 {name}", { name: n })), ...ch.modified.map((n) => t("修改 {name}", { name: n })),
			...ch.renamed.map(([a, b]) => t("改名 {from}→{to}", { from: a, to: b })), ...ch.removed.map((n) => t("删除 {name}", { name: n })),
		] : [];
		return (
			<button type="button" className={`chapter-card ${c?.author === "user" ? "chapter-card-edit" : ""}`} onClick={() => c && onChapter?.(c.id)} disabled={!onChapter}>
				<span className="chapter-card-kind">{c?.restoredFrom ? t("恢复") : c?.author === "user" ? t("手改") : t("改稿")}</span>
				<span className="chapter-card-text">{parts.join(t("、")) || msg.text}</span>
			</button>
		);
	}
	if (msg.channel === "choice") {
		// 留痕的决策选择卡（重放）：置灰只读，标注结果（D10：岔路口是剧情资产）
		return msg.choice ? <ChoiceCard choice={msg.choice} /> : null;
	}
	if (msg.channel === "image") {
		// 插图（agent 经 show_image 交付）：舞台美术，与正文明确区隔（D10 合规：元信息层）
		return (
			<figure className="msg-image">
				<ZoomImg src={msg.src ?? ""} alt={msg.text || t("插图")} />
				{msg.text && <figcaption>{msg.text}</figcaption>}
			</figure>
		);
	}
	if (msg.channel === "audio") {
		// 音频（show_audio / tts / 气泡配音）：元交付，可播放
		return (
			<figure className="msg-audio">
				<audio controls preload="metadata" src={msg.src ?? ""}>
					{t("你的浏览器不支持音频播放")}
				</audio>
				{msg.text && <figcaption>{msg.text}</figcaption>}
			</figure>
		);
	}
	if (msg.channel === "video") {
		// 视频（show_video）：舞台美术，与正文区隔（D10）
		return (
			<figure className="msg-video">
				<video controls preload="metadata" playsInline src={msg.src ?? ""}>
					{t("你的浏览器不支持视频播放")}
				</video>
				{msg.text && <figcaption>{msg.text}</figcaption>}
			</figure>
		);
	}
	if (msg.channel === "html") {
		// 对话流 HTML 底座（show_html）：agent 调试通道，保持非 seamless
		if (!msg.html?.trim()) return null;
		return <HtmlFrame html={msg.html} title={msg.text} scripts={msg.scripts === true} />;
	}
	if (msg.channel === "authoring") {
		return <div className="msg msg-authoring">
			<div className="msg-head"><span className="msg-name">{msg.mode === "agent" ? "agent" : t("工作")}</span>{msg.unfinished && <span className="chip chip-unfinished">{t("已停止")}</span>}</div>
			{msg.segments?.length || msg.timeline?.length ? <TurnTimeline segments={msg.segments ?? msg.timeline!} plain /> : <>{msg.thinking && <ThinkingBlock text={msg.thinking} />}<Paragraphs text={msg.text} /></>}
		</div>;
	}
	if (msg.channel === "backstage") {
		// 戏外回复（助手答疑/办事）：排版明确区隔于叙事（PLAN-PHASE3 §6.1 显示通道）
		const name = msg.name || fallbackName;
		return (
			<div className="msg msg-backstage">
				<div className="msg-head">
					<MsgAvatar src={avatarUrl} name={name} kind="char" />
					<span className="msg-name">{name}</span>
					<span className="chip chip-backstage">{t("助手")}</span>
				</div>
				{msg.thinking && <ThinkingBlock text={msg.thinking} />}
				<RichContent text={msg.text} skin={skin} />
				{msg.activities && msg.activities.length > 0 && <ActivityBar activities={msg.activities} />}
			</div>
		);
	}
	if (msg.channel === "import") {
		return (
			<details className="import-block">
				<summary>{t("导入的聊天记录（点开查看）")}</summary>
				<RichContent text={msg.text} skin={skin} />
			</details>
		);
	}
	const isUser = msg.channel === "user";
	// 用户消息尾行的附件（附件随消息模型）：图片直接进对话显示，文件显示名+类型
	const { body, attachments } = isUser ? splitAttachments(msg.text) : { body: msg.text, attachments: [] };
	const name = msg.name || fallbackName;
	const editing = !!edit;
	/**
	 * 回合时间线：agent 回复才有（用户消息无过程），编辑态退回纯文本框。
	 * 有多于一段时才按时间线渲染——单段正文走旧路径可保留整楼界面判定。
	 */
	const timeline = !isUser && !editing && msg.segments && msg.segments.length > 1 ? msg.segments : null;
	// 整楼界面：皮肤应用后整条消息即界面（spec §4 落位 1）
	// 与 splitRichContentParts 同一条 needSkin：wire 侧 prepareDisplayText 已上过皮肤的正文不再重跑
	// （二次皮肤既改语义又极贵——617KB 的界面正文上实测 12.6s／次，且此处只为求一个布尔值）。
	const skinnedBody =
		!isUser && skin && skin.rules.length > 0 && !alreadyDisplayHtml(body)
			? applySkinKeepingBody(body, skin.rules, skin)
			: body;
	const stage = !isUser && !editing && isFullInterface(skinnedBody);
	return (
		<div
			className={`msg ${isUser ? "msg-user" : "msg-char"} ${isUser && msg.backstage ? "msg-user-backstage" : ""} ${editing ? "msg-editing" : ""} ${stage ? "msg-stage" : ""}`}
		>
			{!stage && (
				<div className="msg-head">
					<MsgAvatar src={avatarUrl} name={name} kind={isUser ? "user" : "char"} />
					<span className={`msg-name ${isUser ? "" : "msg-name-char"}`}>{name}</span>
					{msg.mode === "authoring" && <span className="chip">{t("工作")}</span>}
					{msg.channel === "greeting" && <span className="chip">{t("开场白")}</span>}
					{!isUser && msg.unfinished && (
						<span className="chip chip-unfinished" title={t("生成被中断；发送「继续」可接着写")}>
							{t("未完成")}
						</span>
					)}
					{editing && <span className="chip chip-edit">{t("编辑中")}</span>}
					{floor !== undefined && <span className="floor">#{floor}</span>}
				</div>
			)}
			{/* 有时间线时思考内联在时间线里（按发生顺序）；旧消息才走顶部固定块 */}
			{!timeline && msg.thinking && !editing && (
				<ThinkingBlock text={msg.thinking} defaultOpen={msg.unfinished === true} />
			)}
			{editing ? (
				<div className="msg-edit-box">
					<textarea
						className="msg-edit-ta"
						value={edit.draft}
						onChange={(e) => edit.onChange(e.target.value)}
						rows={Math.min(16, Math.max(4, edit.draft.split("\n").length + 1))}
						autoFocus
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								edit.onCancel();
							}
						}}
					/>
					<div className="msg-edit-actions">
						<button type="button" className="drawer-btn" onClick={edit.onCancel}>
							{t("放弃")}
						</button>
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={!edit.draft.trim()}
							onClick={edit.onSubmit}
							title={edit.submitLabel ?? t("确认修改")}
						>
							{t("重新生成")}
						</button>
					</div>
				</div>
			) : (
				<>
					{/* 时间线态：思考/工具/正文按发生顺序依次上屏（codex 式）。
					    附件仍取自正文尾行，故正文用时间线渲染、附件另挂。 */}
					{timeline ? (
						<TurnTimeline segments={timeline} skin={skin} />
					) : (
						body && (isUser ? <Paragraphs text={body} /> : <RichContent text={body} skin={skin} />)
					)}
					{attachments.length > 0 && (
						<div className="msg-attach">
							{attachments.map((a) =>
								a.image ? (
									<span key={a.file} className="msg-attach-img">
										<ZoomImg src={attachmentUrl(a)} alt={a.label} title={a.file} />
									</span>
								) : (
									<a key={a.file} href={attachmentUrl(a)} target="_blank" rel="noreferrer" className="file-chip" title={a.file}>
										<span className="file-ext">{(a.name.split(".").pop() ?? "?").toUpperCase()}</span>
										{a.label}
									</a>
								),
							)}
						</div>
					)}
					{/* 时间线态的工具步骤已内联在各自发生位置，不再末端重挂一份 */}
					{!timeline && msg.activities && msg.activities.length > 0 && <ActivityBar activities={msg.activities} />}
					{(onReroll || onEdit || onRewind || onDelete || onCopy || onStore || onTts || greetingSwitch || swipe) && (
						<div className="msg-actions">
							{/* 开场白快速切换：不进详情页 */}
							{greetingSwitch && (
								<span className="msg-variant-switch msg-greeting-switch" title={t("切换备选开场白（无需打开角色卡详情）")}>
									<button
										type="button"
										className="msg-variant-btn"
										onClick={greetingSwitch.onPrev}
										disabled={greetingSwitch.total <= 1}
										aria-label={t("上一条开场白")}
									>
										<IconChevronLeft size={16} />
									</button>
									<span className="msg-variant-idx">
										{t("开场 {i}/{n}", { i: greetingSwitch.index + 1, n: greetingSwitch.total })}
									</span>
									<button
										type="button"
										className="msg-variant-btn"
										onClick={greetingSwitch.onNext}
										disabled={greetingSwitch.total <= 1}
										aria-label={t("下一条开场白")}
									>
										<IconChevronRight size={16} />
									</button>
								</span>
							)}
							{/* ST 式回复变体：‹ n/m ›；末条点右 = 再生成，旧变体保留，仅当前进上下文，不写世界线 */}
							{swipe && (
								<span className="msg-variant-switch msg-swipe-switch" title={t("回复变体：仅当前选中进入模型；点右在末条时再生成")}>
									<button
										type="button"
										className="msg-variant-btn"
										onClick={swipe.onPrev}
										disabled={swipe.total > 0 && swipe.index <= 0}
										aria-label={t("上一条变体")}
									>
										<IconChevronLeft size={16} />
									</button>
									<span className="msg-variant-idx">
										{swipe.total > 0 ? `${swipe.index + 1}/${swipe.total}` : "1/1"}
									</span>
									<button
										type="button"
										className="msg-variant-btn msg-variant-btn-gen"
										onClick={swipe.onNext}
										aria-label={
											swipe.total === 0 || swipe.index >= swipe.total - 1
												? t("生成新变体")
												: t("下一条变体")
										}
										title={
											swipe.total === 0 || swipe.index >= swipe.total - 1
												? t("生成新回复（原回复保留为变体）")
												: t("下一条变体")
										}
									>
										<IconChevronRight size={16} />
									</button>
								</span>
							)}
							{onRewind && (
								<button className="act" onClick={onRewind} title={t("回退到此条之前（之后的剧情进会话树旁支）")}>
									<IconUndo size={13} /> {t("回退")}
								</button>
							)}
							{onReroll && (
								<button className="act" onClick={onReroll} title={t("再生成一条变体（原回复保留；等同末条点右箭头）")}>
									<IconRedo size={13} /> {t("生成")}
								</button>
							)}
							{onEdit && (
								<button className="act" onClick={onEdit} title={t("在本条内修改文案")}>
									<IconEdit size={13} /> {t("修改")}
								</button>
							)}
							{onDelete && (
								<button className="act" onClick={onDelete} title={t("删除本轮或最后角色回复")}>
									<IconTrash size={13} /> {t("删除")}
								</button>
							)}
							{onCopy && (
								<button className="act" onClick={() => onCopy(msg.text)} title={t("复制正文")}>
									<IconCopy size={13} /> {t("复制")}
								</button>
							)}
							{onStore && (
								<button className="act" onClick={onStore} title={t("在当前剧情点存档（世界线节点）")}>
									<IconPin size={13} /> {t("存档")}
								</button>
							)}
							{onTts && (
								<button
									className="act"
									disabled={ttsBusy || !msg.text.trim()}
									onClick={() => onTts(msg.text)}
									title={t("文生音：为这段正文生成语音并显示播放器")}
								>
									<IconSpeaker size={13} /> {ttsBusy ? t("配音中…") : t("配音")}
								</button>
							)}
						</div>
					)}
				</>
			)}
		</div>
	);
}
