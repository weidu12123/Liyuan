/**
 * 扩展能力面板（左栏，PLAN-PANELS-V2 §2.7）：agent 能调用的外部能力，分两类页签——
 * 技能（skill）与 MCP（本机发现 + 本对话开关）。
 * MCP：默认全关；开关绑当前对话（新对话=新窗口）；可选「记住为新对话默认」。
 */

import { useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut, downloadText, type SkillInfo } from "../api.ts";
import { IconPencil, IconTrash } from "./icons.tsx";
import { ConfirmButton, PanelStatus, Toggle, useAction, usePanelData } from "./kit.tsx";

// ---------- MCP 类型（与 /api/mcp 对齐） ----------

type McpTransport = "stdio" | "http" | "sse";
type McpSource = "claude" | "cursor" | "user" | "project-mcp" | "liyuan";

interface McpServerStatus {
	id: string;
	name: string;
	/** 本对话是否启用 */
	enabled: boolean;
	defaultEnabled?: boolean;
	transport: McpTransport;
	status: "disconnected" | "connecting" | "connected" | "error";
	error?: string;
	tools: Array<{ name: string; qualifiedName: string; description: string }>;
	summary: string;
	source?: McpSource;
	sources?: McpSource[];
	discovered?: boolean;
}

interface McpServerConfig {
	id: string;
	name: string;
	enabled: boolean;
	transport: McpTransport;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	url?: string;
	headers?: Record<string, string>;
}

interface McpListResponse {
	servers: McpServerStatus[];
	config: McpServerConfig[];
	sessionEnabled?: string[];
	discovered?: number;
}

const statusLabel: Record<McpServerStatus["status"], string> = {
	disconnected: "未连接",
	connecting: "连接中…",
	connected: "已连接",
	error: "失败",
};

const sourceLabel: Record<McpSource, string> = {
	claude: "Claude",
	cursor: "Cursor",
	user: "用户级",
	"project-mcp": "项目.mcp",
	liyuan: "本项目",
};

/** 从技能全文解析 frontmatter 与正文（编辑保存时重组） */
function splitSkill(raw: string): { name: string; description: string; disableModelInvocation: boolean; body: string } {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
	if (!m) return { name: "", description: "", disableModelInvocation: false, body: raw.trim() };
	const head = m[1];
	const pick = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(head)?.[1]?.trim() ?? "";
	return {
		name: pick("name"),
		description: pick("description"),
		disableModelInvocation: /^disable-model-invocation:\s*true\s*$/m.test(head),
		body: m[2].trim(),
	};
}

