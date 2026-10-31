/**
 * 连接面板 + 右扩渠道编辑器/模型详情卡 + 聊天框 WorkBuddy 式外扩模型选择器
 *
 * 设计原则（学习 WorkBuddy）：
 * 1. 模型主列表极度干净：每一行只放「模型名 + 渠道标签 + 选中 ✓」（底部一行「配置自定义模型」）。
 * 2. 除模型名外的所有参数（思考强度、上下文窗口、最大回复、旁路开关）全部往外扩到二级卡片：
 *    - 聊天框底栏模型菜单：主列表在右，悬停/选中某模型时在左侧外扩弹出二级详情与参数配置浮层；
 *    - 左栏「连接」面板：所有模型列表同样保持单行极简，点选/外扩在右侧副栏展示或配置该模型详情，
 *      点「＋ 添加渠道」「修改」「配置文件」同样在右侧副栏展开。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiPost,
	apiPut,
	downloadText,
	type AgentConfigResponse,
	type AgentProviderRaw,
	type CurrentModelInfo,
	type LiyuanAgentConfig,
	type ModelEntry,
	type ModelsResponse,
	type RpConfigView,
} from "../api.ts";
import { bumpWatchPanels, ConfirmButton, Field, PanelStatus, SearchInput, useAction, usePanelData } from "./kit.tsx";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconClose, IconEdit, IconModel, IconSettings } from "./icons.tsx";
import { t } from "../i18n/index.ts";

const API_TYPES = [
	{ value: "openai-completions", label: "OpenAI 兼容（chat/completions）" }, // i18n-ignore：用时 t(label)
	{ value: "openai-responses", label: "OpenAI Responses" },
	{ value: "anthropic-messages", label: "Anthropic Messages" },
	{ value: "google-generative-ai", label: "Google Generative AI" },
];

/** 编辑器内供用户勾选模型支持档位的全部常见档位 */
export const ALL_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

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

export type ConnectEditTarget =
	| { kind: "gen" }
	| { kind: "edit"; id: string }
	| { kind: "file" }
	| { kind: "model"; provider: string; entryKey: string };

interface Draft {
	name: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	headersText: string;
	models: ModelEntry[];
	editId: string | null;
	streaming: boolean;
	compatRest: Record<string, unknown>;
	providerExtra: Record<string, unknown>;
}

function emptyDraft(): Draft {
	return {
		name: "",
		baseUrl: "",
		api: API_TYPES[0].value,
		apiKey: "",
		headersText: "",
		models: [],
		editId: null,
		streaming: true,
		compatRest: {},
		providerExtra: {},
	};
}

function formatHeadersText(raw: unknown): string {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
	const lines: string[] = [];
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		const key = k.trim();
		if (!key || typeof v !== "string") continue;
		lines.push(`${key}: ${v}`);
	}
	return lines.join("\n");
}

function parseHeadersText(raw: string, strict = false): Record<string, string> {
	const trimmed = raw.trim();
	if (!trimmed) return {};
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				if (strict) throw new Error(t("自定义请求头格式应为 Key: Value（每行一条）或 JSON 对象"));
				return {};
			}
			const out: Record<string, string> = {};
			for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
				const key = k.trim();
				if (!key || v === undefined || v === null) continue;
				out[key] = String(v);
			}
			return out;
		} catch (e) {
			if (strict) {
				throw e instanceof Error && e.message.includes("Key: Value")
					? e
					: new Error(t("自定义请求头格式应为 Key: Value（每行一条）或 JSON 对象"));
			}
			return {};
		}
	}
	const out: Record<string, string> = {};
	for (const rawLine of trimmed.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const idx = line.indexOf(":");
		if (idx <= 0) {
			if (strict) throw new Error(t("自定义请求头格式应为 Key: Value（每行一条）或 JSON 对象"));
			continue;
		}
		const key = line.slice(0, idx).trim();
		const val = line.slice(idx + 1).trim();
		if (!key) {
			if (strict) throw new Error(t("自定义请求头格式应为 Key: Value（每行一条）或 JSON 对象"));
			continue;
		}
		out[key] = val;
	}
	return out;
}

/** 读取某个模型条目勾选支持的档位列表（按标准顺序排列） */
export function supportedLevelsOf(m: ModelEntry | undefined): string[] {
	if (!m) return ["off", "low", "medium", "high"];
	const raw = Array.isArray(m.thinkingLevels)
		? m.thinkingLevels.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim())
		: [];
	const single = typeof m.thinkingLevel === "string" ? m.thinkingLevel.trim() : "";
	const set = new Set<string>(raw);
	if (single) set.add(single);
	if (set.size === 0) return ["off"];
	const ordered: string[] = [];
	for (const lv of ALL_THINKING_LEVELS) {
		if (set.has(lv)) {
			ordered.push(lv);
			set.delete(lv);
		}
	}
	for (const rest of set) ordered.push(rest);
	return ordered;
}

