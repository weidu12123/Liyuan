/**
 * 扩展能力面板（左栏，PLAN-PANELS-V2 §2.7）：agent 能调用的外部能力，分两类页签——
 * 技能（skill）与 MCP（内置 / 外部两栏：内置随梨园发布包走，外部为本机发现 + 项目手写）。
 * 配置编辑：单张完整 JSON 卡（JSON 为准），无表单。
 */

import { useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut, downloadText, type SkillInfo } from "../api.ts";
import { IconPencil, IconTrash } from "./icons.tsx";
import { ConfirmButton, PanelStatus, Toggle, useAction, usePanelData } from "./kit.tsx";
import { SkillLibrary } from "./SkillLibrary.tsx";
import { t } from "../i18n/index.ts";

// ---------- MCP 类型（与 /api/mcp 对齐） ----------

type McpTransport = "stdio" | "http" | "sse";
type McpSource = "builtin" | "claude" | "cursor" | "user" | "project-mcp" | "liyuan";

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
	/** true=梨园内置（「内置 MCP」栏） */
	builtin?: boolean;
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
	/** 发现项的完整配置（编辑发现项→建项目覆盖时预填） */
	catalog?: McpServerConfig[];
	sessionEnabled?: string[];
	discovered?: number;
}

const statusLabel: Record<McpServerStatus["status"], string> = {
	disconnected: "未连接", // i18n-ignore：用时 t()
	connecting: "连接中…", // i18n-ignore：用时 t()
	connected: "已连接", // i18n-ignore：用时 t()
	error: "失败", // i18n-ignore：用时 t()
};

const sourceLabel: Record<McpSource, string> = {
	builtin: "内置", // i18n-ignore：用时 t()
	claude: "Claude",
	cursor: "Cursor",
	user: "用户级", // i18n-ignore：用时 t()
	"project-mcp": "项目.mcp", // i18n-ignore：用时 t()
	liyuan: "本项目", // i18n-ignore：用时 t()
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
									{saving ? t("保存中…") : t("保存")}
								</button>
								<button className="drawer-btn" onClick={() => setEditing(false)}>
									{t("取消")}
								</button>
							</div>
						</div>
					) : (
						content !== null && <div className="longtext">{content}</div>
					)}
					{!editing && (
						<div className="skill-acts">
							<button className="act" onClick={() => void startEdit()}>
								<IconPencil size={12} /> {t("编辑")}
							</button>
							<button className="act" onClick={() => void doExport()}>
								{t("导出 .md")}
							</button>
							<ConfirmButton confirmText={t("确认删除")} disabled={busy} onConfirm={() => onDelete(s.file)}>
								<IconTrash size={12} /> {t("删除")}
							</ConfirmButton>
						</div>
					)}
				</details>
				<label className="expose-toggle" title={t("开=进入模型可见的技能索引，agent 可自主调用；关=对模型隐身")}>
					<span className="expose-label">{s.disableModelInvocation ? t("已隐藏") : t("已暴露")}</span>
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
			toast("info", t("技能已新建"));
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
			toast("info", t("技能已导入"));
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
					{open ? t("收起") : t("＋ 新建技能")}
				</button>
				<button className="drawer-btn" onClick={() => fileRef.current?.click()}>
					{t("导入 .md")}
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
					<input className="panel-search" placeholder={t("技能名（如 codex-生图）")} value={name} onChange={(e) => setName(e.target.value)} />
					<input className="panel-search" placeholder={t("一句话描述")} value={desc} onChange={(e) => setDesc(e.target.value)} />
					<textarea className="panel-search ta" rows={6} placeholder={t("正文：endpoint、认证、请求格式、curl 示例…")} value={body} onChange={(e) => setBody(e.target.value)} />
					<button className="drawer-btn" disabled={busy || !name.trim() || !body.trim()} onClick={() => void create()}>
						{busy ? t("创建中…") : t("创建")}
					</button>
				</div>
			)}
		</div>
	);
}

// ---------- MCP 配置编辑器：单张完整 JSON 卡（JSON 为准） ----------

function prettyJson(o: unknown): string {
	return JSON.stringify(o, null, 2) ?? "";
}