function SkillRow({
	s,
	busy,
	onSaved,
	onDelete,
	toast,
}: {
	s: SkillInfo;
	busy: boolean;
	onSaved: () => void;
	onDelete: (file: string) => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const [content, setContent] = useState<string | null>(null);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);

	const loadContent = async (): Promise<string | null> => {
		if (content !== null) return content;
		try {
			const r = await apiGet<{ content: string }>(`/api/skills/content?file=${encodeURIComponent(s.file)}`);
			setContent(r.content);
			return r.content;
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
			return null;
		}
	};

	const saveWith = async (patch: { content?: string; disableModelInvocation?: boolean }) => {
		const raw = await loadContent();
		if (raw === null) return;
		const parsed = splitSkill(raw);
		setSaving(true);
		try {
			await apiPost("/api/skills", {
				name: s.name,
				description: s.description,
				content: patch.content ?? parsed.body,
				disableModelInvocation: patch.disableModelInvocation ?? s.disableModelInvocation,
			});
			setContent(null);
			onSaved();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const startEdit = async () => {
		const c = await loadContent();
		if (c === null) return;
		setDraft(splitSkill(c).body);
		setEditing(true);
	};

	const doExport = async () => {
		const c = await loadContent();
		if (c !== null) downloadText(`${s.name}.md`, c);
	};

	return (
		<div className="lore-item">
			<div className="lore-head">
				<details onToggle={(ev) => (ev.target as HTMLDetailsElement).open && void loadContent()}>
					<summary>
						<span className="lore-title">{s.name}</span>
						{s.description && <span className="lore-meta skill-desc">{s.description}</span>}
					</summary>
					{editing ? (
						<div className="skill-edit">
							<textarea className="panel-search ta" rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} />
							<div className="panel-row">
								<button
									className="drawer-btn"
									disabled={saving}
									onClick={() => {
										void saveWith({ content: draft }).then(() => setEditing(false));
									}}
								>
									{saving ? "保存中…" : "保存"}
								</button>
								<button className="drawer-btn" onClick={() => setEditing(false)}>
									取消
								</button>
							</div>
						</div>
					) : (
						content !== null && <div className="longtext">{content}</div>
					)}
					{!editing && (
						<div className="skill-acts">
							<button className="act" onClick={() => void startEdit()}>
								<IconPencil size={12} /> 编辑
							</button>
							<button className="act" onClick={() => void doExport()}>
								导出 .md
							</button>
							<ConfirmButton confirmText="确认删除" disabled={busy} onConfirm={() => onDelete(s.file)}>
								<IconTrash size={12} /> 删除
							</ConfirmButton>
						</div>
					)}
				</details>
				<label className="expose-toggle" title="开=进入模型可见的技能索引，agent 可自主调用；关=对模型隐身">
					<span className="expose-label">{s.disableModelInvocation ? "已隐藏" : "已暴露"}</span>
					<Toggle
						checked={!s.disableModelInvocation}
						disabled={busy || saving}
						onChange={(v) => void saveWith({ disableModelInvocation: !v })}
					/>
				</label>
			</div>
		</div>
	);
}

function NewSkillForm({ onCreated, toast }: { onCreated: () => void; toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [desc, setDesc] = useState("");
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const create = async () => {
		setBusy(true);
		try {
			await apiPost("/api/skills", { name: name.trim(), description: desc.trim(), content: body });
			setName("");
			setDesc("");
			setBody("");
			setOpen(false);
			toast("info", "技能已新建");
			onCreated();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const importMd = async (file: File) => {
		try {
			const raw = await file.text();
			const parsed = splitSkill(raw);
			await apiPost("/api/skills", {
				name: parsed.name || file.name.replace(/\.md$/i, ""),
				description: parsed.description,
				content: parsed.body,
				disableModelInvocation: parsed.disableModelInvocation,
			});
			toast("info", "技能已导入");
			onCreated();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			if (fileRef.current) fileRef.current.value = "";
		}
	};

	return (
		<div className="new-skill">
			<div className="panel-row">
				<button className="drawer-btn" onClick={() => setOpen((v) => !v)}>
					{open ? "收起" : "＋ 新建技能"}
				</button>
				<button className="drawer-btn" onClick={() => fileRef.current?.click()}>
					导入 .md
				</button>
				<input
					ref={fileRef}
					type="file"
					accept=".md,text/markdown"
					hidden
					onChange={(e) => {
						const f = e.target.files?.[0];
						if (f) void importMd(f);
					}}
				/>
			</div>
			{open && (
				<div className="provider-edit">
					<input className="panel-search" placeholder="技能名（如 codex-生图）" value={name} onChange={(e) => setName(e.target.value)} />
					<input className="panel-search" placeholder="一句话描述" value={desc} onChange={(e) => setDesc(e.target.value)} />
					<textarea className="panel-search ta" rows={6} placeholder="正文：endpoint、认证、请求格式、curl 示例…" value={body} onChange={(e) => setBody(e.target.value)} />
					<button className="drawer-btn" disabled={busy || !name.trim() || !body.trim()} onClick={() => void create()}>
						{busy ? "创建中…" : "创建"}
					</button>
				</div>
			)}
		</div>
	);
}

function parseArgsLine(line: string): string[] {
	// 简易：按空格拆，支持 "双引号" 包一段
	const out: string[] = [];
	const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(line))) {
		out.push(m[1] ?? m[2] ?? m[3] ?? "");
	}
	return out.filter(Boolean);
}

function parseEnvLines(text: string): Record<string, string> | undefined {
	const env: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith("#")) continue;
		const i = t.indexOf("=");
		if (i <= 0) continue;
		env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
	}
	return Object.keys(env).length ? env : undefined;
}

function envToLines(env?: Record<string, string>): string {
	if (!env) return "";
	return Object.entries(env)
		.map(([k, v]) => `${k}=${v}`)
		.join("\n");
}

