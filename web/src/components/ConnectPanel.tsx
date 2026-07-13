/**
 * 连接面板 — 三层结构
 *
 *  ① 当前生效：正在跑的模型 / 思考档（来自已启用配置）
 *  ② 配置仓库：保管生成的配置文件 — 启用 / 修改 / 删除
 *  ③ 配置生成器：只生成并存入仓库，绝不自动启用
 */

import { useEffect, useMemo, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiPost,
	apiPut,
	downloadText,
	type AgentConfigResponse,
	type CurrentModelInfo,
	type LiyuanAgentConfig,
	type ModelEntry,
	type ModelInfo,
	type ModelsResponse,
} from "../api.ts";
import { ConfirmButton, Field, PanelStatus, useAction, usePanelData } from "./kit.tsx";

const API_TYPES = [
	{ value: "openai-completions", label: "OpenAI 兼容（chat/completions）" },
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google-generative-ai", label: "Google Generative AI" },
];

const URL_HIST_KEY = "liyuan.channel.urlHistory";
const pretty = (o: unknown) => JSON.stringify(o, null, "\t");

const loadUrlHist = (): string[] => {
	try {
		const j = JSON.parse(localStorage.getItem(URL_HIST_KEY) ?? "[]") as unknown;
		return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
	} catch {
		return [];
	}
};
const pushUrlHist = (url: string) => {
	const u = url.trim();
	if (!u) return;
	localStorage.setItem(URL_HIST_KEY, JSON.stringify([u, ...loadUrlHist().filter((x) => x !== u)].slice(0, 8)));
};

// ---------- types ----------

export interface ProfileListItem {
	id: string;
	name: string;
	updatedAt: number;
	active: boolean;
	providerKeys: string[];
	modelCount: number;
	defaultProvider?: string;
	defaultModel?: string;
	hasKey: boolean;
}

interface Draft {
	/** 仓库 id / 配置名 */
	name: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	models: ModelEntry[];
	/** 编辑仓库时：原 id */
	editId: string | null;
}

function emptyDraft(): Draft {
	return {
		name: "",
		baseUrl: "",
		api: API_TYPES[0].value,
		apiKey: "",
		models: [],
		editId: null,
	};
}

/** 生成器输出：一份完整 Agent 配置（通常单渠道） */
function draftToConfig(d: Draft): LiyuanAgentConfig {
	const name = d.name.trim();
	const providers: LiyuanAgentConfig["providers"] = {};
	const models = d.models.map((m) => {
		const out: ModelEntry = { ...m, id: String(m.id) };
		const cw = out.contextWindow;
		if (typeof cw === "string") {
			try {
				out.contextWindow = parseContextWindow(cw);
			} catch {
				delete out.contextWindow;
			}
		} else if (typeof cw === "number" && (!Number.isFinite(cw) || cw < 1024)) {
			delete out.contextWindow;
		}
		return out;
	});
	if (name) {
		providers[name] = {
			baseUrl: d.baseUrl.trim(),
			api: d.api.trim() || "openai-completions",
			apiKey: d.apiKey.trim() || "placeholder",
			models,
		};
	}
	const firstThink = models.find((m) => typeof m.thinkingLevel === "string" && m.thinkingLevel.trim());
	return {
		version: 1,
		defaultProvider: name || undefined,
		defaultModel: models[0]?.id,
		defaultThinkingLevel:
			typeof firstThink?.thinkingLevel === "string" ? firstThink.thinkingLevel.trim() : undefined,
		providers,
	};
}

function draftFromConfig(id: string, name: string, config: LiyuanAgentConfig): Draft {
	const keys = Object.keys(config.providers ?? {});
	const pname = config.defaultProvider && config.providers[config.defaultProvider] ? config.defaultProvider : keys[0] ?? id;
	const p = config.providers[pname] ?? {};
	const models = Array.isArray(p.models)
		? p.models.map((m) => ({
				...m,
				id: String(m.id),
				thinkingLevel: typeof m.thinkingLevel === "string" ? m.thinkingLevel : "",
			}))
		: [];
	return {
		editId: id,
		name: pname || name,
		baseUrl: String(p.baseUrl ?? ""),
		api: String(p.api ?? "openai-completions"),
		apiKey: "", // 不回显；留空=保留
		models,
	};
}