/** 配置对象 → 编辑器初始 JSON（只留有值字段，字段顺序稳定） */
function configToJson(initial: Partial<McpServerConfig> | undefined, mode: "create" | "edit"): string {
	const o: Record<string, unknown> = {};
	o.id = initial?.id ?? "";
	o.name = initial?.name ?? "";
	o.transport = initial?.transport ?? "stdio";
	if (initial?.command !== undefined || (!initial?.url && mode === "create")) {
		o.command = initial?.command ?? "npx";
		o.args = initial?.args ?? ["-y", "@modelcontextprotocol/server-everything"];
	} else {
		if (initial?.command) o.command = initial.command;
		if (initial?.args?.length) o.args = initial.args;
	}
	if (initial?.cwd) o.cwd = initial.cwd;
	o.env = initial?.env ?? {};
	if (initial?.url) o.url = initial.url;
	if (initial?.headers) o.headers = initial.headers;
	o.enabled = initial?.enabled ?? true;
	return prettyJson(o);
}

function isStringMap(v: unknown): v is Record<string, string> {
	return !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
}

/** JSON 文本 → 提交体。容忍 Claude 风格 type 字段；不合法返回 error */
function parseMcpJson(jsonText: string): { body: Partial<McpServerConfig> & { id?: string } } | { error: string } {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(jsonText) as Record<string, unknown>;
	} catch (e) {
		return { error: t("JSON 不合法：{err}", { err: e instanceof Error ? e.message : String(e) }) };
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: t("JSON 需是对象") };
	const kind = parsed.transport ?? parsed.type;
	const transport: McpTransport =
		kind === "http" || kind === "streamable-http" || kind === "streamableHttp"
			? "http"
			: kind === "sse"
				? "sse"
				: kind === "stdio"
					? "stdio"
					: typeof parsed.url === "string" && parsed.url.trim()
						? "sse"
						: "stdio";
	return {
		body: {
			id: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined,
			name: typeof parsed.name === "string" ? parsed.name.trim() : undefined,
			transport,
			enabled: parsed.enabled === true,
			command: typeof parsed.command === "string" ? parsed.command : undefined,
			args: Array.isArray(parsed.args) ? parsed.args.filter((x): x is string => typeof x === "string") : undefined,
			cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
			env: isStringMap(parsed.env) && Object.keys(parsed.env).length ? parsed.env : undefined,
			url: typeof parsed.url === "string" ? parsed.url : undefined,
			headers: isStringMap(parsed.headers) && Object.keys(parsed.headers).length ? parsed.headers : undefined,
		},
	};
}