/** 规范化模型条目上的数值字段与档位列表 */
function normalizeModelNumericFields(m: ModelEntry): ModelEntry {
	const out: ModelEntry = { ...m, id: String(m.id) };
	const levels = supportedLevelsOf(m);
	out.thinkingLevels = levels;
	const curLv = typeof out.thinkingLevel === "string" ? out.thinkingLevel.trim() : "";
	if (!curLv || !levels.includes(curLv)) {
		out.thinkingLevel = levels.find((x) => x !== "off") ?? levels[0] ?? "off";
	}
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

function draftToProvider(d: Draft, fallbackApiKey?: string, strictHeaders = false): AgentProviderRaw {
	const models = d.models.map((m) => normalizeModelNumericFields(m));
	const compat: Record<string, unknown> = { ...d.compatRest };
	delete compat.safetyThreshold;
	if (d.streaming) {
		delete compat.streaming;
	} else {
		compat.streaming = false;
	}
	const headers = parseHeadersText(d.headersText, strictHeaders);
	const key = d.apiKey.trim() || fallbackApiKey || "placeholder";
	return {
		baseUrl: d.baseUrl.trim(),
		api: d.api.trim() || "openai-completions",
		apiKey: key,
		models,
		...(Object.keys(d.providerExtra).length > 0 && d.providerExtra),
		...(Object.keys(headers).length > 0 && { headers }),
		...(Object.keys(compat).length > 0 && { compat }),
	};
}

function draftToConfig(d: Draft): LiyuanAgentConfig {
	const name = d.name.trim();
	const providers: LiyuanAgentConfig["providers"] = {};
	const models = d.models.map((m) => normalizeModelNumericFields(m));
	if (name) {
		providers[name] = draftToProvider(d);
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

function draftFromProvider(name: string, p: AgentProviderRaw | undefined): Draft {
	const pr = p ?? {};
	const models = Array.isArray(pr.models)
		? pr.models.map((m) => {
				const levels = supportedLevelsOf(m);
				const lv = typeof m.thinkingLevel === "string" && m.thinkingLevel.trim() ? m.thinkingLevel.trim() : levels[0] ?? "off";
				return {
					...m,
					id: String(m.id),
					thinkingLevel: lv,
					thinkingLevels: levels,
				};
			})
		: [];
	const compat = (pr as Record<string, unknown>).compat as Record<string, unknown> | undefined;
	const compatRest = { ...compat };
	delete compatRest.streaming;
	delete compatRest.safetyThreshold;
	const providerExtra: Record<string, unknown> = { ...(pr as Record<string, unknown>) };
	delete providerExtra.baseUrl;
	delete providerExtra.api;
	delete providerExtra.apiKey;
	delete providerExtra.headers;
	delete providerExtra.models;
	delete providerExtra.compat;
	return {
		editId: name,
		name,
		baseUrl: String(pr.baseUrl ?? ""),
		api: String(pr.api ?? "openai-completions"),
		apiKey: "",
		headersText: formatHeadersText((pr as Record<string, unknown>).headers),
		models,
		streaming: compat?.streaming !== false,
		compatRest,
		providerExtra,
	};
}

function draftFromConfig(id: string, name: string, config: LiyuanAgentConfig): Draft {
	const keys = Object.keys(config.providers ?? {});
	const pname = config.defaultProvider && config.providers[config.defaultProvider] ? config.defaultProvider : keys[0] ?? id;
	return draftFromProvider(pname || name, config.providers[pname]);
}

export function entryKeyOf(m: ModelEntry): string {
	const label = typeof m.label === "string" ? m.label.trim() : "";
	return label || String(m.id);
}

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

export function parseContextWindow(raw: string): number {
	return parseTokenCount(raw, "context");
}

export function parseMaxTokens(raw: string): number {
	return parseTokenCount(raw, "maxOut");
}

const fmtCtx = (n: number) => {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
	if (n >= 1000) return `${Math.round(n / 1000)}k`;
	return String(n);
};

export interface AggregatedModelItem {
	provider: string;
	entry: ModelEntry;
	entryIndex: number;
}

function buildAggregatedModels(
	activeConfig: LiyuanAgentConfig,
	allModels: ModelsResponse["models"],
): AggregatedModelItem[] {
	const out: AggregatedModelItem[] = [];
	const seenProviders = new Set<string>();

	for (const [pk, prov] of Object.entries(activeConfig.providers ?? {})) {
		seenProviders.add(pk);
		const list = Array.isArray(prov?.models) ? prov.models : [];
		list.forEach((entry, entryIndex) => {
			out.push({ provider: pk, entry, entryIndex });
		});
	}

	const extraByProvider = new Map<string, ModelEntry[]>();
	for (const m of allModels) {
		if (seenProviders.has(m.provider)) continue;
		const list = extraByProvider.get(m.provider) ?? [];
		list.push({
			id: m.id,
			...(m.name && m.name !== m.id ? { label: m.name } : {}),
			...(m.contextWindow > 0 ? { contextWindow: m.contextWindow } : {}),
			...(typeof m.maxTokens === "number" && m.maxTokens > 0 ? { maxTokens: m.maxTokens } : {}),
			thinkingLevels: m.reasoning ? ["off", "low", "medium", "high"] : ["off"],
		});
		extraByProvider.set(m.provider, list);
	}
	for (const [pk, entries] of extraByProvider.entries()) {
		entries.forEach((entry, entryIndex) => {
			out.push({ provider: pk, entry, entryIndex });
		});
	}
	return out;
}

function StatusLine({ status }: { status: { ok: boolean; detail: string } | null }) {
	if (!status) return null;
	return <div className={`channel-status ${status.ok ? "ok" : "bad"}`}>{status.ok ? status.detail : t("失败：{detail}", { detail: status.detail })}</div>;
}

/**
 * WorkBuddy 式二级模型详情与参数配置内容（无框列表排版，点击某行才展开对应选项）
 */
function ModelDetailInspect({
	item,
	isCurrent,
	isSide,
	liveThinking,
	busy,
	onSelectWithLevel,
	onPatchEntry,
	onToggleSide,
	onUseModel,
}: {
	item: AggregatedModelItem;
	isCurrent: boolean;
	isSide: boolean;
	liveThinking: string;
	busy: boolean;
	onSelectWithLevel: (level: string) => void;
	onPatchEntry: (patch: Partial<ModelEntry>) => void;
	onToggleSide: (on: boolean) => void;
	onUseModel?: () => void;
}) {
	const key = entryKeyOf(item.entry);
	const levels = supportedLevelsOf(item.entry);
	const activeLv = isCurrent
		? liveThinking
		: (typeof item.entry.thinkingLevel === "string" && item.entry.thinkingLevel.trim()) || levels[0] || "off";
	const ctx = typeof item.entry.contextWindow === "number" && item.entry.contextWindow > 0 ? item.entry.contextWindow : 128000;
	const maxOut = typeof item.entry.maxTokens === "number" && item.entry.maxTokens > 0 ? item.entry.maxTokens : 0;

	const [openRow, setOpenRow] = useState<null | "level" | "ctx" | "max">(null);
	const [ctxDraft, setCtxDraft] = useState(String(ctx));
	const [maxDraft, setMaxDraft] = useState(maxOut > 0 ? String(maxOut) : "");

	useEffect(() => {
		setOpenRow(null);
		setCtxDraft(String(ctx));
		setMaxDraft(maxOut > 0 ? String(maxOut) : "");
	}, [item.provider, key, ctx, maxOut]);

	return (
		<div className="wb-model-inspect">
			<div className="wb-inspect-head">
				<div className="wb-inspect-title">{key}</div>
				<div className="wb-inspect-sub">
					{t("渠道：{provider} · 支持 {ctx} 上下文窗口", { provider: item.provider, ctx: fmtCtx(ctx) })}
				</div>
			</div>

			<div className="wb-inspect-rows">
				{/* 1. 思考强度（点击才展开已勾选的支持档位） */}
				<div className="wb-inspect-item">
					<button
						type="button"
						className={`wb-inspect-row ${openRow === "level" ? "active" : ""}`}
						onClick={() => setOpenRow((r) => (r === "level" ? null : "level"))}
					>
						<span className="wb-inspect-label">{t("思考强度")}</span>
						<span className="wb-inspect-val">
							<span>{activeLv}</span>
							<IconChevronRight size={13} className={`wb-inspect-arrow ${openRow === "level" ? "open" : ""}`} />
						</span>
					</button>
					{openRow === "level" && (
						<div className="wb-inspect-subpane">
							<div className="wb-inspect-pills">
								{levels.map((lv) => {
									const on = activeLv === lv;
									return (
										<button
											key={lv}
											type="button"
											className={`wb-level-pill ${on ? "active" : ""}`}
											disabled={busy}
											onClick={() => {
												onSelectWithLevel(lv);
												setOpenRow(null);
											}}
										>
											{lv}
										</button>
									);
								})}
							</div>
						</div>
					)}
				</div>

				{/* 2. 上下文窗口 */}
				<div className="wb-inspect-item">
					<button
						type="button"
						className={`wb-inspect-row ${openRow === "ctx" ? "active" : ""}`}
						onClick={() => setOpenRow((r) => (r === "ctx" ? null : "ctx"))}
					>
						<span className="wb-inspect-label">{t("上下文窗口")}</span>
						<span className="wb-inspect-val">
							<span>{fmtCtx(ctx)}</span>
							<IconChevronRight size={13} className={`wb-inspect-arrow ${openRow === "ctx" ? "open" : ""}`} />
						</span>
					</button>
					{openRow === "ctx" && (
						<div className="wb-inspect-subpane">
							<div className="wb-inspect-pills">
								{[128000, 200000, 500000, 1000000].map((preset) => (
									<button
										key={preset}
										type="button"
										className={`wb-level-pill ${ctx === preset ? "active" : ""}`}
										disabled={busy}
										onClick={() => {
											setCtxDraft(String(preset));
											onPatchEntry({ contextWindow: preset });
											setOpenRow(null);
										}}
									>
										{fmtCtx(preset)}
									</button>
								))}
							</div>
							<div className="wb-inspect-input-row">
								<input
									className="panel-search"
									value={ctxDraft}
									placeholder={t("总窗口 如 500k / 1m")}
									onChange={(e) => setCtxDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											try {
												onPatchEntry({ contextWindow: parseContextWindow(ctxDraft) });
												setOpenRow(null);
											} catch {
												/* ignore */
											}
										}
									}}
								/>
								<button
									type="button"
									className="rc-btn rc-btn-primary"
									disabled={busy}
									onClick={() => {
										try {
											onPatchEntry({ contextWindow: parseContextWindow(ctxDraft) });
											setOpenRow(null);
										} catch {
											/* ignore */
										}
									}}
								>
									{t("应用")}
								</button>
							</div>
						</div>
					)}
				</div>

				{/* 3. 最大回复 */}
				<div className="wb-inspect-item">
					<button
						type="button"
						className={`wb-inspect-row ${openRow === "max" ? "active" : ""}`}
						onClick={() => setOpenRow((r) => (r === "max" ? null : "max"))}
					>
						<span className="wb-inspect-label">{t("最大回复")}</span>
						<span className="wb-inspect-val">
							<span>{maxOut > 0 ? fmtCtx(maxOut) : "16k"}</span>
							<IconChevronRight size={13} className={`wb-inspect-arrow ${openRow === "max" ? "open" : ""}`} />
						</span>
					</button>
					{openRow === "max" && (
						<div className="wb-inspect-subpane">
							<div className="wb-inspect-pills">
								{[8192, 16384, 32000, 64000].map((preset) => (
									<button
										key={preset}
										type="button"
										className={`wb-level-pill ${maxOut === preset ? "active" : ""}`}
										disabled={busy}
										onClick={() => {
											setMaxDraft(String(preset));
											onPatchEntry({ maxTokens: preset });
											setOpenRow(null);
										}}
									>
										{fmtCtx(preset)}
									</button>
								))}
							</div>
							<div className="wb-inspect-input-row">
								<input
									className="panel-search"
									value={maxDraft}
									placeholder={t("单次输出 如 16k / 32k")}
									onChange={(e) => setMaxDraft(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											try {
												onPatchEntry({ maxTokens: parseMaxTokens(maxDraft) });
												setOpenRow(null);
											} catch {
												/* ignore */
											}
										}
									}}
								/>
								<button
									type="button"
									className="rc-btn rc-btn-primary"
									disabled={busy}
									onClick={() => {
										try {
											onPatchEntry({ maxTokens: parseMaxTokens(maxDraft) });
											setOpenRow(null);
										} catch {
											/* ignore */
										}
									}}
								>
									{t("应用")}
								</button>
							</div>
						</div>
					)}
				</div>

				{/* 4. 旁路模型 */}
				<div className="wb-inspect-item">
					<button
						type="button"
						className="wb-inspect-row"
						disabled={busy}
						title={
							isSide
								? t("取消旁路指定，记账与压缩回到跟随剧情模型")
								: t("把记账与压缩交给这条条目（思考档就用它自己的）")
						}
						onClick={() => onToggleSide(!isSide)}
					>
						<span className="wb-inspect-label">{t("设为旁路模型")}</span>
						<span className="wb-inspect-val">
							<span>{isSide ? t("已开启") : t("跟随主模型")}</span>
							<IconChevronRight size={13} className="wb-inspect-arrow" />
						</span>
					</button>
				</div>
			</div>

			{onUseModel && !isCurrent && (
				<div className="wb-inspect-foot">
					<button type="button" className="wb-use-link" disabled={busy} onClick={onUseModel}>
						{t("切换为此模型")}
					</button>
				</div>
			)}
		</div>
	);
}

