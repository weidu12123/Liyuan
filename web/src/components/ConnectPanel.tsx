/**
 * 连接面板 — 三层结构
 *
 *  ① 当前生效：正在跑的模型 / 思考档（来自已启用配置）
 *  ② 配置仓库：保管生成的配置文件 — 启用 / 刷新 / 修改 / 删除
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
	type ModelsResponse,
	type RpConfigView,
} from "../api.ts";
import { ConfirmButton, Field, PanelStatus, useAction, usePanelData } from "./kit.tsx";
import { t } from "../i18n/index.ts";

const API_TYPES = [
	{ value: "openai-completions", label: "OpenAI 兼容（chat/completions）" }, // i18n-ignore：用时 t(label)
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
	/** 流式传输（默认 true；部分中转/反代流式异常时可关闭） */
	streaming: boolean;
	/** 原 compat 里流式开关以外的字段（面板不管，保存时原样带回） */
	compatRest: Record<string, unknown>;
	/** provider 上表单不编辑的其它字段（headers/User-Agent 等），保存时原样带回 */
	providerExtra: Record<string, unknown>;
}

function emptyDraft(): Draft {
	return {
		name: "",
		baseUrl: "",
		api: API_TYPES[0].value,
		apiKey: "",
		models: [],
		editId: null,
		streaming: true,
		compatRest: {},
		providerExtra: {},
	};
}

/** 规范化模型条目上的 contextWindow / maxTokens（字符串→数字；非法则去掉） */
function normalizeModelNumericFields(m: ModelEntry): ModelEntry {
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
	const mt = out.maxTokens;
	if (mt === undefined || mt === null || mt === "") {
		delete out.maxTokens;
	} else if (typeof mt === "string") {
		try {
			out.maxTokens = parseMaxTokens(mt);
		} catch {
			delete out.maxTokens;
		}
	} else if (typeof mt === "number" && (!Number.isFinite(mt) || mt < 1)) {
		delete out.maxTokens;
	}
	return out;
}

/** 生成器输出：一份完整 Agent 配置（通常单渠道） */
function draftToConfig(d: Draft): LiyuanAgentConfig {
	const name = d.name.trim();
	const providers: LiyuanAgentConfig["providers"] = {};
	const models = d.models.map((m) => normalizeModelNumericFields(m));
	if (name) {
		const compat: Record<string, unknown> = { ...d.compatRest };
		delete compat.safetyThreshold; // 已废弃：第三方反代传不到官方 safetySettings，一律不再下发
		if (d.streaming) {
			delete compat.streaming;
		} else {
			compat.streaming = false;
		}

		providers[name] = {
			baseUrl: d.baseUrl.trim(),
			api: d.api.trim() || "openai-completions",
			apiKey: d.apiKey.trim() || "placeholder",
			models,
			...(Object.keys(d.providerExtra).length > 0 && d.providerExtra),
			...(Object.keys(compat).length > 0 && { compat }),
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
	const compat = (p as Record<string, unknown>).compat as Record<string, unknown> | undefined;
	const compatRest = { ...compat };
	delete compatRest.streaming;
	delete compatRest.safetyThreshold;
	// provider 上除表单字段外的其余字段（headers 等）原样带回，避免「改一处顺手吞掉别的配置」
	const providerExtra: Record<string, unknown> = { ...(p as Record<string, unknown>) };
	delete providerExtra.baseUrl;
	delete providerExtra.api;
	delete providerExtra.apiKey;
	delete providerExtra.models;
	delete providerExtra.compat;
	return {
		editId: id,
		name: pname || name,
		baseUrl: String(p.baseUrl ?? ""),
		api: String(p.api ?? "openai-completions"),
		apiKey: "", // 不回显；留空=保留
		models,
		streaming: compat?.streaming !== false,
		compatRest,
		providerExtra,
	};
}

/**
 * 条目身份：用户起的名，没起就用 id。与 src/agent-config.ts 的 modelEntryKey 是同一条约定。
 * **别再按 id 找条目**——同一个模型可以有多条条目（如「flash high」与「flash off」）。
 */
function entryKeyOf(m: ModelEntry): string {
	const label = typeof m.label === "string" ? m.label.trim() : "";
	return label || String(m.id);
}

/* 按 model id 查条目的那三个 helper 已删：同一个 id 可以有多条条目，按 id 查恒命中第一条
 * ——「选了 flash off 却显示 flash low 的档」就是它们干的。查条目一律走 entryKeyOf / currentEntryIndex。 */

/** 解析 token 数字：128000 / 500k / 1.5m / 16k */
function parseTokenCount(raw: string, kind: "context" | "maxOut"): number {
	const s = raw.trim().toLowerCase().replace(/,/g, "").replace(/\s/g, "");
	const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(s);
	if (!m) throw new Error(kind === "context" ? t("请输入数字，如 128000、500k、1m") : t("请输入数字，如 8192、16k、32k"));
	let n = Number(m[1]);
	if (m[2] === "k") n *= 1000;
	if (m[2] === "m") n *= 1_000_000;
	n = Math.round(n);
	if (!Number.isFinite(n)) throw new Error(t("无效数字"));
	if (kind === "context") {
		if (n < 1024) throw new Error(t("上下文至少 1024"));
		if (n > 10_000_000) throw new Error(t("上下文过大（上限 10M）"));
	} else {
		if (n < 256) throw new Error(t("最大回复至少 256"));
		if (n > 2_000_000) throw new Error(t("最大回复过大（上限 2M）"));
	}
	return n;
}

/** 解析 128000 / 500k / 1.5m 等 */
export function parseContextWindow(raw: string): number {
	return parseTokenCount(raw, "context");
}

/** 解析单次最大输出 tokens */
export function parseMaxTokens(raw: string): number {
	return parseTokenCount(raw, "maxOut");
}

const fmtCtx = (n: number) => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return String(n);
};

// ---------- widgets ----------

function StatusLine({ status }: { status: { ok: boolean; detail: string } | null }) {
	if (!status) return null;
	return <div className={`channel-status ${status.ok ? "ok" : "bad"}`}>{status.ok ? status.detail : t("失败：{detail}", { detail: status.detail })}</div>;
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
				{t("思考档")}
			</div>
			<div className="conn-thinking-row">
				<input
					className="panel-search"
					value={text}
					disabled={busy}
					placeholder={t("如 off / low / high / xhigh / max")}
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
					{t("应用")}
				</button>
			</div>
			<div className="field-hint">
				{t("英文档位名，因模型而异")}
				{hints && hints.length > 0 ? t(" · 常见：{hints}", { hints: hints.join(" / ") }) : ""}
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
				{t("上下文窗口")}
			</div>
			<div className="conn-thinking-row">
				<input
					className="panel-search"
					value={text}
					disabled={busy}
					placeholder={t("如 128000 / 500k / 1m")}
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
					{t("应用")}
				</button>
			</div>
		</div>
	);
}

