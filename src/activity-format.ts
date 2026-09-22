/**
 * 工具过程条文案：把 tool 名 + 参数压成用户可读的「台侧步骤」一句。
 * 目标是 RP agent 化——像导演笔记，而不是 JSON / 运维日志。
 */

import { t } from "./i18n/index.ts";

function str(v: unknown): string {
	if (typeof v === "string") return v.trim();
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "";
}

function clip(s: string, max: number): string {
	const t = s.replace(/\s+/g, " ").trim();
	if (!t) return "";
	return t.length > max ? `${t.slice(0, max)}…` : t;
}

function firstLine(s: string, max = 80): string {
	const line = s.split(/\r?\n/).map((x) => x.trim()).find(Boolean) ?? "";
	return clip(line, max);
}

/** 是否像原始 JSON 参数（前端应隐藏或降级展示） */
export function looksLikeRawArgs(detail: string): boolean {
	const t = detail.trim();
	if (!t) return false;
	if ((t.startsWith("{") || t.startsWith("[")) && /"\w+"\s*:/.test(t)) return true;
	return false;
}

/**
 * tool_start → 过程条 detail。
 * 空串表示没有值得展示的摘要（前端只显示工具中文名）。
 */
export function formatToolStartDetail(toolName: string, args: unknown): string {
	const name = (toolName ?? "").trim();
	if (!args || typeof args !== "object" || Array.isArray(args)) return "";
	const a = args as Record<string, unknown>;

	switch (name) {
		case "lorebook_search": {
			const q = str(a.query) || str(a.q) || str(a.keyword) || str(a.keywords);
			return q ? t("检索设定：{q}", { q: clip(q, 60) }) : t("检索世界书");
		}
		case "lorebook_write": {
			const title = str(a.comment) || str(a.title) || str(a.name) || str(a.key);
			const body = str(a.content) || str(a.text) || str(a.entry);
			if (title && body) return t("写入设定「{title}」：{body}", { title: clip(title, 40), body: firstLine(body, 50) });
			if (title) return t("写入设定「{title}」", { title: clip(title, 48) });
			if (body) return t("写入新设定：{body}", { body: firstLine(body, 60) });
			return t("写入补充设定");
		}
		case "world_state_get":
			return t("核对当前账本事实");
		case "world_state_update": {
			const patch = a.patch ?? a.updates ?? a.state ?? a.changes;
			if (patch && typeof patch === "object") {
				const keys = Object.keys(patch as object).slice(0, 4);
				if (keys.length) return t("记账：{keys}{more}", { keys: keys.join(t("、")), more: Object.keys(patch as object).length > 4 ? "…" : "" });
			}
			const summary = str(a.summary) || str(a.note) || str(a.reason);
			return summary ? t("记账：{summary}", { summary: clip(summary, 60) }) : t("更新世界状态账本");
		}
		case "ask_director":
		case "ask": {
			const q = str(a.question) || str(a.title) || str(a.prompt);
			return q ? clip(q, 100) : t("请用户定夺剧情走向");
		}
		case "panel_write": {
			const n = str(a.name) || str(a.title) || str(a.id);
			const kind = str(a.kind);
			if (n && kind) return t("更新面板「{name}」（{kind}）", { name: clip(n, 32), kind });
			if (n) return t("更新面板「{name}」", { name: clip(n, 40) });
			return t("更新侧栏面板");
		}
		case "panel_read": {
			const n = str(a.name) || str(a.title) || str(a.id);
			return n ? t("查看面板「{name}」", { name: clip(n, 40) }) : t("查看侧栏面板");
		}
		case "panel_close": {
			const n = str(a.name) || str(a.title) || str(a.id);
			return n ? t("收起面板「{name}」", { name: clip(n, 40) }) : t("收起面板");
		}
		case "show_image":
		case "show_audio":
		case "show_video": {
			const cap = str(a.caption) || str(a.title);
			const kind = name === "show_image" ? t("插图") : name === "show_audio" ? t("音频") : t("视频");
			return cap ? t("展示{kind}：{cap}", { kind, cap: clip(cap, 48) }) : t("展示{kind}", { kind });
		}
		case "show_html": {
			const cap = str(a.caption) || str(a.title);
			return cap ? t("嵌入界面：{cap}", { cap: clip(cap, 48) }) : t("嵌入 HTML 界面");
		}
		case "tts": {
			const text = str(a.text) || str(a.content);
			return text ? t("配音：{text}", { text: firstLine(text, 48) }) : t("合成语音");
		}
		case "read": {
			const p = str(a.path) || str(a.file) || str(a.target);
			return p ? t("查阅 {path}", { path: clip(p, 56) }) : t("读取文件");
		}
		case "write":
		case "edit": {
			const p = str(a.path) || str(a.file) || str(a.target);
			if (name === "edit") return p ? t("改写 {path}", { path: clip(p, 56) }) : t("改写文件");
			return p ? t("写入 {path}", { path: clip(p, 56) }) : t("写入文件");
		}
		case "bash": {
			const cmd = str(a.command) || str(a.cmd);
			return cmd ? t("执行：{cmd}", { cmd: clip(cmd, 56) }) : t("执行命令");
		}
		case "grep": {
			const q = str(a.pattern) || str(a.query);
			return q ? t("在文件中搜：{q}", { q: clip(q, 48) }) : t("检索文件内容");
		}
		case "find":
		case "ls": {
			const p = str(a.path) || str(a.directory) || str(a.dir);
			return p ? t("浏览 {path}", { path: clip(p, 56) }) : name === "ls" ? t("列目录") : t("查找文件");
		}
		default: {
			// 通用：优先常见「意图」字段，避免整包 JSON
			for (const key of ["summary", "reason", "description", "task", "query", "question", "name", "title", "path"]) {
				const v = str(a[key]);
				if (v) return clip(v, 80);
			}
			return "";
		}
	}
}

/**
 * 从任意 args 生成 detail；失败时回退到旧 JSON 截断（尽量不用）。
 */
export function toolStartDetail(toolName: string, args: unknown, maxJsonFallback = 100): string {
	const human = formatToolStartDetail(toolName, args);
	if (human) return human;
	if (args === undefined || args === null) return "";
	try {
		const raw = JSON.stringify(args);
		if (!raw || raw === "{}" || raw === "[]") return "";
		// 仍返回空：宁可只显示中文工具名，也不要在 UI 上甩 JSON
		if (raw.length > maxJsonFallback) return "";
		if (looksLikeRawArgs(raw)) return "";
		return raw;
	} catch {
		return "";
	}
}

/** 过程条里可展开成 diff 的文件改动（agent/工作模式的原生 edit / write）：直接给原文，不给摘要——像 coding agent 的回显 */
export interface ActivityFileChange {
	path: string;
	/** edit：逐处 old/new */
	edits?: Array<{ old: string; new: string }>;
	/** write：整文件内容 */
	content?: string;
}

export function fileChangeOf(toolName: string, args: unknown): ActivityFileChange | undefined {
	if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
	const a = args as Record<string, unknown>;
	const path = typeof a.path === "string" ? a.path : "";
	if (!path) return undefined;
	if (toolName === "edit" && Array.isArray(a.edits)) {
		const edits = a.edits
			.filter((e): e is { oldText: string; newText: string } => !!e && typeof (e as { oldText?: unknown }).oldText === "string" && typeof (e as { newText?: unknown }).newText === "string")
			.map((e) => ({ old: e.oldText, new: e.newText }));
		return edits.length ? { path, edits } : undefined;
	}
	if (toolName === "write" && typeof a.content === "string") return { path, content: a.content };
	return undefined;
}