// ---------- 1. 聊天界面底栏：WorkBuddy 式模型选择 + 左侧外扩详情浮层 ----------

export function ComposerModelSwitch({
	toast,
	onOpenConnect,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onOpenConnect: () => void;
}) {
	const modelsData = usePanelData(() => apiGet<ModelsResponse>("/api/models"), { cacheKey: "/api/models", watchAgent: true });
	const agentCfg = usePanelData(() => apiGet<AgentConfigResponse>("/api/agent-config"), { cacheKey: "/api/agent-config", watchAgent: true });
	const rpConfig = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config", watchAgent: true });
	const { busy, run } = useAction(toast);
	const [open, setOpen] = useState(false);
	const [hoveredItem, setHoveredItem] = useState<AggregatedModelItem | null>(null);
	const [mobileDetailItem, setMobileDetailItem] = useState<AggregatedModelItem | null>(null);
	const [flyoutTop, setFlyoutTop] = useState<number>(0);
	const wrapRef = useRef<HTMLDivElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const flyoutRef = useRef<HTMLDivElement>(null);

	const current = modelsData.data?.current ?? null;
	const allModels = modelsData.data?.models ?? [];
	const activeConfig: LiyuanAgentConfig = agentCfg.data?.config ?? { version: 1, providers: {} };
	const sideEntry = rpConfig.data?.config?.sideModel ?? null;
	const storyKey = typeof activeConfig.defaultModelEntry === "string" ? activeConfig.defaultModelEntry.trim() : "";

	const allItems = useMemo(() => buildAggregatedModels(activeConfig, allModels), [activeConfig, allModels]);

	const currentItem = useMemo(() => {
		if (!current) return allItems[0] ?? null;
		const hit = allItems.find(
			(it) =>
				it.provider === current.provider &&
				String(it.entry.id) === current.id &&
				(storyKey ? entryKeyOf(it.entry) === storyKey : true),
		);
		return hit ?? allItems[0] ?? null;
	}, [allItems, current, storyKey]);

	const currentEntry = currentItem?.entry;

	const liveThinking = (() => {
		if (!current) return "off";
		const fromModel = typeof currentEntry?.thinkingLevel === "string" ? currentEntry.thinkingLevel.trim() : "";
		if (fromModel) return fromModel;
		const def = typeof activeConfig.defaultThinkingLevel === "string" ? activeConfig.defaultThinkingLevel.trim() : "";
		if (def) return def;
		return current.thinkingLevel || "off";
	})();

	const displayModelName = currentEntry ? entryKeyOf(currentEntry) : current?.name || current?.id || t("未选择");
	// 仅在鼠标悬停到具体模型行时才展开左侧二级浮层，默认不展开
	const inspectTarget = hoveredItem;

	useEffect(() => {
		if (!open) {
			setHoveredItem(null);
			setMobileDetailItem(null);
			return;
		}
		const onDocDown = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onDocDown);
		window.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocDown);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const reloadAll = () => {
		modelsData.reload();
		agentCfg.reload();
		rpConfig.reload();
	};

	const handleRowHover = (it: AggregatedModelItem, targetEl: HTMLElement) => {
		setHoveredItem(it);
		const menuEl = menuRef.current;
		if (!menuEl) return;
		const menuRect = menuEl.getBoundingClientRect();
		const rowRect = targetEl.getBoundingClientRect();
		const flyoutEl = flyoutRef.current;
		const flyoutH = flyoutEl?.offsetHeight || 220;
		const menuH = menuRect.height;
		let top = rowRect.top - menuRect.top - 8;
		if (top + flyoutH > menuH) {
			top = Math.max(0, menuH - flyoutH);
		}
		if (top < 0) top = 0;
		setFlyoutTop(top);
	};

	const selectModelEntry = (provider: string, entry: ModelEntry, explicitLevel?: string, closeAfter = true) =>
		run(async () => {
			const key = entryKeyOf(entry);
			const levels = supportedLevelsOf(entry);
			const targetLevel =
				explicitLevel ||
				(typeof entry.thinkingLevel === "string" && entry.thinkingLevel.trim()) ||
				levels.find((lv) => lv !== "off") ||
				levels[0] ||
				"off";
			await apiPost<{ current: CurrentModelInfo }>("/api/models/select", { provider, id: entry.id });
			if (targetLevel) {
				try {
					await apiPost("/api/models/thinking", { level: targetLevel });
				} catch (e) {
					toast("warning", t("模型已切换，思考档未能应用：{err}", { err: e instanceof Error ? e.message : String(e) }));
				}
			}
			const nextProviders = { ...activeConfig.providers };
			if (nextProviders[provider] && Array.isArray(nextProviders[provider].models)) {
				nextProviders[provider] = {
					...nextProviders[provider],
					models: nextProviders[provider].models!.map((m) =>
						entryKeyOf(m) === key ? { ...m, thinkingLevel: targetLevel } : m,
					),
				};
			}
			const cfg: LiyuanAgentConfig = {
				...activeConfig,
				defaultProvider: provider,
				defaultModel: String(entry.id),
				defaultModelEntry: key,
				defaultThinkingLevel: targetLevel,
				providers: nextProviders,
			};
			await apiPut("/api/agent-config", { config: cfg });
			reloadAll();
			bumpWatchPanels();
			if (closeAfter) setOpen(false);
			toast("info", `${provider} / ${key} · ${targetLevel}`);
		});

	const patchTargetEntry = (target: AggregatedModelItem, patch: Partial<ModelEntry>) =>
		run(async () => {
			const pk = target.provider;
			const key = entryKeyOf(target.entry);
			const nextProviders = { ...activeConfig.providers };
			const prov = nextProviders[pk];
			if (!prov || !Array.isArray(prov.models)) return;
			nextProviders[pk] = {
				...prov,
				models: prov.models.map((m) => (entryKeyOf(m) === key ? { ...m, ...patch } : m)),
			};
			await apiPut("/api/agent-config", {
				config: {
					...activeConfig,
					providers: nextProviders,
				},
			});
			reloadAll();
			bumpWatchPanels();
		});

	const setSideForTarget = (target: AggregatedModelItem, on: boolean) =>
		run(async () => {
			const key = entryKeyOf(target.entry);
			await apiPut("/api/config", { sideModel: on ? { provider: target.provider, entry: key } : null });
			rpConfig.reload();
			bumpWatchPanels();
		}, on ? t("旁路：{entry}", { entry: `${target.provider}/${entryKeyOf(target.entry)}` }) : t("旁路：跟随剧情模型"));

	return (
		<div className="composer-model-wrap" ref={wrapRef}>
			<button
				type="button"
				className={`composer-model-btn ${open ? "active" : ""}`}
				onClick={() => {
					setOpen((v) => {
						const next = !v;
						if (next) reloadAll();
						return next;
					});
				}}
				aria-expanded={open}
				title={current ? `${current.provider} / ${displayModelName} (${liveThinking})` : t("切换模型")}
			>
				<IconModel size={13} className="composer-model-icon" />
				<span className="composer-model-name">{displayModelName}</span>
				{liveThinking && liveThinking !== "off" && (
					<span className="composer-model-think">{liveThinking}</span>
				)}
				<IconChevronDown size={11} className={`composer-model-caret ${open ? "open" : ""}`} />
			</button>

			{open && (
				<>
					<div className="wb-model-backdrop" onClick={() => setOpen(false)} />
					<div
						className="wb-model-popover-shell"
						role="dialog"
						aria-label={t("切换模型")}
						onMouseLeave={() => setHoveredItem(null)}
					>
						{mobileDetailItem ? (
							<div className="wb-model-mobile-detail">
								<div className="wb-model-mobile-detail-head">
									<button
										type="button"
										className="wb-model-mobile-back"
										onClick={() => setMobileDetailItem(null)}
									>
										<IconChevronLeft size={16} />
										<span>{t("返回模型列表")}</span>
									</button>
									<span className="wb-model-row-prov">{mobileDetailItem.provider}</span>
								</div>
								<ModelDetailInspect
									item={mobileDetailItem}
									isCurrent={
										current?.provider === mobileDetailItem.provider &&
										current?.id === String(mobileDetailItem.entry.id) &&
										(storyKey ? storyKey === entryKeyOf(mobileDetailItem.entry) : true)
									}
									isSide={
										sideEntry?.provider === mobileDetailItem.provider &&
										sideEntry?.entry === entryKeyOf(mobileDetailItem.entry)
									}
									liveThinking={
										typeof mobileDetailItem.entry.thinkingLevel === "string" && mobileDetailItem.entry.thinkingLevel.trim()
											? mobileDetailItem.entry.thinkingLevel.trim()
											: supportedLevelsOf(mobileDetailItem.entry)[0] || "off"
									}
									busy={busy}
									onSelectWithLevel={(lv) =>
										void selectModelEntry(mobileDetailItem.provider, mobileDetailItem.entry, lv, false)
									}
									onPatchEntry={(patch) => void patchTargetEntry(mobileDetailItem, patch)}
									onToggleSide={(on) => void setSideForTarget(mobileDetailItem, on)}
									onUseModel={() => {
										void selectModelEntry(mobileDetailItem.provider, mobileDetailItem.entry);
										setOpen(false);
									}}
								/>
							</div>
						) : (
							<>
								{/* 左侧外扩二级详情卡片：仅鼠标移到模型上时展开（桌面端） */}
								{inspectTarget && (
									<div
										className="wb-model-flyout"
										ref={flyoutRef}
										style={{ top: `${flyoutTop}px`, bottom: "auto" }}
									>
										<ModelDetailInspect
											item={inspectTarget}
											isCurrent={
												current?.provider === inspectTarget.provider &&
												current?.id === String(inspectTarget.entry.id) &&
												(storyKey ? storyKey === entryKeyOf(inspectTarget.entry) : true)
											}
											isSide={
												sideEntry?.provider === inspectTarget.provider &&
												sideEntry?.entry === entryKeyOf(inspectTarget.entry)
											}
											liveThinking={liveThinking}
											busy={busy}
											onSelectWithLevel={(lv) =>
												void selectModelEntry(inspectTarget.provider, inspectTarget.entry, lv, false)
											}
											onPatchEntry={(patch) => void patchTargetEntry(inspectTarget, patch)}
											onToggleSide={(on) => void setSideForTarget(inspectTarget, on)}
											onUseModel={() => void selectModelEntry(inspectTarget.provider, inspectTarget.entry)}
										/>
									</div>
								)}

								{/* 主列表 */}
								<div className="wb-model-main-menu" ref={menuRef}>
									{/* 顶部当前模型与思考档位一键点选 */}
									{currentItem && (
										<div className="wb-model-cur-card">
											<div className="wb-model-cur-head">
												<span className="wb-model-cur-title">
													<IconModel size={13} className="composer-model-icon" style={{ verticalAlign: "middle", marginRight: 5 }} />
													{entryKeyOf(currentItem.entry)}
												</span>
												<span className="wb-model-cur-prov">{currentItem.provider}</span>
											</div>
											{supportedLevelsOf(currentItem.entry).length > 1 && (
												<div className="wb-model-cur-think">
													<span className="wb-model-cur-think-label">{t("思考强度")}</span>
													<div className="wb-model-cur-think-pills">
														{supportedLevelsOf(currentItem.entry).map((lv) => (
															<button
																key={lv}
																type="button"
																className={`wb-level-pill ${liveThinking === lv ? "active" : ""}`}
																disabled={busy}
																onClick={(e) => {
																	e.stopPropagation();
																	void selectModelEntry(currentItem.provider, currentItem.entry, lv, false);
																}}
															>
																{lv}
															</button>
														))}
													</div>
												</div>
											)}
										</div>
									)}

									<div className="wb-model-list">
										{allItems.length === 0 ? (
											<div className="sp-empty">{t("暂无可用模型，请点击下方配置自定义模型")}</div>
										) : (
											allItems.map((it) => {
												const key = entryKeyOf(it.entry);
												const isCur =
													current?.provider === it.provider &&
													current?.id === String(it.entry.id) &&
													(storyKey ? storyKey === key : it.entryIndex === 0 || storyKey === "");
												const isInspecting =
													inspectTarget?.provider === it.provider &&
													entryKeyOf(inspectTarget.entry) === key &&
													inspectTarget.entryIndex === it.entryIndex;
												return (
													<div
														key={`${it.provider}/${it.entryIndex}/${key}`}
														className={`wb-model-row ${isCur ? "current" : ""} ${isInspecting ? "focused" : ""}`}
														onMouseEnter={(e) => handleRowHover(it, e.currentTarget)}
														onClick={() => void selectModelEntry(it.provider, it.entry)}
													>
														<span className="wb-model-row-name">{key}</span>
														<span className="wb-model-row-prov">{it.provider}</span>
														{isCur && <span className="wb-model-row-check">✓</span>}
														<button
															type="button"
															className="wb-model-row-gear"
															title={t("配置此模型参数与思考档")}
															aria-label={t("配置此模型参数与思考档")}
															onClick={(e) => {
																e.stopPropagation();
																setMobileDetailItem(it);
															}}
														>
															<IconSettings size={13} />
														</button>
													</div>
												);
											})
										)}
									</div>

									<div className="wb-model-foot" onMouseEnter={() => setHoveredItem(null)}>
										<button
											type="button"
											className="wb-model-config-btn"
											onClick={() => {
												setOpen(false);
												onOpenConnect();
											}}
										>
											<IconEdit size={13} />
											<span>{t("配置自定义模型")}</span>
										</button>
									</div>
								</div>
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}

// ---------- 2. 右侧并排扩出的「渠道配置编辑器 / 配置文件 / 模型外扩详情」副栏 ----------

export function ConnectEditorPane({
	target,
	onClose,
	toast,
}: {
	target: ConnectEditTarget;
	onClose: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const modelsData = usePanelData(() => apiGet<ModelsResponse>("/api/models"), { cacheKey: "/api/models" });
	const agentCfg = usePanelData(() => apiGet<AgentConfigResponse>("/api/agent-config"), { cacheKey: "/api/agent-config" });
	const rpConfig = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config" });
	const { busy, run } = useAction(toast);

	const allModels = modelsData.data?.models ?? [];
	const activeConfig: LiyuanAgentConfig = agentCfg.data?.config ?? { version: 1, providers: {} };
	const sideEntry = rpConfig.data?.config?.sideModel ?? null;

	const isGen = target.kind === "gen";
	const isFile = target.kind === "file";
	const isModel = target.kind === "model";

	const [draft, setDraft] = useState<Draft>(() =>
		target.kind === "edit" ? draftFromProvider(target.id, activeConfig.providers?.[target.id]) : emptyDraft(),
	);
	const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);
	const [discovered, setDiscovered] = useState<string[]>([]);
	const [showAddModel, setShowAddModel] = useState(false);
	const [newModelId, setNewModelId] = useState("");
	const [showJson, setShowJson] = useState(false);
	const [jsonOverride, setJsonOverride] = useState<string | null>(null);
	const [fullFileText, setFullFileText] = useState<string>("");
	const [fullFileDirty, setFullFileDirty] = useState(false);

	useEffect(() => {
		if (target.kind === "file") {
			setFullFileText(agentCfg.data?.text ?? `${pretty(activeConfig)}\n`);
			setFullFileDirty(false);
			return;
		}
		if (target.kind === "model") return;
		if (target.kind === "edit") {
			setDraft(draftFromProvider(target.id, activeConfig.providers?.[target.id]));
		} else {
			setDraft(emptyDraft());
		}
		setProbe(null);
		setDiscovered([]);
		setShowAddModel(false);
		setNewModelId("");
		setJsonOverride(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [target.kind, target.kind === "edit" ? target.id : "", agentCfg.data?.text]);

	const patchDraft = (p: Partial<Draft>) => {
		setJsonOverride(null);
		setDraft((d) => ({ ...d, ...p }));
	};

	const reloadAll = () => {
		modelsData.reload();
		agentCfg.reload();
		rpConfig.reload();
	};

	const testDraft = () =>
		run(async () => {
			if (!draft.baseUrl.trim()) throw new Error(t("先填 Base URL"));
			const headers = parseHeadersText(draft.headersText, true);
			const r = await apiPost<{ ok: boolean; detail: string }>("/api/channels/test", {
				...(target.kind === "edit" ? { name: target.id } : {}),
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim() || undefined,
				...(Object.keys(headers).length > 0 ? { headers } : {}),
			});
			setProbe(r);
		});

	const checkModels = () =>
		run(async () => {
			if (!draft.baseUrl.trim()) throw new Error(t("先填 Base URL"));
			const headers = parseHeadersText(draft.headersText, true);
			const r = await apiPost<{ models: string[] }>("/api/channels/fetch-models", {
				...(target.kind === "edit" ? { name: target.id } : {}),
				baseUrl: draft.baseUrl.trim(),
				apiKey: draft.apiKey.trim() || undefined,
				...(Object.keys(headers).length > 0 ? { headers } : {}),
			});
			setDiscovered(r.models);
			setProbe({ ok: true, detail: t("检查到 {n} 个模型（点 ＋ 加入已选）", { n: r.models.length }) });
		});

	const addModelById = (id: string) => {
		const mid = id.trim();
		if (!mid) return;
		if (draft.models.some((m) => m.id === mid)) {
			toast("info", t("该模型已在已选清单中，直接在下方勾选它支持的档位即可"));
			return;
		}
		const defaultLevels = mid.includes("thinking") || mid.includes("high") || mid.includes("pro") ? ["off", "low", "high"] : ["off"];
		const entry: ModelEntry = {
			id: mid,
			thinkingLevel: defaultLevels[defaultLevels.length - 1],
			thinkingLevels: defaultLevels,
		};
		patchDraft({ models: [...draft.models, entry] });
	};

	const patchModelAt = (i: number, fn: (m: ModelEntry) => ModelEntry) =>
		patchDraft({ models: draft.models.map((x, k) => (k === i ? fn(x) : x)) });
	const removeModelAt = (i: number) => patchDraft({ models: draft.models.filter((_, k) => k !== i) });

	const toggleModelSupportedLevel = (modelIdx: number, level: string) => {
		patchModelAt(modelIdx, (m) => {
			const cur = new Set(supportedLevelsOf(m));
			if (cur.has(level)) {
				if (cur.size <= 1) return m;
				cur.delete(level);
			} else {
				cur.add(level);
			}
			const nextLevels = ALL_THINKING_LEVELS.filter((lv) => cur.has(lv));
			const prevDef = typeof m.thinkingLevel === "string" ? m.thinkingLevel.trim() : "";
			const nextDef = nextLevels.includes(prevDef as never)
				? prevDef
				: nextLevels.find((lv) => lv !== "off") ?? nextLevels[0] ?? "off";
			return {
				...m,
				thinkingLevels: nextLevels,
				thinkingLevel: nextDef,
			};
		});
	};

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
		const id = target.kind === "edit" ? target.id : draft.name.trim() || "channel";
		const next = draftFromConfig(id, draft.name.trim() || id, config);
		if (target.kind === "gen") {
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

	const saveChannel = () =>
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
			if (!working.apiKey.trim() && isGen) throw new Error(t("请填写 API key"));
			if (working.models.length === 0) throw new Error(t("请至少添加一个模型"));

			const prevKey =
				target.kind === "edit"
					? activeConfig.providers?.[target.id]?.apiKey ?? activeConfig.providers?.[name]?.apiKey
					: undefined;
			const providerObj = draftToProvider(working, typeof prevKey === "string" ? prevKey : undefined, true);

			const nextProviders = { ...activeConfig.providers };
			if (target.kind === "edit" && target.id !== name) {
				delete nextProviders[target.id];
			}
			nextProviders[name] = providerObj;

			const firstModel = providerObj.models?.[0];
			const firstThink = providerObj.models?.find(
				(m) => typeof m.thinkingLevel === "string" && m.thinkingLevel.trim(),
			);
			const hasDefault = Boolean(activeConfig.defaultProvider && nextProviders[activeConfig.defaultProvider]);

			const nextConfig: LiyuanAgentConfig = {
				...activeConfig,
				version: 1,
				defaultProvider: hasDefault ? activeConfig.defaultProvider : name,
				defaultModel: hasDefault ? activeConfig.defaultModel : firstModel?.id,
				defaultThinkingLevel: hasDefault
					? activeConfig.defaultThinkingLevel
					: typeof firstThink?.thinkingLevel === "string"
						? firstThink.thinkingLevel.trim()
						: undefined,
				providers: nextProviders,
			};

			await apiPut("/api/agent-config", { config: nextConfig });
			if (!hasDefault && firstModel?.id) {
				try {
					await apiPost("/api/models/select", { provider: name, id: firstModel.id });
				} catch {
					/* ignore */
				}
			}
			pushUrlHist(working.baseUrl);
			reloadAll();
			bumpWatchPanels();
			onClose();
		}, isGen ? t("已添加渠道并写入配置文件") : t("渠道配置已更新"));

	const genPreview = useMemo(() => draftToConfig(draft), [draft]);

	const saveFullConfigFile = () =>
		run(async () => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(fullFileText);
			} catch (e) {
				throw new Error(t("JSON 无法解析：{err}", { err: e instanceof Error ? e.message : String(e) }));
			}
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error(t("配置须为 JSON 对象"));
			}
			await apiPut("/api/agent-config", { text: fullFileText });
			setFullFileDirty(false);
			reloadAll();
			bumpWatchPanels();
		}, t("配置文件已保存并同步到运行时"));

	if (isModel) {
		const allItems = buildAggregatedModels(activeConfig, allModels);
		const modelItem =
			allItems.find((it) => it.provider === target.provider && entryKeyOf(it.entry) === target.entryKey) ??
			allItems[0];
		if (!modelItem) return null;
		const key = entryKeyOf(modelItem.entry);
		const isSide = sideEntry?.provider === modelItem.provider && sideEntry?.entry === key;
		const entryThinking =
			(typeof modelItem.entry.thinkingLevel === "string" && modelItem.entry.thinkingLevel.trim()) ||
			supportedLevelsOf(modelItem.entry)[0] ||
			"off";

		const patchEntry = (patch: Partial<ModelEntry>) =>
			run(async () => {
				const pk = modelItem.provider;
				const nextProviders = { ...activeConfig.providers };
				const prov = nextProviders[pk];
				if (!prov || !Array.isArray(prov.models)) return;
				nextProviders[pk] = {
					...prov,
					models: prov.models.map((m) => (entryKeyOf(m) === key ? { ...m, ...patch } : m)),
				};
				await apiPut("/api/agent-config", {
					config: {
						...activeConfig,
						providers: nextProviders,
					},
				});
				reloadAll();
				bumpWatchPanels();
			});

		const toggleSide = (on: boolean) =>
			run(async () => {
				await apiPut("/api/config", { sideModel: on ? { provider: modelItem.provider, entry: key } : null });
				rpConfig.reload();
				bumpWatchPanels();
			}, on ? t("旁路：{entry}", { entry: `${modelItem.provider}/${key}` }) : t("旁路：跟随剧情模型"));

		return (
			<aside className="rc-lore-picker conn-editor-sub" aria-label={key}>
				<div className="panel-head rc-lore-picker-head">
					<span className="panel-head-title">
						<IconModel size={15} />
						<span>{key}</span>
					</span>
					<span className="panel-head-actions">
						<button type="button" className="icon-btn" onClick={onClose} title={t("关闭")} aria-label={t("关闭")}>
							<IconClose size={15} />
						</button>
					</span>
				</div>
				<div className="panel-body conn-editor-sub-body">
					<ModelDetailInspect
						item={modelItem}
						isCurrent={false}
						isSide={isSide}
						liveThinking={entryThinking}
						busy={busy}
						onSelectWithLevel={(lv) => void patchEntry({ thinkingLevel: lv })}
						onPatchEntry={(patch) => void patchEntry(patch)}
						onToggleSide={(on) => void toggleSide(on)}
					/>
				</div>
			</aside>
		);
	}

	if (isFile) {
		const filePath = agentCfg.data?.path || "liyuan.agent.json";
		return (
			<aside className="rc-lore-picker conn-editor-sub" aria-label={t("配置文件")}>
				<div className="panel-head rc-lore-picker-head">
					<span className="panel-head-title">
						<IconModel size={15} />
						<span>{t("配置文件")}</span>
					</span>
					<span className="panel-head-actions">
						<button type="button" className="icon-btn" onClick={onClose} title={t("关闭")} aria-label={t("关闭")}>
							<IconClose size={15} />
						</button>
					</span>
				</div>
				<div className="panel-body conn-editor-sub-body">
					<div className="field-hint">
						{t("全部渠道与模型均保存在同一份配置文件中，可直接查看或修改 JSON：")}
						<br />
						<code className="conn-path">{filePath}</code>
					</div>
					<textarea
						className="panel-search ta conn-json conn-json-full"
						style={{ flex: "1 1 auto", minHeight: 360 }}
						rows={22}
						spellCheck={false}
						value={fullFileText}
						onChange={(e) => {
							setFullFileText(e.target.value);
							setFullFileDirty(true);
						}}
					/>
					<div className="panel-row">
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={busy || !fullFileDirty}
							onClick={() => void saveFullConfigFile()}
						>
							{t("保存修改")}
						</button>
						<button
							type="button"
							className="drawer-btn"
							onClick={() => downloadText("liyuan.agent.json", fullFileText)}
						>
							{t("导出")}
						</button>
					</div>
				</div>
			</aside>
		);
	}

	return (
		<aside className="rc-lore-picker conn-editor-sub" aria-label={isGen ? t("添加新渠道") : t("修改渠道配置")}>
			<div className="panel-head rc-lore-picker-head">
				<span className="panel-head-title">
					<IconModel size={15} />
					<span>{isGen ? t("添加新渠道") : `${t("修改渠道配置")} · ${target.id}`}</span>
				</span>
				<span className="panel-head-actions">
					<button type="button" className="icon-btn" onClick={onClose} title={t("关闭")} aria-label={t("关闭")}>
						<IconClose size={15} />
					</button>
				</span>
			</div>

			<div className="panel-body conn-editor-sub-body">
				<section className="conn-sec">
					<div className="conn-sec-title">{t("接入")}</div>
					<Field label={t("配置名 / 渠道名")}>
						<input
							className="panel-search"
							placeholder={t("如 deepseek / cpa")}
							value={draft.name}
							onChange={(e) => patchDraft({ name: e.target.value })}
						/>
					</Field>
					<Field label="Base URL">
						<input
							className="panel-search"
							list="conn-url-hist"
							placeholder="https://api.example.com/v1"
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
					<Field label={t("自定义请求头（可选）")} hint={t("每行一条 Key: Value，或 JSON 对象")}>
						<textarea
							className="panel-search ta conn-json"
							rows={3}
							spellCheck={false}
							placeholder={"User-Agent: my-agent/1.0\nx-custom-header: value"}
							value={draft.headersText}
							onChange={(e) => patchDraft({ headersText: e.target.value })}
						/>
					</Field>
					<label className="conn-stream-check">
						<input
							type="checkbox"
							checked={draft.streaming}
							onChange={(e) => patchDraft({ streaming: e.target.checked })}
						/>
						<span>{t("流式传输")}</span>
					</label>
				</section>

				<section className="conn-sec">
					<div className="conn-sec-title">{t("模型")}</div>
					<div className="panel-row">
						<button type="button" className="drawer-btn" disabled={busy || !draft.baseUrl.trim()} onClick={() => void testDraft()}>
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
								<span className="field-hint">{t("点 ＋ 加入下方已选清单")}</span>
							</div>
							<ul className="conn-model-list">
								{discovered.map((id) => {
									const inList = draft.models.some((m) => m.id === id);
									return (
										<li key={id} className={`conn-model-row ${inList ? "in-list" : ""}`}>
											<span className="conn-model-id">{id}</span>
											{inList && <span className="conn-model-added">{t("已加入")}</span>}
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
							<span className="field-hint">{t("勾选每个模型支持的思考档位，切换时可直接点选")}</span>
						</div>
						{draft.models.length === 0 ? (
							<div className="sp-empty">{t("检查模型后点 ＋，或手填")}</div>
						) : (
							<ul className="conn-model-list">
								{draft.models.map((m, i) => {
									const levels = supportedLevelsOf(m);
									return (
										<li key={i} className="conn-model-card">
											<div className="conn-model-card-head">
												<span className="conn-model-id" title={m.id}>
													{m.id}
												</span>
												<button type="button" className="act" onClick={() => removeModelAt(i)}>
													{t("移除")}
												</button>
											</div>

											<div className="conn-model-levels-block">
												<span className="conn-model-field-label">{t("支持档位（点击勾选）")}</span>
												<div className="conn-level-grid">
													{ALL_THINKING_LEVELS.map((lv) => {
														const checked = levels.includes(lv);
														return (
															<button
																key={lv}
																type="button"
																className={`conn-level-chip ${checked ? "on" : ""}`}
																onClick={() => toggleModelSupportedLevel(i, lv)}
															>
																<span className={`check ${checked ? "on" : ""}`} />
																<span>{lv}</span>
															</button>
														);
													})}
												</div>
											</div>

											<div className="conn-model-fields conn-model-fields-2col">
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
									);
								})}
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
					<button
						type="button"
						className="conn-preview-toggle"
						onClick={() => setShowJson((v) => !v)}
					>
						<span>{isGen ? t("生成预览（可改）") : t("配置内容（可改）")}</span>
						<span className="conn-preview-hint">{showJson ? t("收起") : "JSON"}</span>
					</button>
					{showJson && (
						<div className="conn-preview-body">
							<textarea
								className="panel-search ta conn-json conn-json-full"
								rows={8}
								spellCheck={false}
								value={jsonOverride ?? pretty(genPreview)}
								onChange={(e) => setJsonOverride(e.target.value)}
							/>
							<div className="panel-row" style={{ marginTop: 6 }}>
								<button type="button" className="act" disabled={busy || jsonOverride === null} onClick={applyJsonPreview}>
									{t("应用 JSON 到表单")}
								</button>
							</div>
						</div>
					)}
				</section>

				<div className="panel-row">
					<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={() => void saveChannel()}>
						{isGen ? t("保存渠道") : t("保存修改")}
					</button>
					{isGen && (
						<button
							type="button"
							className="act"
							onClick={() =>
								downloadText(`${draft.name.trim() || "channel"}.json`, jsonOverride ?? pretty(genPreview))
							}
						>
							{t("导出")}
						</button>
					)}
				</div>

				<datalist id="conn-url-hist">
					{loadUrlHist().map((u) => (
						<option key={u} value={u} />
					))}
				</datalist>
			</div>
		</aside>
	);
}

// ---------- 3. 左栏「连接」主面板 ----------

export function ConnectPanel({
	toast,
	editorTarget,
	onChangeEditorTarget,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	editorTarget?: ConnectEditTarget | null;
	onChangeEditorTarget?: (next: ConnectEditTarget | null) => void;
}) {
	const modelsData = usePanelData(() => apiGet<ModelsResponse>("/api/models"), { cacheKey: "/api/models" });
	const agentCfg = usePanelData(() => apiGet<AgentConfigResponse>("/api/agent-config"), { cacheKey: "/api/agent-config" });
	const rpConfig = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config" });
	const { busy, run } = useAction(toast);
	const [query, setQuery] = useState("");
	const [localTarget, setLocalTarget] = useState<ConnectEditTarget | null>(null);

	const activeTarget = onChangeEditorTarget ? (editorTarget ?? null) : localTarget;
	const setTarget = (next: ConnectEditTarget | null) => {
		if (onChangeEditorTarget) onChangeEditorTarget(next);
		else setLocalTarget(next);
	};

	const allModels = modelsData.data?.models ?? [];
	const activeConfig: LiyuanAgentConfig = agentCfg.data?.config ?? { version: 1, providers: {} };
	const sideEntry = rpConfig.data?.config?.sideModel ?? null;

	const reloadAll = () => {
		modelsData.reload();
		agentCfg.reload();
		rpConfig.reload();
	};

	const deleteChannel = (name: string) =>
		run(async () => {
			await apiDelete(`/api/channels?name=${encodeURIComponent(name)}`);
			if (activeTarget?.kind === "edit" && activeTarget.id === name) setTarget(null);
			reloadAll();
			bumpWatchPanels();
		}, t("已删除「{id}」", { id: name }));

	const activeProviders = Object.keys(activeConfig.providers ?? {});
	const allItems = useMemo(() => buildAggregatedModels(activeConfig, allModels), [activeConfig, allModels]);
	const filteredItems = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return allItems;
		return allItems.filter(
			(it) =>
				it.provider.toLowerCase().includes(q) ||
				entryKeyOf(it.entry).toLowerCase().includes(q) ||
				String(it.entry.id).toLowerCase().includes(q),
		);
	}, [allItems, query]);

	return (
		<div className="panel-body conn-panel">
			{/* 上半区：独立渠道列表（点击添加、查看配置文件或修改在右侧扩出） */}
			<section className="sp-section conn-block">
				<div className="conn-head-row">
					<span className="conn-section-label">{t("已配置渠道")}（{activeProviders.length}）</span>
					<div className="conn-head-actions">
						<button
							type="button"
							className={`rc-btn ${activeTarget?.kind === "file" ? "rc-btn-active" : ""}`}
							onClick={() => setTarget(activeTarget?.kind === "file" ? null : { kind: "file" })}
						>
							{t("配置文件")}
						</button>
						<button
							type="button"
							className={`rc-btn rc-btn-primary ${activeTarget?.kind === "gen" ? "rc-btn-active" : ""}`}
							onClick={() => setTarget(activeTarget?.kind === "gen" ? null : { kind: "gen" })}
						>
							{t("＋ 添加渠道")}
						</button>
					</div>
				</div>
				<PanelStatus loading={agentCfg.loading} error={agentCfg.error} hasData={!!agentCfg.data} />
				{activeProviders.length === 0 && (
					<div className="sp-empty">{t("暂无渠道 — 点击右上角「＋ 添加渠道」创建")}</div>
				)}
				<div className="conn-channel-list">
					{activeProviders.map((pname) => {
						const prov = activeConfig.providers?.[pname];
						const mcount = Array.isArray(prov?.models) ? prov.models.length : 0;
						const editing = activeTarget?.kind === "edit" && activeTarget.id === pname;
						return (
							<div
								key={pname}
								className={`conn-card ${editing ? "selected" : ""}`}
							>
								<div className="conn-wh-row">
									<button
										type="button"
										className="conn-wh-main"
										onClick={() => setTarget(editing ? null : { kind: "edit", id: pname })}
									>
										<span className="conn-wh-name">{pname}</span>
										<span className="lore-meta">{t("{n} 个模型", { n: mcount })}</span>
									</button>
									<span className="conn-wh-acts" onClick={(e) => e.stopPropagation()}>
										<button
											type="button"
											className="act"
											disabled={busy}
											onClick={() => setTarget(editing ? null : { kind: "edit", id: pname })}
										>
											{editing ? t("收起") : t("修改")}
										</button>
										<ConfirmButton
											className="act"
											disabled={busy}
											confirmText={t("确认删除")}
											onConfirm={() => void deleteChannel(pname)}
										>
											{t("删除")}
										</ConfirmButton>
									</span>
								</div>
							</div>
						);
					})}
				</div>
			</section>

			{/* 下半区：所有模型（无选中勾，点击整行直接在右侧展开模型详情） */}
			<section className="sp-section conn-block">
				<div className="conn-head-row">
					<span className="conn-section-label">{t("所有模型")}（{allItems.length}）</span>
				</div>
				<SearchInput value={query} onChange={setQuery} placeholder={t("搜索渠道或模型…")} />
				<PanelStatus loading={modelsData.loading} error={modelsData.error} hasData={!!modelsData.data} />
				{filteredItems.length === 0 ? (
					<div className="sp-empty">{t("尚未配置渠道 — 在上方添加渠道")}</div>
				) : (
					<div className="wb-panel-model-list">
						{filteredItems.map((it) => {
							const pk = it.provider;
							const entry = it.entry;
							const key = entryKeyOf(entry);
							const isSide = sideEntry?.provider === pk && sideEntry?.entry === key;
							const inspecting =
								activeTarget?.kind === "model" &&
								activeTarget.provider === pk &&
								activeTarget.entryKey === key;

							return (
								<button
									key={`${pk}/${it.entryIndex}/${key}`}
									type="button"
									className={`wb-panel-model-row wb-panel-model-btn ${inspecting ? "focused" : ""}`}
									onClick={() =>
										setTarget(
											inspecting ? null : { kind: "model", provider: pk, entryKey: key },
										)
									}
								>
									<span className="wb-model-row-name">{key}</span>
									{isSide && <span className="wb-model-side-tag">{t("旁路")}</span>}
									<span className="wb-model-row-prov">{pk}</span>
									<IconChevronRight size={14} className="wb-panel-model-caret" />
								</button>
							);
						})}
					</div>
				)}
			</section>
		</div>
	);
}