function McpServerRow({
	st,
	cfg,
	busy,
	onChanged,
	toast,
}: {
	st: McpServerStatus;
	cfg?: McpServerConfig;
	busy: boolean;
	onChanged: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const projectOwned = !!cfg || st.source === "liyuan";
	const src = st.source ? sourceLabel[st.source] : "发现";

	const toggleEnabled = async (enabled: boolean) => {
		setSaving(true);
		try {
			// 本对话开关；同时写入新对话默认，避免「开了下次又没了」
			await apiPost("/api/mcp/enable", { id: st.id, enabled, persistDefault: true });
			onChanged();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const remove = async () => {
		setSaving(true);
		try {
			await apiDelete(`/api/mcp/servers?id=${encodeURIComponent(st.id)}`);
			toast("info", "已删除项目条目");
			onChanged();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const probe = async () => {
		setSaving(true);
		try {
			const r = await apiPost<{ ok: boolean; error?: string; tools: Array<{ name: string }> }>("/api/mcp/probe", {
				id: st.id,
				...(cfg ?? {}),
			});
			if (r.ok) toast("info", `连通，发现 ${r.tools.length} 个工具`);
			else toast("error", r.error || "探测失败");
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="lore-item">
			<div className="lore-head">
				<details>
					<summary>
						<span className="lore-title">{st.name}</span>
						<span className="lore-meta">
							{src} · {st.transport} · {statusLabel[st.status]}
							{st.tools.length ? ` · ${st.tools.length} 工具` : ""}
						</span>
					</summary>
					<div className="field-hint" style={{ marginTop: 6 }}>
						<code>{st.id}</code>
						{st.summary ? ` · ${st.summary}` : ""}
						{st.sources && st.sources.length > 1 ? ` · 来源 ${st.sources.map((s) => sourceLabel[s]).join("+")}` : ""}
					</div>
					{st.error && <div className="sp-empty" style={{ color: "var(--danger, #b44)" }}>{st.error}</div>}
					{st.tools.length > 0 && (
						<ul className="mcp-tool-list" style={{ margin: "8px 0", paddingLeft: 18, fontSize: 12 }}>
							{st.tools.map((t) => (
								<li key={t.qualifiedName} title={t.description}>
									<code>{t.qualifiedName}</code>
									{t.description ? ` — ${t.description}` : ""}
								</li>
							))}
						</ul>
					)}
					{editing && cfg ? (
						<McpServerForm
							initial={cfg}
							busy={saving}
							submitLabel="保存"
							onCancel={() => setEditing(false)}
							onSubmit={async (body) => {
								setSaving(true);
								try {
									await apiPut("/api/mcp/servers", { ...body, id: st.id });
									setEditing(false);
									toast("info", "已保存");
									onChanged();
								} catch (e) {
									toast("error", e instanceof Error ? e.message : String(e));
								} finally {
									setSaving(false);
								}
							}}
							onProbe={async (body) => {
								const r = await apiPost<{ ok: boolean; error?: string; tools: Array<{ name: string }> }>("/api/mcp/probe", {
									...body,
									id: st.id,
								});
								if (r.ok) toast("info", `连通，发现 ${r.tools.length} 个工具`);
								else toast("error", r.error || "探测失败");
							}}
						/>
					) : (
						<div className="skill-acts">
							{projectOwned && (
								<button className="act" disabled={busy || saving || !cfg} onClick={() => setEditing(true)}>
									<IconPencil size={12} /> 编辑
								</button>
							)}
							<button className="act" disabled={busy || saving} onClick={() => void probe()}>
								测试连接
							</button>
							{projectOwned && (
								<ConfirmButton confirmText="确认删除" disabled={busy || saving} onConfirm={() => void remove()}>
									<IconTrash size={12} /> 删除
								</ConfirmButton>
							)}
							{st.discovered && !projectOwned && (
								<span className="field-hint" style={{ fontSize: 11 }}>
									发现项：关=本对话屏蔽；开=本对话可用
								</span>
							)}
						</div>
					)}
				</details>
				<label
					className="expose-toggle"
					title="开=仅本对话连接并暴露工具；关=本对话屏蔽。会同时记为新对话默认。"
				>
					<span className="expose-label">
						{st.enabled ? (st.status === "connected" ? "本对话·开" : "本对话·启用中") : "本对话·关"}
					</span>
					<Toggle checked={st.enabled} disabled={busy || saving} onChange={(v) => void toggleEnabled(v)} />
				</label>
			</div>
		</div>
	);
}

function McpServerForm({
	initial,
	busy,
	submitLabel,
	onSubmit,
	onCancel,
	onProbe,
}: {
	initial?: Partial<McpServerConfig>;
	busy: boolean;
	submitLabel: string;
	onSubmit: (body: Partial<McpServerConfig>) => void | Promise<void>;
	onCancel?: () => void;
	onProbe?: (body: Partial<McpServerConfig>) => void | Promise<void>;
}) {
	const [name, setName] = useState(initial?.name ?? "");
	const [transport, setTransport] = useState<McpTransport>(initial?.transport ?? "stdio");
	const [command, setCommand] = useState(initial?.command ?? "npx");
	const [argsLine, setArgsLine] = useState((initial?.args ?? ["-y", "@modelcontextprotocol/server-everything"]).join(" "));
	const [cwd, setCwd] = useState(initial?.cwd ?? "");
	const [url, setUrl] = useState(initial?.url ?? "");
	const [envText, setEnvText] = useState(envToLines(initial?.env));
	const [headerText, setHeaderText] = useState(envToLines(initial?.headers));
	const [localBusy, setLocalBusy] = useState(false);

	const build = (): Partial<McpServerConfig> => {
		const base: Partial<McpServerConfig> = {
			name: name.trim() || undefined,
			transport,
			enabled: initial?.enabled !== false,
		};
		if (transport === "stdio") {
			base.command = command.trim();
			base.args = parseArgsLine(argsLine);
			if (cwd.trim()) base.cwd = cwd.trim();
			base.env = parseEnvLines(envText);
		} else {
			base.url = url.trim();
			base.headers = parseEnvLines(headerText);
		}
		return base;
	};

	return (
		<div className="provider-edit" style={{ marginTop: 8 }}>
			<input className="panel-search" placeholder="显示名（如 Playwright）" value={name} onChange={(e) => setName(e.target.value)} />
			<div className="seg-row" style={{ margin: "6px 0" }}>
				{(["stdio", "http", "sse"] as McpTransport[]).map((t) => (
					<button key={t} type="button" className={`seg ${transport === t ? "active" : ""}`} onClick={() => setTransport(t)}>
						{t}
					</button>
				))}
			</div>
			{transport === "stdio" ? (
				<>
					<input className="panel-search" placeholder="command（如 npx / node / uvx）" value={command} onChange={(e) => setCommand(e.target.value)} />
					<input
						className="panel-search"
						placeholder='args（空格分隔，可用 "引号"）：-y @playwright/mcp@latest'
						value={argsLine}
						onChange={(e) => setArgsLine(e.target.value)}
					/>
					<input className="panel-search" placeholder="cwd（可选）" value={cwd} onChange={(e) => setCwd(e.target.value)} />
					<textarea
						className="panel-search ta"
						rows={3}
						placeholder={"环境变量（可选，每行 KEY=value）"}
						value={envText}
						onChange={(e) => setEnvText(e.target.value)}
					/>
				</>
			) : (
				<>
					<input
						className="panel-search"
						placeholder={transport === "sse" ? "SSE URL" : "Streamable HTTP URL（如 http://127.0.0.1:3000/mcp）"}
						value={url}
						onChange={(e) => setUrl(e.target.value)}
					/>
					<textarea
						className="panel-search ta"
						rows={2}
						placeholder={"HTTP 头（可选，每行 Header=value）"}
						value={headerText}
						onChange={(e) => setHeaderText(e.target.value)}
					/>
				</>
			)}
			<div className="panel-row">
				<button
					className="drawer-btn"
					disabled={busy || localBusy || (transport === "stdio" ? !command.trim() : !url.trim())}
					onClick={() => void onSubmit(build())}
				>
					{busy || localBusy ? "…" : submitLabel}
				</button>
				{onProbe && (
					<button
						className="drawer-btn"
						disabled={busy || localBusy}
						onClick={() => {
							setLocalBusy(true);
							void Promise.resolve(onProbe(build())).finally(() => setLocalBusy(false));
						}}
					>
						测试连接
					</button>
				)}
				{onCancel && (
					<button className="drawer-btn" onClick={onCancel}>
						取消
					</button>
				)}
			</div>
		</div>
	);
}

function McpSection({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<McpListResponse>("/api/mcp"), { watchAgent: true, cacheKey: "/api/mcp" });
	const { busy, run } = useAction(toast);
	const [adding, setAdding] = useState(false);
	const servers = data?.servers ?? [];
	const configs = data?.config ?? [];
	const cfgById = new Map(configs.map((c) => [c.id, c]));
	const sessionOn = data?.sessionEnabled?.length ?? servers.filter((s) => s.enabled).length;
	const discovered = data?.discovered ?? servers.length;

	const sync = () =>
		run(async () => {
			await apiPost("/api/mcp/sync", {});
			reload();
		}, "已同步连接");

	return (
		<section className="sp-section">
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			<div className="field-hint">
				自动扫描本机 Claude / Cursor / <code>~/.liyuan/mcp.json</code> / 项目配置（与 Grok 同类发现）。
				<strong>默认全关</strong>——RP 用不到的不必开。开关只影响<strong>当前对话</strong>（新对话是新窗口）；打开时会记为新对话默认。
				工具名：<code>mcp__服务器__工具</code>。
			</div>
			{data && (
				<div className="field-hint" style={{ marginBottom: 8 }}>
					本机发现 {discovered} · 本对话启用 {sessionOn}
				</div>
			)}
			<div className="panel-row">
				<button className="drawer-btn" onClick={() => setAdding((v) => !v)}>
					{adding ? "收起" : "＋ 添加（项目覆盖）"}
				</button>
				<button className="drawer-btn" disabled={busy} onClick={() => void sync()}>
					重新同步
				</button>
			</div>
			{adding && (
				<McpServerForm
					busy={busy}
					submitLabel="写入项目"
					onCancel={() => setAdding(false)}
					onSubmit={async (body) => {
						await run(async () => {
							await apiPost("/api/mcp/servers", body);
							setAdding(false);
							reload();
						}, "已添加");
					}}
					onProbe={async (body) => {
						const r = await apiPost<{ ok: boolean; error?: string; tools: Array<{ name: string }> }>("/api/mcp/probe", body);
						if (r.ok) toast("info", `连通，发现 ${r.tools.length} 个工具`);
						else toast("error", r.error || "探测失败");
					}}
				/>
			)}
			{data && servers.length === 0 && !adding && (
				<div className="sp-empty">
					未发现 MCP。可在 Claude Code 配置，或点「添加」手写；stdio 示例：command=<code>npx</code> args=<code>-y @playwright/mcp@latest</code>
				</div>
			)}
			{servers.map((st) => (
				<McpServerRow
					key={st.id}
					st={st}
					cfg={cfgById.get(st.id)}
					busy={busy}
					onChanged={reload}
					toast={toast}
				/>
			))}
		</section>
	);
}

export function PowersPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const [tab, setTab] = useState<"skills" | "mcp">("skills");
	const { data, error, loading, reload } = usePanelData(() => apiGet<{ skills: SkillInfo[] }>("/api/skills"), { watchAgent: true, cacheKey: "/api/skills" });
	const { busy, run } = useAction(toast);
	const list = data?.skills ?? [];

	const remove = (file: string) =>
		run(async () => {
			await apiDelete(`/api/skills?file=${encodeURIComponent(file)}`);
			reload();
		}, "已删除");

	return (
		<div className="panel-body">
			<div className="seg-row seg-tabs">
				<button className={`seg ${tab === "skills" ? "active" : ""}`} onClick={() => setTab("skills")}>
					技能（{list.length}）
				</button>
				<button className={`seg ${tab === "mcp" ? "active" : ""}`} onClick={() => setTab("mcp")}>
					MCP
				</button>
			</div>

			{tab === "skills" && (
				<section className="sp-section">
					<PanelStatus loading={loading} error={error} hasData={!!data} />
					{data && (
						<>
							<div className="field-hint">
								agent 摸通外部服务后自写的调用笔记（技能库），跨会话复用。「暴露」开着的技能进入模型可见的索引，
								agent 会在需要时自主装载执行；关掉即对模型隐身。改动索引在下次会话重载时生效。
							</div>
							<NewSkillForm onCreated={reload} toast={toast} />
							{list.length === 0 && <div className="sp-empty">技能库是空的——agent 摸通第一个外部服务后这里就有了，也可手动新建/导入。</div>}
							{list.map((s) => (
								<SkillRow key={s.file} s={s} busy={busy} onSaved={reload} onDelete={remove} toast={toast} />
							))}
						</>
					)}
				</section>
			)}

			{tab === "mcp" && <McpSection toast={toast} />}
		</div>
	);
}