function modelThinkingOf(cfg: LiyuanAgentConfig, provider: string, modelId: string): string {
	const p = cfg.providers?.[provider];
	const list = Array.isArray(p?.models) ? p.models : [];
	const m = list.find((x) => String(x.id) === modelId);
	return typeof m?.thinkingLevel === "string" ? m.thinkingLevel.trim() : "";
}

function modelContextOf(cfg: LiyuanAgentConfig, provider: string, modelId: string): number | undefined {
	const p = cfg.providers?.[provider];
	const list = Array.isArray(p?.models) ? p.models : [];
	const m = list.find((x) => String(x.id) === modelId);
	const n = m?.contextWindow;
	return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 解析 128000 / 500k / 1.5m 等 */
export function parseContextWindow(raw: string): number {
	const s = raw.trim().toLowerCase().replace(/,/g, "").replace(/\s/g, "");
	const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(s);
	if (!m) throw new Error("请输入数字，如 128000、500k、1m");
	let n = Number(m[1]);
	if (m[2] === "k") n *= 1000;
	if (m[2] === "m") n *= 1_000_000;
	n = Math.round(n);
	if (!Number.isFinite(n) || n < 1024) throw new Error("上下文至少 1024");
	if (n > 10_000_000) throw new Error("上下文过大（上限 10M）");
	return n;
}

const fmtCtx = (n: number) => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return String(n);
};

// ---------- widgets ----------

function StatusLine({ status }: { status: { ok: boolean; detail: string } | null }) {
	if (!status) return null;
	return <div className={`channel-status ${status.ok ? "ok" : "bad"}`}>{status.ok ? status.detail : `失败：${status.detail}`}</div>;
}

function ThinkingInput({
	value,
	hints,
	busy,
	onCommit,
}: {
	value: string;
	hints?: string[];
	busy: boolean;
	onCommit: (level: string) => void;
}) {
	const [text, setText] = useState(value);
	useEffect(() => setText(value), [value]);
	const commit = () => {
		const v = text.trim();
		if (!v || v === value) return;
		onCommit(v);
	};
	return (
		<div className="conn-thinking">
			<div className="field-label" style={{ marginBottom: 4 }}>
				思考档
			</div>
			<div className="conn-thinking-row">
				<input
					className="panel-search"
					value={text}
					disabled={busy}
					placeholder="如 off / low / high / xhigh / max"
					spellCheck={false}
					onChange={(e) => setText(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
				/>
				<button type="button" className="drawer-btn" disabled={busy || !text.trim() || text.trim() === value} onClick={commit}>
					应用
				</button>
			</div>
			<div className="field-hint">
				英文档位名，因模型而异
				{hints && hints.length > 0 ? ` · 常见：${hints.join(" / ")}` : ""}
			</div>
		</div>
	);
}

/** 当前模型上下文窗口（影响底栏占用百分比与压缩阈值） */
function ContextWindowInput({
	value,
	busy,
	onCommit,
}: {
	value: number;
	busy: boolean;
	onCommit: (n: number) => void;
}) {
	const [text, setText] = useState(value > 0 ? String(value) : "128000");
	useEffect(() => setText(value > 0 ? String(value) : "128000"), [value]);
	const commit = () => {
		try {
			const n = parseContextWindow(text);
			if (n === value) return;
			onCommit(n);
		} catch {
			// 非法输入时恢复显示
			setText(value > 0 ? String(value) : "128000");
		}
	};
	return (
		<div className="conn-thinking" style={{ marginTop: 8 }}>
			<div className="field-label" style={{ marginBottom: 4 }}>
				上下文窗口
			</div>
			<div className="conn-thinking-row">
				<input
					className="panel-search"
					value={text}
					disabled={busy}
					placeholder="如 128000 / 500k / 1m"
					spellCheck={false}
					onChange={(e) => setText(e.target.value)}
					onBlur={commit}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						}
					}}
				/>
				<button
					type="button"
					className="drawer-btn"
					disabled={busy}
					onClick={() => {
						try {
							const n = parseContextWindow(text);
							if (n !== value) onCommit(n);
						} catch {
							setText(value > 0 ? String(value) : "128000");
						}
					}}
				>
					应用
				</button>
			</div>
			<div className="field-hint">
				当前生效 {value > 0 ? fmtCtx(value) : "128k（默认）"} · 写入连接配置；中转站宣称 500k 时请填 500000 或
				500k，否则占用百分比会按 128k 虚高
			</div>
		</div>
	);
}