/** 当前模型单次最大输出 tokens（写入连接配置 → models.json） */
function MaxTokensInput({
	value,
	busy,
	onCommit,
}: {
	/** 0 / 未配置：显示空，保存前可填；应用时用 parse */
	value: number;
	busy: boolean;
	onCommit: (n: number) => void;
}) {
	const [text, setText] = useState(value > 0 ? String(value) : "");
	useEffect(() => setText(value > 0 ? String(value) : ""), [value]);
	const commit = () => {
		const raw = text.trim();
		if (!raw) return;
		try {
			const n = parseMaxTokens(raw);
			if (n === value) return;
			onCommit(n);
		} catch {
			setText(value > 0 ? String(value) : "");
		}
	};
	return (
		<div className="conn-thinking" style={{ marginTop: 8 }}>
			<div className="field-label" style={{ marginBottom: 4 }}>
				{t("最大回复 tokens")}
			</div>
			<div className="conn-thinking-row">
				<input
					className="panel-search"
					value={text}
					disabled={busy}
					placeholder={t("如 8192 / 16k / 32k（空=运行时默认 16k）")}
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
				<button type="button" className="drawer-btn" disabled={busy || !text.trim()} onClick={commit}>
					{t("应用")}
				</button>
			</div>
			<div className="field-hint">
				{t("单次模型输出上限（不是上下文总窗口）")}
				{value > 0 ? t(" · 当前 {v}", { v: fmtCtx(value) }) : t(" · 未配置时 pi 默认 16384")}
			</div>
		</div>
	);
}

// ---------- panel ----------

/** 当前模型流式传输开关（写 provider.compat.streaming；关=改走非流式接口） */
function StreamingInput({
	value,
	busy,
	onCommit,
}: {
	value: boolean;
	busy: boolean;
	onCommit: (on: boolean) => void;
}) {
	return (
		<label
			className="conn-thinking"
			style={{
				marginTop: 8,
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: 8,
				cursor: "pointer",
			}}
		>
			<span className="field-label">{t("流式传输")}</span>
			<input type="checkbox" checked={value} disabled={busy} onChange={(e) => onCommit(e.target.checked)} />
		</label>
	);
}

type Mode = null | { kind: "gen" } | { kind: "edit"; id: string };