function McpServerForm({
	initial,
	mode,
	busy,
	submitLabel,
	onSubmit,
	onCancel,
	onProbe,
	toast,
}: {
	initial?: Partial<McpServerConfig>;
	/** edit=走 PUT（id 只读）；create=POST（JSON 里的 id 可写，留空自动分配） */
	mode: "create" | "edit";
	busy: boolean;
	submitLabel: string;
	onSubmit: (body: Partial<McpServerConfig>) => void | Promise<void>;
	onCancel?: () => void;
	onProbe?: (body: Partial<McpServerConfig>) => void | Promise<void>;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const [jsonText, setJsonText] = useState(() => configToJson(initial, mode));
	const [localBusy, setLocalBusy] = useState(false);

	const format = () => {
		try {
			setJsonText(JSON.stringify(JSON.parse(jsonText), null, 2));
		} catch (e) {
			toast("error", t("JSON 不合法：{err}", { err: e instanceof Error ? e.message : String(e) }));
		}
	};

	const currentBody = (): (Partial<McpServerConfig> & { id?: string }) | null => {
		const r = parseMcpJson(jsonText);
		if ("error" in r) {
			toast("error", r.error);
			return null;
		}
		return r.body;
	};

	const submit = () => {
		const body = currentBody();
		if (!body) return Promise.resolve();
		if (mode === "edit") delete body.id;
		return Promise.resolve(onSubmit(body));
	};

	const probe = () => {
		const body = currentBody();
		if (!body) return Promise.resolve();
		return Promise.resolve(onProbe!(body));
	};

	return (
		<div className="mcp-edit">
			<div className="conn-sec mcp-edit-card">
				<div className="conn-sec-title mcp-json-title">
					<span>{t("完整的 JSON 配置")}</span>
					<span className="mcp-json-acts">
						<button type="button" className="act" onClick={format}>
							{t("格式化")}
						</button>
					</span>
				</div>
				<textarea
					className="panel-search ta conn-json conn-json-full"
					rows={10}
					spellCheck={false}
					value={jsonText}
					onChange={(e) => setJsonText(e.target.value)}
				/>
			</div>

			<div className="panel-row" style={{ marginTop: 8 }}>
				<button
					className="drawer-btn"
					disabled={busy || localBusy}
					onClick={() => {
						setLocalBusy(true);
						void submit().finally(() => setLocalBusy(false));
					}}
				>
					{busy || localBusy ? "…" : submitLabel}
				</button>
				{onProbe && (
					<button
						className="drawer-btn"
						disabled={busy || localBusy}
						onClick={() => {
							setLocalBusy(true);
							void probe().finally(() => setLocalBusy(false));
						}}
					>
						{t("测试连接")}
					</button>
				)}
				{onCancel && (
					<button className="drawer-btn" onClick={onCancel}>
						{t("取消")}
					</button>
				)}
			</div>
		</div>
	);
}

function McpServerRow({
	st,
	cfg,
	base,
	busy,
	onChanged,
	toast,
}: {
	st: McpServerStatus;
	/** 项目手写配置（存在=可 PUT 编辑 / 删除） */
	cfg?: McpServerConfig;
	/** 发现项完整配置（编辑发现项→建项目覆盖时的预填） */
	base?: McpServerConfig;
	busy: boolean;
	onChanged: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [editing, setEditing] = useState(false);
	const [saving, setSaving] = useState(false);
	const projectOwned = !!cfg || st.source === "liyuan";
	const src = st.source ? t(sourceLabel[st.source]) : t("发现");
	// 编辑预填：项目条目优先，发现项退回目录完整配置
	const editInitial = cfg ?? base ?? { id: st.id, name: st.name, transport: st.transport };

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
			toast("info", t("已删除项目条目"));
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
				...(cfg ?? base ?? {}),
			});
			if (r.ok) toast("info", t("连通，发现 {n} 个工具", { n: r.tools.length }));
			else toast("error", r.error || t("探测失败"));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const openEdit = () => {
		setEditing(true);
		setExpanded(true);
	};

	return (
		<div className="lore-item">
			<div className="lore-head">
				<button type="button" className="lore-head-main" onClick={() => setExpanded((v) => !v)}>
					<span className="lore-title">{st.name}</span>
					<span className="lore-meta">
						{st.builtin ? "" : `${src} · `}
						{st.transport} · {t(statusLabel[st.status])}
						{st.tools.length ? t(" · {n} 工具", { n: st.tools.length }) : ""}
					</span>
				</button>
				<button
					type="button"
					className="act"
					title={projectOwned ? t("编辑配置") : t("编辑（保存为项目覆盖）")}
					disabled={busy || saving}
					onClick={openEdit}
				>
					<IconPencil size={12} />
				</button>
				<label className="expose-toggle" title={t("开=本对话连接并暴露工具；关=本对话屏蔽。同时记为新对话默认。")}>
					<Toggle checked={st.enabled} disabled={busy || saving} onChange={(v) => void toggleEnabled(v)} />
				</label>
			</div>
			{expanded && (
				<div className="lore-body" style={{ marginTop: 6 }}>
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
					{editing ? (
						<McpServerForm
							initial={editInitial}
							mode={projectOwned ? "edit" : "create"}
							busy={saving}
							submitLabel={t("保存")}
							toast={toast}
							onCancel={() => setEditing(false)}
							onSubmit={async (body) => {
								setSaving(true);
								try {
									if (projectOwned) {
										await apiPut("/api/mcp/servers", { ...body, id: st.id });
									} else {
										await apiPost("/api/mcp/servers", { ...body, id: st.id });
									}
									toast("info", t("已保存"));
									setEditing(false);
									onChanged();
								} catch (e) {
									toast("error", e instanceof Error ? e.message : String(e));
								} finally {
									setSaving(false);
								}
							}}
							onProbe={async (body) => {
								const r = await apiPost<{ ok: boolean; error?: string; tools: Array<{ name: string }> }>(
									"/api/mcp/probe",
									{ ...body, id: st.id },
								);
								if (r.ok) toast("info", t("连通，发现 {n} 个工具", { n: r.tools.length }));
								else toast("error", r.error || t("探测失败"));
							}}
						/>
					) : (
						<div className="skill-acts">
							<button className="act" disabled={busy || saving} onClick={() => void probe()}>
								{t("测试连接")}
							</button>
							{projectOwned && !st.builtin && (
								<ConfirmButton confirmText={t("确认删除")} disabled={busy || saving} onConfirm={() => void remove()}>
									<IconTrash size={12} /> {t("删除")}
								</ConfirmButton>
							)}
							{projectOwned && st.builtin && (
								<ConfirmButton confirmText={t("确认重置")} disabled={busy || saving} onConfirm={() => void remove()}>
									{t("重置配置")}
								</ConfirmButton>
							)}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function McpSection({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<McpListResponse>("/api/mcp"), { watchAgent: true, cacheKey: "/api/mcp" });
	const { busy, run } = useAction(toast);
	const [adding, setAdding] = useState(false);
	const [kind, setKind] = useState<"builtin" | "external">("builtin");
	const servers = data?.servers ?? [];
	const configs = data?.config ?? [];
	const catalog = data?.catalog ?? [];
	const cfgById = new Map(configs.map((c) => [c.id, c]));
	const catById = new Map(catalog.map((c) => [c.id, c]));
	const builtins = servers.filter((s) => s.builtin);
	const externals = servers.filter((s) => !s.builtin);
	const list = kind === "builtin" ? builtins : externals;

	const sync = () =>
		run(async () => {
			await apiPost("/api/mcp/sync", {});
			reload();
		}, t("已同步连接"));

	return (
		<section className="sp-section">
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			<div className="seg-row" style={{ marginBottom: 8 }}>
				<button className={`seg ${kind === "builtin" ? "active" : ""}`} onClick={() => setKind("builtin")}>
					{t("内置 MCP")}
				</button>
				<button className={`seg ${kind === "external" ? "active" : ""}`} onClick={() => setKind("external")}>
					{t("外部 MCP")}
				</button>
			</div>
			{kind === "external" && (
				<div className="panel-row">
					<button className="drawer-btn" onClick={() => setAdding((v) => !v)}>
						{adding ? t("收起") : t("＋ 添加")}
					</button>
					<button className="drawer-btn" disabled={busy} onClick={() => void sync()}>
						{t("重新同步")}
					</button>
				</div>
			)}
			{kind === "external" && adding && (
				<McpServerForm
					mode="create"
					busy={busy}
					submitLabel={t("写入项目")}
					toast={toast}
					onCancel={() => setAdding(false)}
					onSubmit={async (body) => {
						await run(async () => {
							await apiPost("/api/mcp/servers", body);
							setAdding(false);
							reload();
						}, t("已添加"));
					}}
					onProbe={async (body) => {
						const r = await apiPost<{ ok: boolean; error?: string; tools: Array<{ name: string }> }>("/api/mcp/probe", body);
						if (r.ok) toast("info", t("连通，发现 {n} 个工具", { n: r.tools.length }));
						else toast("error", r.error || t("探测失败"));
					}}
				/>
			)}
			{data && kind === "external" && externals.length === 0 && !adding && <div className="sp-empty">{t("未发现外部 MCP。")}</div>}
			{list.map((st) => (
				<McpServerRow
					key={st.id}
					st={st}
					cfg={cfgById.get(st.id)}
					base={catById.get(st.id)}
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
		}, t("已删除"));

	return (
		<div className="panel-body">
			<div className="seg-row seg-tabs">
				<button className={`seg ${tab === "skills" ? "active" : ""}`} onClick={() => setTab("skills")}>
					{t("技能")}
				</button>
				<button className={`seg ${tab === "mcp" ? "active" : ""}`} onClick={() => setTab("mcp")}>
					MCP
				</button>
			</div>

			{tab === "skills" && (
				<>
					<div className="preset-chan-head"><span className="lore-meta"><b>{t("扮演教导")}</b>{t(" · 写作/文风/场面")}</span></div>
					<SkillLibrary toast={toast} />
					<div className="preset-chan-head" style={{ marginTop: 12 }}><span className="lore-meta"><b>{t("办事笔记")}</b>{t(" · 外部服务调用")}</span></div>
					<section className="sp-section">
						<PanelStatus loading={loading} error={error} hasData={!!data} />
						{data && (
							<>
								<NewSkillForm onCreated={reload} toast={toast} />
								{list.length === 0 && <div className="sp-empty">{t("还没有办事笔记，可手动新建或导入。")}</div>}
								{list.map((s) => (
									<SkillRow key={s.file} s={s} busy={busy} onSaved={reload} onDelete={remove} toast={toast} />
								))}
							</>
						)}
					</section>
				</>
			)}

			{tab === "mcp" && <McpSection toast={toast} />}
		</div>
	);
}