// ---------- panel ----------

type Mode = null | { kind: "gen" } | { kind: "edit"; id: string };

export function ConnectPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const modelsData = usePanelData(() => apiGet<ModelsResponse>("/api/models"), { cacheKey: "/api/models" });
	const agentCfg = usePanelData(() => apiGet<AgentConfigResponse>("/api/agent-config"), { cacheKey: "/api/agent-config" });
	const profilesData = usePanelData(() => apiGet<{ profiles: ProfileListItem[] }>("/api/agent-profiles"), { cacheKey: "/api/agent-profiles" });
	const { busy, run } = useAction(toast);

	const [mode, setMode] = useState<Mode>(null);
	const [draft, setDraft] = useState<Draft>(emptyDraft());
	const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);
	const [discovered, setDiscovered] = useState<string[]>([]);
	const [showAddModel, setShowAddModel] = useState(false);
	const [newModelId, setNewModelId] = useState("");

	const current = modelsData.data?.current ?? null;
	const allModels = modelsData.data?.models ?? [];
	const activeConfig: LiyuanAgentConfig = agentCfg.data?.config ?? { version: 1, providers: {} };
	const profiles = profilesData.data?.profiles ?? [];

	const reloadAll = () => {
		modelsData.reload();
		agentCfg.reload();
		profilesData.reload();
	};

	const patchDraft = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

	const closeEditor = () => {
		setMode(null);
		setDraft(emptyDraft());
		setProbe(null);
		setDiscovered([]);
		setShowAddModel(false);
		setNewModelId("");
	};

	const openGenerator = () => {
		setMode({ kind: "gen" });
		setDraft(emptyDraft());
		setProbe(null);
		setDiscovered([]);
	};

	const openEdit = (id: string) =>
		run(async () => {
			const r = await apiGet<{ id: string; name: string; config: LiyuanAgentConfig }>(
				`/api/agent-profiles/one?id=${encodeURIComponent(id)}`,
			);
			setMode({ kind: "edit", id });
			setDraft(draftFromConfig(r.id, r.name, r.config));
			setProbe(null);
			setDiscovered([]);
		});

	const selectModel = (m: ModelInfo) =>
		run(async () => {
			await apiPost<{ current: CurrentModelInfo }>("/api/models/select", { provider: m.provider, id: m.id });
			const perModel = modelThinkingOf(activeConfig, m.provider, m.id);
			if (perModel) {
				try {
					await apiPost("/api/models/thinking", { level: perModel });
				} catch (e) {
					toast("warning", `模型已切换，思考档未能应用：${e instanceof Error ? e.message : String(e)}`);
				}
			}
			const cfg = {
				...activeConfig,
				defaultProvider: m.provider,
				defaultModel: m.id,
				...(perModel ? { defaultThinkingLevel: perModel } : {}),
			};
			await apiPut("/api/agent-config", { config: cfg });
			// 若有启用中的仓库配置，同步写回仓库
			const active = profiles.find((p) => p.active);
			if (active) {
				await apiPut("/api/agent-profiles", { id: active.id, name: active.name, config: cfg });
			}
			reloadAll();
			toast("info", perModel ? `已切换：${m.name} · ${perModel}` : `已切换：${m.name}`);
		});

	const setThinking = (level: string) =>
		run(async () => {
			const lv = level.trim();
			if (!lv) throw new Error("请填写思考档");
			await apiPost("/api/models/thinking", { level: lv });
			const cfg = { ...activeConfig, defaultThinkingLevel: lv, providers: { ...activeConfig.providers } };
			if (current) {
				const p = cfg.providers[current.provider];
				if (p && Array.isArray(p.models)) {
					cfg.providers[current.provider] = {
						...p,
						models: p.models.map((m) => (String(m.id) === current.id ? { ...m, thinkingLevel: lv } : m)),
					};
				}
			}
			await apiPut("/api/agent-config", { config: cfg });
			const active = profiles.find((p) => p.active);
			if (active) await apiPut("/api/agent-profiles", { id: active.id, name: active.name, config: cfg });
			reloadAll();
		}, `思考档 ${level.trim()}`);

	/** 改当前模型 contextWindow → 写 agent 配置 + models.json，重绑会话模型 */
	const setContextWindow = (n: number) =>
		run(async () => {
			if (!current) throw new Error("尚未启用模型");
			if (!Number.isFinite(n) || n < 1024) throw new Error("上下文至少 1024");
			const cfg: LiyuanAgentConfig = {
				...activeConfig,
				providers: { ...activeConfig.providers },
			};
			const prev = cfg.providers[current.provider];
			const models = Array.isArray(prev?.models) ? [...prev.models] : [];
			const idx = models.findIndex((m) => String(m.id) === current.id);
			if (idx >= 0) {
				models[idx] = { ...models[idx], id: current.id, contextWindow: n };
			} else {
				models.push({ id: current.id, contextWindow: n });
			}
			cfg.providers[current.provider] = { ...(prev ?? {}), models };
			await apiPut("/api/agent-config", { config: cfg });
			const active = profiles.find((p) => p.active);
			if (active) await apiPut("/api/agent-profiles", { id: active.id, name: active.name, config: cfg });
			reloadAll();
		}, `上下文窗口 ${fmtCtx(n)}（${n.toLocaleString()}）`);

	const enableProfile = (id: string) =>
		run(async () => {
			await apiPost("/api/agent-profiles/enable", { id });
			reloadAll();
		}, `已启用配置「${id}」`);

	const deleteProf = (id: string) =>
		run(async () => {
			await apiDelete(`/api/agent-profiles?id=${encodeURIComponent(id)}`);
			if (mode?.kind === "edit" && mode.id === id) closeEditor();
			reloadAll();
		}, `已删除「${id}」`);

	/** 生成器：只存仓库 */
	const saveToWarehouse = () =>
		run(async () => {
			const name = draft.name.trim();
			if (!name) throw new Error("请填写配置名（渠道名）");
			if (!draft.baseUrl.trim()) throw new Error("请填写 Base URL");
			if (!draft.api.trim()) throw new Error("请选择 API 类型");
			if (!draft.apiKey.trim() && mode?.kind === "gen") throw new Error("请填写 API key");
			if (draft.models.length === 0) throw new Error("请至少添加一个模型");

			const config = draftToConfig(draft);
			// 编辑时：key 留空则从原配置保留
			if (mode?.kind === "edit" && !draft.apiKey.trim()) {
				const prev = await apiGet<{ config: LiyuanAgentConfig }>(`/api/agent-profiles/one?id=${encodeURIComponent(mode.id)}`);
				const pk = prev.config.providers[name] ?? Object.values(prev.config.providers)[0];
				if (pk && typeof pk.apiKey === "string") {
					config.providers[name] = { ...config.providers[name], apiKey: pk.apiKey };
				}
			}

			if (mode?.kind === "edit") {
				await apiPut("/api/agent-profiles", { id: mode.id, name: draft.name.trim(), config });
			} else {
				await apiPost("/api/agent-profiles", { id: name, name, config });
			}
			pushUrlHist(draft.baseUrl);
			closeEditor();
			reloadAll();
		}, mode?.kind === "edit" ? "仓库配置已更新" : "已存入配置仓库（未启用）");

	const testDraft = () =>
		run(async () => {
			if (!draft.baseUrl.trim()) throw new Error("先填 Base URL");
			const r = await apiPost<{ ok: boolean; detail: string }>("/api/channels/test", {
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim() || undefined,
			});
			setProbe(r);
		});

	const checkModels = () =>
		run(async () => {
			if (!draft.baseUrl.trim()) throw new Error("先填 Base URL");
			const r = await apiPost<{ models: string[] }>("/api/channels/fetch-models", {
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim() || undefined,
			});
			setDiscovered(r.models);
			setProbe({ ok: true, detail: `检查到 ${r.models.length} 个模型（点 ＋ 加入已选）` });
		});

	const addModelById = (id: string) => {
		const mid = id.trim();
		if (!mid) return;
		if (draft.models.some((m) => m.id === mid)) {
			toast("warning", `「${mid}」已在清单中`);
			return;
		}
		patchDraft({ models: [...draft.models, { id: mid, thinkingLevel: "" }] });
	};

	const genPreview = useMemo(() => draftToConfig(draft), [draft]);

	const activeProviders = Object.keys(activeConfig.providers ?? {});
	const modelsOfActive = (provider: string) => allModels.filter((m) => m.provider === provider);

	const renderEditor = (isGen: boolean) => (
		<div className="conn-body">
			<div className="conn-editor-bar">
				<span className="conn-editor-bar-title">{isGen ? "生成新配置" : "修改配置"}</span>
				<button type="button" className="icon-btn conn-editor-x" title="关闭" aria-label="关闭" onClick={closeEditor}>
					×
				</button>
			</div>
			<section className="conn-sec">
				<div className="conn-sec-title">接入</div>
				<Field label="配置名 / 渠道名">
					<input
						className="panel-search"
						placeholder="如 deepseek / cpa"
						value={draft.name}
						disabled={!isGen}
						onChange={(e) => patchDraft({ name: e.target.value })}
					/>
				</Field>
				<Field label="Base URL">
					<input
						className="panel-search"
						list="conn-url-hist"
						value={draft.baseUrl}
						onChange={(e) => patchDraft({ baseUrl: e.target.value })}
					/>
				</Field>
				<Field label="API 类型">
					<select className="panel-search" value={draft.api} onChange={(e) => patchDraft({ api: e.target.value })}>
						{API_TYPES.map((t) => (
							<option key={t.value} value={t.value}>
								{t.label}
							</option>
						))}
					</select>
				</Field>
				<Field label={isGen ? "API key" : "更换 API key（留空保留）"} hint="写入配置文件，不使用环境变量">
					<input
						className="panel-search"
						type="password"
						autoComplete="off"
						value={draft.apiKey}
						onChange={(e) => patchDraft({ apiKey: e.target.value })}
					/>
				</Field>
			</section>

			<section className="conn-sec">
				<div className="conn-sec-title">模型</div>
				<div className="panel-row">
					<button type="button" className="act" disabled={busy || !draft.baseUrl.trim()} onClick={() => void testDraft()}>
						测试连通
					</button>
					<button type="button" className="drawer-btn" disabled={busy || !draft.baseUrl.trim()} onClick={() => void checkModels()}>
						检查模型
					</button>
				</div>
				<StatusLine status={probe} />
				{discovered.length > 0 && (
					<div className="conn-models conn-discovered">
						<div className="conn-models-head">
							<span className="field-label">可用模型（{discovered.length}）</span>
							<span className="field-hint">点 ＋ 加入已选</span>
						</div>
						<ul className="conn-model-list">
							{discovered.map((id) => {
								const inList = draft.models.some((m) => m.id === id);
								return (
									<li key={id} className={`conn-model-row ${inList ? "in-list" : ""}`}>
										<span className="conn-model-id">{id}</span>
										{inList ? (
											<span className="conn-model-added">已加入</span>
										) : (
											<button type="button" className="conn-model-plus" onClick={() => addModelById(id)}>
												＋
											</button>
										)}
									</li>
								);
							})}
						</ul>
					</div>
				)}
				<div className="conn-models">
					<div className="conn-models-head">
						<span className="field-label">已选清单（{draft.models.length}）</span>
						<span className="field-hint">每模型：思考档 + 上下文窗口</span>
					</div>
					{draft.models.length === 0 ? (
						<div className="sp-empty">检查模型后点 ＋，或手填</div>
					) : (
						<ul className="conn-model-list">
							{draft.models.map((m) => (
								<li key={m.id} className="conn-model-row conn-model-row-full">
									<span className="conn-model-id">{m.id}</span>
									<input
										className="panel-search conn-model-thinking"
										placeholder="思考 如 high/max"
										spellCheck={false}
										value={typeof m.thinkingLevel === "string" ? m.thinkingLevel : ""}
										onChange={(e) =>
											patchDraft({
												models: draft.models.map((x) => (x.id === m.id ? { ...x, thinkingLevel: e.target.value } : x)),
											})
										}
									/>
									<input
										className="panel-search conn-model-thinking"
										placeholder="上下文 如 500k"
										spellCheck={false}
										title="模型 contextWindow；空=默认 128k"
										value={
											typeof m.contextWindow === "number" && Number.isFinite(m.contextWindow) && m.contextWindow > 0
												? String(m.contextWindow)
												: typeof m.contextWindow === "string"
													? m.contextWindow
													: ""
										}
										onChange={(e) => {
											const raw = e.target.value.trim();
											patchDraft({
												models: draft.models.map((x) => {
													if (x.id !== m.id) return x;
													if (!raw) {
														const { contextWindow: _drop, ...rest } = x as ModelEntry & { contextWindow?: unknown };
														void _drop;
														return { ...rest, id: x.id };
													}
													try {
														return { ...x, contextWindow: parseContextWindow(raw) };
													} catch {
														// 输入中：暂存字符串，保存时再规范化
														return { ...x, contextWindow: raw };
													}
												}),
											});
										}}
										onBlur={() => {
											const raw = m.contextWindow;
											if (raw === undefined || raw === "" || raw === null) return;
											if (typeof raw === "number" && raw > 0) return;
											try {
												const n = parseContextWindow(String(raw));
												patchDraft({
													models: draft.models.map((x) => (x.id === m.id ? { ...x, contextWindow: n } : x)),
												});
											} catch {
												const { contextWindow: _drop, ...rest } = m as ModelEntry & { contextWindow?: unknown };
												void _drop;
												patchDraft({
													models: draft.models.map((x) => (x.id === m.id ? { ...rest, id: x.id } : x)),
												});
												toast("warning", `「${m.id}」上下文无效，已清空（可用 500k）`);
											}
										}}
									/>
									<button
										type="button"
										className="act"
										onClick={() => patchDraft({ models: draft.models.filter((x) => x.id !== m.id) })}
									>
										移除
									</button>
								</li>
							))}
						</ul>
					)}
					{showAddModel ? (
						<div className="conn-model-add">
							<input
								className="panel-search"
								placeholder="模型 id"
								value={newModelId}
								autoFocus
								onChange={(e) => setNewModelId(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										addModelById(newModelId);
										setNewModelId("");
										setShowAddModel(false);
									}
								}}
							/>
							<button
								type="button"
								className="drawer-btn"
								onClick={() => {
									addModelById(newModelId);
									setNewModelId("");
									setShowAddModel(false);
								}}
							>
								加入
							</button>
							<button type="button" className="act" onClick={() => setShowAddModel(false)}>
								取消
							</button>
						</div>
					) : (
						<button type="button" className="conn-plus-btn" onClick={() => setShowAddModel(true)}>
							＋
						</button>
					)}
				</div>
			</section>

			<section className="conn-sec">
				<div className="conn-sec-title">{isGen ? "生成预览（仅仓库）" : "配置内容"}</div>
				<textarea className="panel-search ta conn-json conn-json-full" rows={10} spellCheck={false} readOnly value={pretty(genPreview)} />
			</section>

			<div className="panel-row">
				<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={() => void saveToWarehouse()}>
					{isGen ? "存入配置仓库" : "保存修改"}
				</button>
				{isGen && (
					<button type="button" className="act" onClick={() => downloadText(`${draft.name.trim() || "profile"}.json`, pretty(genPreview))}>
						导出
					</button>
				)}
			</div>
		</div>
	);

	return (
		<div className="panel-body conn-panel">
			{/* ① 当前生效：模型 + 思考 + 切换列表（唯一选型入口） */}
			<section className="sp-section conn-block">
				<div className="conn-section-label">当前生效</div>
				<PanelStatus loading={modelsData.loading} error={modelsData.error} hasData={!!modelsData.data} />
				{current ? (
					<>
						<div className="connect-current">
							<span className="auth-dot ok" />
							<div className="connect-current-info">
								<div className="model-current">{current.name}</div>
								<div className="field-hint">
									{current.provider} · 窗口{" "}
									{current.contextWindow > 0 ? fmtCtx(current.contextWindow) : "128k 默认"}
								</div>
							</div>
						</div>
						<ThinkingInput value={current.thinkingLevel} hints={current.availableLevels} busy={busy} onCommit={(lv) => void setThinking(lv)} />
						<ContextWindowInput
							value={current.contextWindow > 0 ? current.contextWindow : 128000}
							busy={busy}
							onCommit={(n) => void setContextWindow(n)}
						/>
						{activeProviders.length > 0 && (
							<ul className="conn-pick-list" style={{ marginTop: 10 }}>
								{activeProviders.flatMap((pk) =>
									modelsOfActive(pk).map((m) => {
										const on = current.provider === m.provider && current.id === m.id;
										const think = modelThinkingOf(activeConfig, m.provider, m.id);
										const ctx = modelContextOf(activeConfig, m.provider, m.id) ?? m.contextWindow;
										return (
											<li key={`${m.provider}/${m.id}`}>
												<button
													type="button"
													className={`conn-pick-model ${on ? "on" : ""}`}
													disabled={busy || on}
													onClick={() => void selectModel(m)}
												>
													<span className="conn-pick-name">{m.name}</span>
													<span className="conn-pick-meta">
														{on && <span className="chip chip-cap">使用中</span>}
														{think ? <span className="chip chip-cap">{think}</span> : null}
														{ctx > 0 ? <span className="chip chip-cap">{fmtCtx(ctx)}</span> : null}
													</span>
												</button>
											</li>
										);
									}),
								)}
							</ul>
						)}
					</>
				) : (
					!modelsData.loading && <div className="sp-empty">尚未启用配置 — 在仓库中启用</div>
				)}
			</section>

			{/* ② 配置仓库：名 + 右侧 启用/修改/删除；点击行展开修改 */}
			<section className="sp-section conn-block">
				<div className="conn-section-label">配置仓库</div>
				<PanelStatus loading={profilesData.loading} error={profilesData.error} hasData={!!profilesData.data} />
				{profiles.length === 0 && <div className="sp-empty">仓库为空 — 用下方生成器创建</div>}
				{profiles.map((p) => {
					const editing = mode?.kind === "edit" && mode.id === p.id;
					return (
						<div key={p.id} className={`conn-card ${p.active ? "ready conn-current-ch" : ""} ${editing ? "selected" : ""}`}>
							<div className="conn-wh-row">
								<button
									type="button"
									className="conn-wh-main"
									onClick={() => {
										if (editing) closeEditor();
										else void openEdit(p.id);
									}}
								>
									<span className={`group-caret ${editing ? "open" : ""}`}>▸</span>
									<span className={`auth-dot ${p.active ? "ok" : ""}`} />
									<span className="conn-wh-name">{p.name}</span>
									{p.active && <span className="chip chip-cap">启用中</span>}
								</button>
								<span className="conn-wh-acts" onClick={(e) => e.stopPropagation()}>
									{!p.active && (
										<button type="button" className="act" disabled={busy} onClick={() => void enableProfile(p.id)}>
											启用
										</button>
									)}
									<button
										type="button"
										className="act"
										disabled={busy}
										onClick={() => {
											if (editing) closeEditor();
											else void openEdit(p.id);
										}}
									>
										修改
									</button>
									<ConfirmButton className="act" disabled={busy} confirmText="确认删除" onConfirm={() => void deleteProf(p.id)}>
										删除
									</ConfirmButton>
								</span>
							</div>
							{editing && <div className="conn-expand">{renderEditor(false)}</div>}
						</div>
					);
				})}
			</section>

			{/* ③ 配置生成器：只生成进仓库 */}
			<section className="sp-section conn-block">
				<div className="conn-section-label">配置生成器</div>
				{mode?.kind === "gen" ? (
					<div className="conn-card selected add-channel">
						<div className="conn-expand">{renderEditor(true)}</div>
					</div>
				) : (
					<button type="button" className="drawer-btn conn-add-btn" onClick={openGenerator}>
						＋ 生成配置
					</button>
				)}
			</section>

			<datalist id="conn-url-hist">
				{loadUrlHist().map((u) => (
					<option key={u} value={u} />
				))}
			</datalist>
		</div>
	);
}