export function ConnectPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const modelsData = usePanelData(() => apiGet<ModelsResponse>("/api/models"), { cacheKey: "/api/models" });
	const agentCfg = usePanelData(() => apiGet<AgentConfigResponse>("/api/agent-config"), { cacheKey: "/api/agent-config" });
	const profilesData = usePanelData(() => apiGet<{ profiles: ProfileListItem[] }>("/api/agent-profiles"), { cacheKey: "/api/agent-profiles" });
	/** 旁路模型指向哪条条目，住在 liyuan.config.json（与其它面板共用同一份缓存） */
	const rpConfig = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config" });
	const { busy, run } = useAction(toast);

	const [mode, setMode] = useState<Mode>(null);
	const [draft, setDraft] = useState<Draft>(emptyDraft());
	const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);
	const [discovered, setDiscovered] = useState<string[]>([]);
	const [showAddModel, setShowAddModel] = useState(false);
	const [newModelId, setNewModelId] = useState("");
	/** 配置 JSON 预览：非 null 时表示用户在改 textarea，保存前需先应用或与 draft 合并 */
	const [jsonOverride, setJsonOverride] = useState<string | null>(null);

	const current = modelsData.data?.current ?? null;
	const allModels = modelsData.data?.models ?? [];
	const activeConfig: LiyuanAgentConfig = agentCfg.data?.config ?? { version: 1, providers: {} };
	const profiles = profilesData.data?.profiles ?? [];
	/** null = 旁路跟随剧情模型 */
	const sideEntry = rpConfig.data?.config?.sideModel ?? null;
	/** 剧情模型指向哪条条目；旧配置没有这个字段，那时只能按 id 认 */
	const storyKey = typeof activeConfig.defaultModelEntry === "string" ? activeConfig.defaultModelEntry.trim() : "";
	/**
	 * 「当前生效」那一栏改的是**当前这一条条目**，不是「所有同 id 的条目」。
	 * storyKey 指得明就按它，指不明（旧配置还没点过条目）才退回第一条同 id 的
	 * ——与清单上「剧情」标、以及 models.json 的收敛口径同一个规矩。
	 */
	const currentEntryIndex = (models: ModelEntry[]): number => {
		if (!current) return -1;
		if (storyKey) {
			const i = models.findIndex((m) => entryKeyOf(m) === storyKey);
			if (i >= 0) return i;
		}
		return models.findIndex((m) => String(m.id) === current.id);
	};

	/**
	 * 当前生效的那条条目。三个「当前生效」输入框（思考档/上下文/最大回复）都读它——
	 * 按 id 找会命中同 id 的第一条，于是选了 flash off 却显示 flash low 的档。
	 */
	const currentEntry = (() => {
		if (!current) return undefined;
		const models = activeConfig.providers?.[current.provider]?.models;
		if (!Array.isArray(models)) return undefined;
		const i = currentEntryIndex(models);
		return i >= 0 ? models[i] : undefined;
	})();
	const numOf = (v: unknown): number | undefined =>
		typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;

	/** 当前生效展示：优先配置文件（模型条目 > default），再回退会话，避免「配置 high、顶栏仍 off」 */
	const liveThinking = (() => {
		if (!current) return "";
		const fromModel = typeof currentEntry?.thinkingLevel === "string" ? currentEntry.thinkingLevel.trim() : "";
		if (fromModel) return fromModel;
		const def =
			typeof activeConfig.defaultThinkingLevel === "string" ? activeConfig.defaultThinkingLevel.trim() : "";
		if (def) return def;
		return current.thinkingLevel || "";
	})();
	const liveContext =
		(current
			? numOf(currentEntry?.contextWindow) ?? (current.contextWindow > 0 ? current.contextWindow : undefined)
			: undefined) ?? 128000;
	const liveMaxTokens =
		(current
			? numOf(currentEntry?.maxTokens) ??
				(typeof current.maxTokens === "number" && current.maxTokens > 0 ? current.maxTokens : undefined)
			: undefined) ?? 0;
	const liveStreaming =
		current
			? (() => {
					const p = activeConfig.providers?.[current.provider] as Record<string, unknown> | undefined;
					const compat = p?.compat as Record<string, unknown> | undefined;
					return compat?.streaming !== false;
				})()
			: true;

	const reloadAll = () => {
		modelsData.reload();
		agentCfg.reload();
		profilesData.reload();
	};

	const patchDraft = (p: Partial<Draft>) => {
		setJsonOverride(null);
		setDraft((d) => ({ ...d, ...p }));
	};

	const closeEditor = () => {
		setMode(null);
		setDraft(emptyDraft());
		setProbe(null);
		setDiscovered([]);
		setShowAddModel(false);
		setNewModelId("");
		setJsonOverride(null);
	};

	const openGenerator = () => {
		setMode({ kind: "gen" });
		setDraft(emptyDraft());
		setProbe(null);
		setDiscovered([]);
		setJsonOverride(null);
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
			setJsonOverride(null);
		});

	/**
	 * 选一条条目当剧情模型：切模型 + 应用**这条条目**的思考档。
	 * 入参是条目而不是 registry 模型——同一个模型可以有多条条目，只给 id 说不准是哪条的档。
	 */
	const selectModelEntry = (provider: string, entry: ModelEntry) =>
		run(async () => {
			const key = entryKeyOf(entry);
			await apiPost<{ current: CurrentModelInfo }>("/api/models/select", { provider, id: entry.id });
			const perModel = typeof entry.thinkingLevel === "string" ? entry.thinkingLevel.trim() : "";
			if (perModel) {
				try {
					await apiPost("/api/models/thinking", { level: perModel });
				} catch (e) {
					toast("warning", t("模型已切换，思考档未能应用：{err}", { err: e instanceof Error ? e.message : String(e) }));
				}
			}
			const cfg = {
				...activeConfig,
				defaultProvider: provider,
				defaultModel: entry.id,
				// 记「哪条条目」：defaultModel 必须留 id（它会投影进 settings.json 给运行时用）
				defaultModelEntry: key,
				...(perModel ? { defaultThinkingLevel: perModel } : {}),
			};
			await apiPut("/api/agent-config", { config: cfg });
			// 若有启用中的仓库配置，同步写回仓库
			const active = profiles.find((p) => p.active);
			if (active) {
				await apiPut("/api/agent-profiles", { id: active.id, name: active.name, config: cfg });
			}
			reloadAll();
			toast("info", perModel ? t("已切换：{key} · {level}", { key, level: perModel }) : t("已切换：{key}", { key }));
		});

	/**
	 * 指定/取消旁路条目（记账与压缩走它）。null = 跟随剧情模型。
	 * 只存「哪条条目」，档跟着条目走——这里不另给一个档位选择器。
	 */
	const setSideEntry = (sel: { provider: string; entry: string } | null) =>
		run(async () => {
			await apiPut("/api/config", { sideModel: sel });
			rpConfig.reload();
		}, sel ? t("旁路：{entry}", { entry: sel.entry }) : t("旁路：跟随剧情模型"));

	const setThinking = (level: string) =>
		run(async () => {
			const lv = level.trim();
			if (!lv) throw new Error(t("请填写思考档"));
			await apiPost("/api/models/thinking", { level: lv });
			const cfg = { ...activeConfig, defaultThinkingLevel: lv, providers: { ...activeConfig.providers } };
			if (current) {
				const p = cfg.providers[current.provider];
				if (p && Array.isArray(p.models)) {
					// 只改当前这一条：同 id 还有别的条目（各配各的档），不能一改改一片
					const idx = currentEntryIndex(p.models);
					cfg.providers[current.provider] = {
						...p,
						models: p.models.map((m, k) => (k === idx ? { ...m, thinkingLevel: lv } : m)),
					};
				}
			}
			await apiPut("/api/agent-config", { config: cfg });
			const active = profiles.find((p) => p.active);
			if (active) await apiPut("/api/agent-profiles", { id: active.id, name: active.name, config: cfg });
			reloadAll();
		}, t("思考档 {level}", { level: level.trim() }));

	/** 改当前模型 contextWindow → 写 agent 配置 + models.json，重绑会话模型 */
	const setContextWindow = (n: number) =>
		run(async () => {
			if (!current) throw new Error(t("尚未启用模型"));
			if (!Number.isFinite(n) || n < 1024) throw new Error(t("上下文至少 1024"));
			const cfg: LiyuanAgentConfig = {
				...activeConfig,
				providers: { ...activeConfig.providers },
			};
			const prev = cfg.providers[current.provider];
			const models = Array.isArray(prev?.models) ? [...prev.models] : [];
			const idx = currentEntryIndex(models);
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
		}, t("上下文窗口 {short}（{full}）", { short: fmtCtx(n), full: n.toLocaleString() }));

	/** 改当前模型 maxTokens（单次最大输出） */
	const setMaxTokens = (n: number) =>
		run(async () => {
			if (!current) throw new Error(t("尚未启用模型"));
			if (!Number.isFinite(n) || n < 256) throw new Error(t("最大回复至少 256"));
			const cfg: LiyuanAgentConfig = {
				...activeConfig,
				providers: { ...activeConfig.providers },
			};
			const prev = cfg.providers[current.provider];
			const models = Array.isArray(prev?.models) ? [...prev.models] : [];
			const idx = currentEntryIndex(models);
			if (idx >= 0) {
				models[idx] = { ...models[idx], id: current.id, maxTokens: n };
			} else {
				models.push({ id: current.id, maxTokens: n });
			}
			cfg.providers[current.provider] = { ...(prev ?? {}), models };
			await apiPut("/api/agent-config", { config: cfg });
			const active = profiles.find((p) => p.active);
			if (active) await apiPut("/api/agent-profiles", { id: active.id, name: active.name, config: cfg });
			reloadAll();
		}, t("最大回复 {short}（{full} tokens）", { short: fmtCtx(n), full: n.toLocaleString() }));

	/** 改当前模型流式传输 → 写 agent 配置（provider.compat.streaming），重绑会话模型 */
	const setStreaming = (on: boolean) =>
		run(async () => {
			if (!current) throw new Error(t("尚未启用模型"));
			const cfg: LiyuanAgentConfig = {
				...activeConfig,
				providers: { ...activeConfig.providers },
			};
			const prev = cfg.providers[current.provider];
			const compat = { ...((prev?.compat as Record<string, unknown> | undefined) ?? {}) };
			if (on) {
				delete compat.streaming; // 默认开：不写即生效
			} else {
				compat.streaming = false;
			}
			cfg.providers[current.provider] = { ...(prev ?? {}), compat };
			await apiPut("/api/agent-config", { config: cfg });
			const active = profiles.find((p) => p.active);
			if (active) await apiPut("/api/agent-profiles", { id: active.id, name: active.name, config: cfg });
			reloadAll();
		}, on ? t("已开启流式传输") : t("已关闭流式传输（该中转将改用非流式接口）"));

	const enableProfile = (id: string) =>
		run(async () => {
			await apiPost("/api/agent-profiles/enable", { id });
			reloadAll();
		}, t("已启用配置「{id}」", { id }));

	/** 启用中的配置：从仓库重读 → agent.json → models.json → 重绑（改完不必再点启用） */
	const refreshProfile = (id: string) =>
		run(async () => {
			await apiPost("/api/agent-profiles/refresh", { id });
			reloadAll();
		}, t("已刷新「{id}」并重传到运行时", { id }));

	const deleteProf = (id: string) =>
		run(async () => {
			await apiDelete(`/api/agent-profiles?id=${encodeURIComponent(id)}`);
			if (mode?.kind === "edit" && mode.id === id) closeEditor();
			reloadAll();
		}, t("已删除「{id}」", { id }));

	/** 解析配置 JSON → draft（不抛到 UI 外时由调用方 toast） */
	const parseConfigToDraft = (text: string): { config: LiyuanAgentConfig; draft: Draft } => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			throw new Error(t("JSON 无法解析：{err}", { err: e instanceof Error ? e.message : String(e) }));
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(t("配置须为 JSON 对象"));
		}
		const raw = parsed as LiyuanAgentConfig;
		const config: LiyuanAgentConfig = {
			...raw,
			version: 1,
			providers: raw.providers && typeof raw.providers === "object" && !Array.isArray(raw.providers) ? raw.providers : {},
		};
		const id = mode?.kind === "edit" ? mode.id : draft.name.trim() || "profile";
		const next = draftFromConfig(id, draft.name.trim() || id, config);
		if (mode?.kind === "gen") {
			const pk = config.providers[next.name] ?? Object.values(config.providers)[0];
			if (pk && typeof pk.apiKey === "string" && pk.apiKey && pk.apiKey !== "placeholder") {
				next.apiKey = pk.apiKey;
			}
		}
		return { config, draft: next };
	};

	const applyJsonPreview = () => {
		if (jsonOverride === null) {
			toast("info", t("预览与表单已一致"));
			return;
		}
		try {
			const { draft: next } = parseConfigToDraft(jsonOverride);
			setDraft(next);
			setJsonOverride(null);
			toast("info", t("已从 JSON 写回表单"));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	/** 生成器：只存仓库 */
	const saveToWarehouse = () =>
		run(async () => {
			let working = draft;
			if (jsonOverride !== null) {
				const parsed = parseConfigToDraft(jsonOverride);
				working = parsed.draft;
				setDraft(working);
				setJsonOverride(null);
			}

			const name = working.name.trim();
			if (!name) throw new Error(t("请填写配置名（渠道名）"));
			if (!working.baseUrl.trim()) throw new Error(t("请填写 Base URL"));
			if (!working.api.trim()) throw new Error(t("请选择 API 类型"));
			if (!working.apiKey.trim() && mode?.kind === "gen") throw new Error(t("请填写 API key"));
			if (working.models.length === 0) throw new Error(t("请至少添加一个模型"));

			const config = draftToConfig(working);
			// 编辑时：key 留空则从原配置保留
			if (mode?.kind === "edit" && !working.apiKey.trim()) {
				const prev = await apiGet<{ config: LiyuanAgentConfig }>(`/api/agent-profiles/one?id=${encodeURIComponent(mode.id)}`);
				const pk = prev.config.providers[name] ?? Object.values(prev.config.providers)[0];
				if (pk && typeof pk.apiKey === "string") {
					config.providers[name] = { ...config.providers[name], apiKey: pk.apiKey };
				}
			}

			if (mode?.kind === "edit") {
				await apiPut("/api/agent-profiles", { id: mode.id, name: working.name.trim(), config });
			} else {
				await apiPost("/api/agent-profiles", { id: name, name, config });
			}
			pushUrlHist(working.baseUrl);
			closeEditor();
			reloadAll();
		}, mode?.kind === "edit" ? t("仓库配置已更新") : t("已存入配置仓库（未启用）"));

	const testDraft = () =>
		run(async () => {
			if (!draft.baseUrl.trim()) throw new Error(t("先填 Base URL"));
			const r = await apiPost<{ ok: boolean; detail: string }>("/api/channels/test", {
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim() || undefined,
			});
			setProbe(r);
		});

	const checkModels = () =>
		run(async () => {
			if (!draft.baseUrl.trim()) throw new Error(t("先填 Base URL"));
			const r = await apiPost<{ models: string[] }>("/api/channels/fetch-models", {
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim() || undefined,
			});
			setDiscovered(r.models);
			setProbe({ ok: true, detail: t("检查到 {n} 个模型（点 ＋ 加入已选）", { n: r.models.length }) });
		});

	/**
	 * 加一条模型条目。**同一个模型可以加多条**——那正是「一个模型配几个思考档」的做法
	 * （如「flash high」与「flash off」）。重名时自动起一个能区分的条目名，用户可以再改成
	 * 看得懂的；不起名的话两条长得一模一样，之后指哪条都说不清。
	 */
	const addModelById = (id: string) => {
		const mid = id.trim();
		if (!mid) return;
		const used = new Set(draft.models.map((m) => entryKeyOf(m)));
		const entry: ModelEntry = { id: mid, thinkingLevel: "" };
		if (used.has(mid)) {
			let n = 2;
			while (used.has(`${mid} #${n}`)) n++;
			entry.label = `${mid} #${n}`;
		}
		patchDraft({ models: [...draft.models, entry] });
	};

	/** 改第 i 条条目。**按下标不按 id**——同 id 有多条，按 id 改会一改改一片 */
	const patchModelAt = (i: number, fn: (m: ModelEntry) => ModelEntry) =>
		patchDraft({ models: draft.models.map((x, k) => (k === i ? fn(x) : x)) });
	const removeModelAt = (i: number) => patchDraft({ models: draft.models.filter((_, k) => k !== i) });
	/**
	 * 条目名撞车的那些键。条目身份就是这个键，两条同键就没法指认「是哪条」——
	 * 但**不替用户改名**：把撞了的标出来，让他自己决定谁叫什么。
	 */
	const dupEntryKeys = (() => {
		const seen = new Map<string, number>();
		for (const m of draft.models) seen.set(entryKeyOf(m), (seen.get(entryKeyOf(m)) ?? 0) + 1);
		return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
	})();

	const genPreview = useMemo(() => draftToConfig(draft), [draft]);

	const activeProviders = Object.keys(activeConfig.providers ?? {});
	/**
	 * 该渠道下的模型**条目**（一个模型可以有多条）。清单以条目为单位——
	 * registry 那份模型清单是按 id 收敛过的（models.json 一个 id 只能是一个模型），
	 * 拿它当清单会把「flash high / flash off」显示成同一行。
	 */
	const entriesOfActive = (provider: string): ModelEntry[] => {
		const list = activeConfig.providers?.[provider]?.models;
		return Array.isArray(list) ? list : [];
	};
	/**
	 * 运行时真有的模型。条目清单直接来自配置，id 写错了照样显示——
	 * 拿这个集合把「运行时没有这个模型」当场标出来，别等用户点下去收一个看不懂的错。
	 */
	const knownModelIds = new Set(allModels.map((m) => `${m.provider}/${m.id}`));

	const renderEditor = (isGen: boolean) => (
		<div className="conn-body">
			<div className="conn-editor-bar">
				<span className="conn-editor-bar-title">{isGen ? t("生成新配置") : t("修改配置")}</span>
				<button type="button" className="icon-btn conn-editor-x" title={t("关闭")} aria-label={t("关闭")} onClick={closeEditor}>
					×
				</button>
			</div>
			<section className="conn-sec">
				<div className="conn-sec-title">{t("接入")}</div>
				<Field label={t("配置名 / 渠道名")}>
					<input
						className="panel-search"
						placeholder={t("如 deepseek / cpa")}
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
				<Field label={t("API 类型")}>
					<select className="panel-search" value={draft.api} onChange={(e) => patchDraft({ api: e.target.value })}>
						{API_TYPES.map((at) => (
							<option key={at.value} value={at.value}>
								{t(at.label)}
							</option>
						))}
					</select>
				</Field>
				<Field label={isGen ? "API key" : t("更换 API key（留空保留）")} hint={t("写入配置文件，不使用环境变量")}>
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
				<div className="conn-sec-title">{t("模型")}</div>
				<div className="panel-row">
					<button type="button" className="act" disabled={busy || !draft.baseUrl.trim()} onClick={() => void testDraft()}>
						{t("测试连通")}
					</button>
					<button type="button" className="drawer-btn" disabled={busy || !draft.baseUrl.trim()} onClick={() => void checkModels()}>
						{t("检查模型")}
					</button>
				</div>
				<StatusLine status={probe} />
				{discovered.length > 0 && (
					<div className="conn-models conn-discovered">
						<div className="conn-models-head">
							<span className="field-label">{t("可用模型（{n}）", { n: discovered.length })}</span>
							<span className="field-hint">{t("点 ＋ 加入已选；同一个模型可以加多条（各配一个思考档）")}</span>
						</div>
						<ul className="conn-model-list">
							{discovered.map((id) => {
								// 「已加入」只是告知，**不再顶掉 ＋**：同一个模型要配几个思考档就加几条
								const n = draft.models.filter((m) => m.id === id).length;
								return (
									<li key={id} className={`conn-model-row ${n > 0 ? "in-list" : ""}`}>
										<span className="conn-model-id">{id}</span>
										{n > 0 && <span className="conn-model-added">{t("已加入 {n} 条", { n })}</span>}
										<button type="button" className="conn-model-plus" onClick={() => addModelById(id)}>
											＋
										</button>
									</li>
								);
							})}
						</ul>
					</div>
				)}
				<div className="conn-models">
					<div className="conn-models-head">
						<span className="field-label">{t("已选清单（{n}）", { n: draft.models.length })}</span>
						<span className="field-hint">{t("每个模型单独设置思考档、上下文窗口与最大回复")}</span>
					</div>
					{draft.models.length === 0 ? (
						<div className="sp-empty">{t("检查模型后点 ＋，或手填")}</div>
					) : (
						<ul className="conn-model-list">
							{draft.models.map((m, i) => (
								<li key={i} className="conn-model-card">
									<div className="conn-model-card-head">
										<span className="conn-model-id" title={m.id}>
											{m.id}
										</span>
										{dupEntryKeys.has(entryKeyOf(m)) && (
											<span className="chip chip-cap" title={t("两条条目名字一样，指定旁路/剧情时分不出是哪条——改一个")}>
												{t("条目名重复")}
											</span>
										)}
										<button type="button" className="act" onClick={() => removeModelAt(i)}>
											{t("移除")}
										</button>
									</div>
									<div className="conn-model-fields">
										<label className="conn-model-field">
											<span className="conn-model-field-label">{t("条目名")}</span>
											<input
												className="panel-search"
												placeholder={t("同一模型加多条时用来区分，如 flash off")}
												spellCheck={false}
												title={t("这条条目的名字；留空 = 用模型 id。指定旁路模型时按这个名字认")}
												value={typeof m.label === "string" ? m.label : ""}
												onChange={(e) =>
													patchModelAt(i, (x) => {
														const v = e.target.value;
														if (!v.trim()) {
															const { label: _drop, ...rest } = x as ModelEntry & { label?: unknown };
															void _drop;
															return { ...rest, id: x.id };
														}
														return { ...x, label: v };
													})
												}
											/>
										</label>
										<label className="conn-model-field">
											<span className="conn-model-field-label">{t("思考档")}</span>
											<input
												className="panel-search"
												placeholder={t("如 high / max / off")}
												spellCheck={false}
												value={typeof m.thinkingLevel === "string" ? m.thinkingLevel : ""}
												onChange={(e) => patchModelAt(i, (x) => ({ ...x, thinkingLevel: e.target.value }))}
											/>
										</label>
										<label className="conn-model-field">
											<span className="conn-model-field-label">{t("上下文")}</span>
											<input
												className="panel-search"
												placeholder={t("总窗口 如 500k / 1m")}
												spellCheck={false}
												title={t("contextWindow：整段对话上下文上限")}
												value={
													typeof m.contextWindow === "number" &&
													Number.isFinite(m.contextWindow) &&
													m.contextWindow > 0
														? String(m.contextWindow)
														: typeof m.contextWindow === "string"
															? m.contextWindow
															: ""
												}
												onChange={(e) => {
													const raw = e.target.value.trim();
													patchModelAt(i, (x) => {
														if (!raw) {
															const { contextWindow: _drop, ...rest } = x as ModelEntry & {
																contextWindow?: unknown;
															};
															void _drop;
															return { ...rest, id: x.id };
														}
														try {
															return { ...x, contextWindow: parseContextWindow(raw) };
														} catch {
															return { ...x, contextWindow: raw };
														}
													});
												}}
												onBlur={() => {
													const raw = m.contextWindow;
													if (raw === undefined || raw === "" || raw === null) return;
													if (typeof raw === "number" && raw > 0) return;
													try {
														const n = parseContextWindow(String(raw));
														patchModelAt(i, (x) => ({ ...x, contextWindow: n }));
													} catch {
														patchModelAt(i, (x) => {
															const { contextWindow: _drop, ...rest } = x as ModelEntry & {
																contextWindow?: unknown;
															};
															void _drop;
															return { ...rest, id: x.id };
														});
														toast("warning", t("「{key}」上下文无效，已清空（可用 500k）", { key: entryKeyOf(m) }));
													}
												}}
											/>
										</label>
										<label className="conn-model-field">
											<span className="conn-model-field-label">{t("最大回复")}</span>
											<input
												className="panel-search"
												placeholder={t("单次输出 如 16k / 32k")}
												spellCheck={false}
												title={t("maxTokens：单次回复最大输出；空=默认 16384")}
												value={
													typeof m.maxTokens === "number" && Number.isFinite(m.maxTokens) && m.maxTokens > 0
														? String(m.maxTokens)
														: typeof m.maxTokens === "string"
															? m.maxTokens
															: ""
												}
												onChange={(e) => {
													const raw = e.target.value.trim();
													patchModelAt(i, (x) => {
														if (!raw) {
															const { maxTokens: _drop, ...rest } = x as ModelEntry & {
																maxTokens?: unknown;
															};
															void _drop;
															return { ...rest, id: x.id };
														}
														try {
															return { ...x, maxTokens: parseMaxTokens(raw) };
														} catch {
															return { ...x, maxTokens: raw };
														}
													});
												}}
												onBlur={() => {
													const raw = m.maxTokens;
													if (raw === undefined || raw === "" || raw === null) return;
													if (typeof raw === "number" && raw > 0) return;
													try {
														const n = parseMaxTokens(String(raw));
														patchModelAt(i, (x) => ({ ...x, maxTokens: n }));
													} catch {
														patchModelAt(i, (x) => {
															const { maxTokens: _drop, ...rest } = x as ModelEntry & {
																maxTokens?: unknown;
															};
															void _drop;
															return { ...rest, id: x.id };
														});
														toast("warning", t("「{key}」最大回复无效，已清空（可用 16k）", { key: entryKeyOf(m) }));
													}
												}}
											/>
										</label>
									</div>
								</li>
							))}
						</ul>
					)}
					{showAddModel ? (
						<div className="conn-model-add">
							<input
								className="panel-search"
								placeholder={t("模型 id")}
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
								{t("加入")}
							</button>
							<button type="button" className="act" onClick={() => setShowAddModel(false)}>
								{t("取消")}
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
				<div className="conn-sec-title">{isGen ? t("生成预览（可改）") : t("配置内容（可改）")}</div>
				<textarea
					className="panel-search ta conn-json conn-json-full"
					rows={10}
					spellCheck={false}
					value={jsonOverride ?? pretty(genPreview)}
					onChange={(e) => setJsonOverride(e.target.value)}
				/>
				<div className="panel-row" style={{ marginTop: 8 }}>
					<button type="button" className="act" disabled={busy || jsonOverride === null} onClick={applyJsonPreview}>
						{t("应用 JSON 到表单")}
					</button>
					<span className="field-hint">{t("可直接改 maxTokens / contextWindow 等；保存时会一并写入")}</span>
				</div>
			</section>

			<div className="panel-row">
				<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={() => void saveToWarehouse()}>
					{isGen ? t("存入配置仓库") : t("保存修改")}
				</button>
				{isGen && (
					<button
						type="button"
						className="act"
						onClick={() =>
							downloadText(`${draft.name.trim() || "profile"}.json`, jsonOverride ?? pretty(genPreview))
						}
					>
						{t("导出")}
					</button>
				)}
			</div>
		</div>
	);

	return (
		<div className="panel-body conn-panel">
			{/* ① 当前生效：模型 + 思考 + 切换列表（唯一选型入口） */}
			<section className="sp-section conn-block">
				<div className="conn-section-label">{t("当前生效")}</div>
				<PanelStatus loading={modelsData.loading} error={modelsData.error} hasData={!!modelsData.data} />
				{current ? (
					<>
						<div className="connect-current">
							<span className="auth-dot ok" />
							<div className="connect-current-info">
								<div className="model-current">{current.name}</div>
								<div className="field-hint">
									{t("{provider} · 窗口 {ctx}", { provider: current.provider, ctx: fmtCtx(liveContext) })}
									{liveThinking ? t(" · 思考 {level}", { level: liveThinking }) : ""}
									{liveMaxTokens > 0 ? t(" · 回复 {n}", { n: fmtCtx(liveMaxTokens) }) : ""}
								</div>
							</div>
						</div>
						<ThinkingInput
							value={liveThinking || current.thinkingLevel}
							hints={current.availableLevels}
							busy={busy}
							onCommit={(lv) => void setThinking(lv)}
						/>
						<ContextWindowInput value={liveContext} busy={busy} onCommit={(n) => void setContextWindow(n)} />
						<MaxTokensInput value={liveMaxTokens} busy={busy} onCommit={(n) => void setMaxTokens(n)} />
						<StreamingInput value={liveStreaming} busy={busy} onCommit={(on) => void setStreaming(on)} />
						{activeProviders.length > 0 && (
							<ul className="conn-pick-list" style={{ marginTop: 10 }}>
								{activeProviders.flatMap((pk) =>
									entriesOfActive(pk).map((entry, i) => {
										const key = entryKeyOf(entry);
										const think = typeof entry.thinkingLevel === "string" ? entry.thinkingLevel.trim() : "";
										const ctx = typeof entry.contextWindow === "number" ? entry.contextWindow : 0;
										const maxOut = typeof entry.maxTokens === "number" ? entry.maxTokens : 0;
										// 剧情模型认「哪条条目」。storyKey 缺席（旧配置还没点过条目）时只能按 id 认，
										// 那就只认**第一条**同 id 的——同 id 两条一起亮等于说有两个剧情模型；
										// 取第一条也和 models.json 的收敛口径一致（modelsForRuntime 取第一条）。
										const on =
											current.provider === pk &&
											current.id === String(entry.id) &&
											(storyKey
												? storyKey === key
												: entriesOfActive(pk).findIndex((x) => String(x.id) === String(entry.id)) === i);
										const isSide = sideEntry?.provider === pk && sideEntry?.entry === key;
										const missing = !knownModelIds.has(`${pk}/${String(entry.id)}`);
										return (
											<li key={`${pk}/${i}`} className="conn-pick-row">
												<button
													type="button"
													className={`conn-pick-model ${on ? "on" : ""}`}
													disabled={busy || on}
													onClick={() => void selectModelEntry(pk, entry)}
												>
													<span className="conn-pick-name">{key}</span>
													<span className="conn-pick-meta">
														{on && <span className="chip chip-cap">{t("剧情")}</span>}
														{isSide && <span className="chip chip-cap">{t("旁路")}</span>}
														{missing && <span className="chip chip-cap">{t("不在可用清单")}</span>}
														{key !== String(entry.id) ? (
															<span className="chip chip-cap">{String(entry.id)}</span>
														) : null}
														{think ? <span className="chip chip-cap">{think}</span> : null}
														{ctx > 0 ? <span className="chip chip-cap">{fmtCtx(ctx)}</span> : null}
														{maxOut ? <span className="chip chip-cap">{t("出{n}", { n: fmtCtx(maxOut) })}</span> : null}
													</span>
												</button>
												<button
													type="button"
													className={`conn-pick-side ${isSide ? "on" : ""}`}
													disabled={busy}
													title={
														isSide
															? t("取消旁路指定，记账与压缩回到跟随剧情模型")
															: t("把记账与压缩交给这条条目（思考档就用它自己的）")
													}
													onClick={() => void setSideEntry(isSide ? null : { provider: pk, entry: key })}
												>
													{t("旁路")}
												</button>
											</li>
										);
									}),
								)}
							</ul>
						)}
					</>
				) : (
					!modelsData.loading && <div className="sp-empty">{t("尚未启用配置 — 在仓库中启用")}</div>
				)}
			</section>

			{/* ② 配置仓库：名 + 右侧 启用|刷新 / 修改 / 删除；点击行展开修改 */}
			<section className="sp-section conn-block">
				<div className="conn-section-label">{t("配置仓库")}</div>
				<PanelStatus loading={profilesData.loading} error={profilesData.error} hasData={!!profilesData.data} />
				{profiles.length === 0 && <div className="sp-empty">{t("仓库为空 — 用下方生成器创建")}</div>}
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
									{p.active && <span className="chip chip-cap">{t("启用中")}</span>}
								</button>
								<span className="conn-wh-acts" onClick={(e) => e.stopPropagation()}>
									{!p.active && (
										<button type="button" className="act" disabled={busy} onClick={() => void enableProfile(p.id)}>
											{t("启用")}
										</button>
									)}
									{p.active && (
										<button
											type="button"
											className="act"
											disabled={busy}
											title={t("从仓库重读配置并重传到 models.json / 当前会话")}
											onClick={() => void refreshProfile(p.id)}
										>
											{t("刷新")}
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
										{t("修改")}
									</button>
									<ConfirmButton className="act" disabled={busy} confirmText={t("确认删除")} onConfirm={() => void deleteProf(p.id)}>
										{t("删除")}
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
				<div className="conn-section-label">{t("配置生成器")}</div>
				{mode?.kind === "gen" ? (
					<div className="conn-card selected add-channel">
						<div className="conn-expand">{renderEditor(true)}</div>
					</div>
				) : (
					<button type="button" className="drawer-btn conn-add-btn" onClick={openGenerator}>
						{t("＋ 生成配置")}
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
