/**
 * 「提示词」面板（docs/PLAN-AGENT-SLOTS.md §七，2026-09-08 用户定名与分栏）：
 * - 全局系统提示词：SYSTEM.md（梨园扮演骨架，改后重启生效）+ APPEND_SYSTEM.md
 *   （全局，对所有卡生效——角色相当于原来的预设）+ AGENT_APPEND_SYSTEM.md（同一格的
 *   agent 模式版：扮演轮读前者，agent 轮读后者，二选一）
 * - 局部提示词：这张卡的 AGENTS.md（卡档案）+ 这张卡的 APPEND_SYSTEM.md
 * - 预设库（2026-09-12 用户定序）：导入原样复现 →「装载」设为活动预设 → 块开关拨选项
 *   （人称/基调/文风就是块的 enabled）。**装载即转译、拨开关即转译**：服务端按开关编译、
 *   分流成逐块（预设）条目落进这张卡的提示词文件，没有手动转译；卸载即剥净。
 * - 2026-09-14：① 预设库列表每行可展开块开关（不必装载即可编辑原版——活动预设进草稿，
 *   其余直接写文件），块编辑入口从「活动预设」栏挪进库列表行；② 机制按预设自选——
 *   快速处理（默认：分类照搬，30 秒级）｜深度处理（模型重组，分钟级，产物两条）。
 * - 条目来源标注：标题后缀 `（预设）` / `（世界书·书名）` 是数据（src/prompt-entries.ts），
 *   界面只挂徽标；来源书已卸载的条目标出来（送模时已不送，文件未动）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiGetCacheClear,
	apiPost,
	apiPut,
	downloadJson,
	type CardAgentsResponse,
	type CardAgentsSaveResponse,
	type PresetBlockPatch,
	type PresetBlockView,
	type PresetBlocksResponse,
	type PresetResponse,
	type PresetsResponse,
	type RulesResponse,
	type RulesSaveResponse,
} from "../api.ts";
import { renderMarkdown } from "./ArtifactPanel.tsx";
import { IconClose, IconPreset } from "./icons.tsx";
import { bumpWatchPanels, ConfirmButton, PanelStatus, SliderField, Toggle, useAction, usePanelData } from "./kit.tsx";
import { t } from "../i18n/index.ts";
import {
	appendEntry,
	deleteEntry,
	escapeEntryText,
	parsePromptEntries,
	setEntryContent,
	toggleEntry,
	type PromptEntry,
} from "../../../src/prompt-entries.ts";

export type PromptScope = "system" | "global" | "agent" | "btw" | "card" | "agents";

export type PresetEditTarget =
	| {
			kind?: "prompt";
			scope: PromptScope;
			/**
			 * entry = 查看/编辑指定条目（entryName === "" 表示开头无标题段）
			 * full  = 查看/编辑整份文件全文
			 * create = 在该提示词文件下添加新条目
			 */
			mode: "entry" | "full" | "create";
			entryName?: string;
	  }
	| {
			kind: "preset-block";
			file: string;
			presetName: string;
			blockId: string;
	  }
	| {
			kind: "preset-samplers";
			file: string;
			presetName: string;
	  };

interface PromptSlotMeta {
	scope: PromptScope;
	title: () => string;
	file: string;
	effect: "beat" | "restart";
	hint: () => string;
}

const GLOBAL_PROMPT_SLOTS: PromptSlotMeta[] = [
	{
		scope: "system",
		title: () => t("梨园系统提示词"),
		file: "SYSTEM.md", // i18n-ignore
		effect: "restart",
		hint: () => t("梨园底层环境与工作区骨架说明（SYSTEM.md），修改后重启梨园生效。"),
	},
	{
		scope: "global",
		title: () => t("扮演模式系统提示词"),
		file: "APPEND_SYSTEM.md", // i18n-ignore
		effect: "beat",
		hint: () => t("扮演模式全局常驻系统提示词（APPEND_SYSTEM.md），对所有角色卡的扮演会话生效。"),
	},
	{
		scope: "agent",
		title: () => t("写作模式系统提示词"),
		file: "AGENT_APPEND_SYSTEM.md", // i18n-ignore
		effect: "beat",
		hint: () => t("写作模式全局常驻系统提示词（AGENT_APPEND_SYSTEM.md），对所有写作模式项目生效。"),
	},
	{
		scope: "btw",
		title: () => t("助手系统提示词"),
		file: "BTW_APPEND_SYSTEM.md", // i18n-ignore
		effect: "beat",
		hint: () => t("扮演模式旁路助手的系统提示词（BTW_APPEND_SYSTEM.md），与「角色 → 助手」中的身份提示词同步。"),
	},
];

const LOCAL_PROMPT_SLOTS: PromptSlotMeta[] = [
	{
		scope: "card",
		title: () => t("局部系统提示词"),
		file: "APPEND_SYSTEM.md", // i18n-ignore
		effect: "beat",
		hint: () => t("当前角色卡的系统提示词（APPEND_SYSTEM.md），仅对本卡生效；预设转译的身份/破限条目也会落入此处。"),
	},
	{
		scope: "agents",
		title: () => t("提示词"),
		file: "AGENTS.md", // i18n-ignore
		effect: "beat",
		hint: () => t("当前角色卡的常驻提示词档案（AGENTS.md），包含角色设定、预设写作规则与挂载世界书常驻条目。"),
	},
];

const ALL_PROMPT_SLOTS: PromptSlotMeta[] = [...GLOBAL_PROMPT_SLOTS, ...LOCAL_PROMPT_SLOTS];

function contentOfScope(
	rulesData: RulesResponse | null,
	agentsData: CardAgentsResponse | null,
	scope: PromptScope,
): string {
	if (scope === "agents") {
		if (!agentsData) return "";
		return agentsData.content.trim() ? agentsData.content : agentsData.projection;
	}
	if (!rulesData) return "";
	if (scope === "system") return rulesData.system?.content ?? "";
	if (scope === "global") return rulesData.global?.content ?? "";
	if (scope === "agent") return rulesData.agent?.content ?? "";
	if (scope === "btw") return rulesData.btw?.content ?? "";
	return rulesData.card?.content ?? "";
}

const CHANNEL_LABEL: Record<string, string> = {
	system: "历史前", // i18n-ignore：用时 t()
	postHistory: "历史后", // i18n-ignore：用时 t()
};

const SAMPLER_META: Array<{ key: string; min: number; max: number; step: number; hint: string }> = [
	{ key: "temperature", min: 0, max: 2, step: 0.01, hint: "越高越随机发散，越低越确定" }, // i18n-ignore：用时 t()
	{ key: "top_p", min: 0, max: 1, step: 0.01, hint: "核采样：只从累计概率 top_p 的词里选" }, // i18n-ignore：用时 t()
	{ key: "top_k", min: 0, max: 200, step: 1, hint: "只从概率最高的 k 个词里选（0=不限）" }, // i18n-ignore：用时 t()
	{ key: "frequency_penalty", min: -2, max: 2, step: 0.01, hint: "惩罚高频词，抑制复读" }, // i18n-ignore：用时 t()
	{ key: "presence_penalty", min: -2, max: 2, step: 0.01, hint: "惩罚已出现词，鼓励换话题" }, // i18n-ignore：用时 t()
	{ key: "repetition_penalty", min: 1, max: 2, step: 0.01, hint: "重复惩罚（1=不惩罚）" }, // i18n-ignore：用时 t()
	{ key: "min_p", min: 0, max: 1, step: 0.01, hint: "过滤概率低于峰值 min_p 倍的词" }, // i18n-ignore：用时 t()
];

/** 行级对照（投影 vs 文件）：只给「差在哪」的直觉，不追求完整 diff 算法 */
function diffPreview(base: string, mine: string): string {
	const a = base.split("\n");
	const b = mine.split("\n");
	const setA = new Set(a);
	const setB = new Set(b);
	const out: string[] = [];
	for (const l of a) if (!setB.has(l)) out.push(`- ${l.slice(0, 120)}`);
	for (const l of b) if (!setA.has(l)) out.push(`+ ${l.slice(0, 120)}`);
	if (out.length === 0) return t("（与投影无差异）");
	return out.slice(0, 80).join("\n") + (out.length > 80 ? `\n${t("… 共 {n} 行差异", { n: out.length })}` : "");
}

/** 条目来源徽标：只认标题后缀这一个协议（PromptEntry.source），不搜正文措辞。带来源的条目由服务端同步持有 */
function SourceBadge({ entry }: { entry: PromptEntry }) {
	const s = entry.source;
	if (!s) return null;
	if (s.kind === "preset") return <span className="preset-src-badge preset" title={t("预设转译条目：随预设装载/开关自动更新")}>{t("预设")}</span>;
	return (
		<span className="preset-src-badge lore" title={t("挂载书常驻条目的镜像：挂上就有、卸下就没、书改了跟着改")}>
			{t("世界书·{book}", { book: s.book })}
		</span>
	);
}

export function PresetPanel({
	toast,
	editorTarget = null,
	onChangeEditorTarget,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	editorTarget?: PresetEditTarget | null;
	onChangeEditorTarget?: (target: PresetEditTarget | null) => void;
}) {
	const files = usePanelData(() => apiGet<PresetsResponse>("/api/presets"), { cacheKey: "/api/presets", watchAgent: true });
	const rules = usePanelData(() => apiGet<RulesResponse>("/api/rules"), { cacheKey: "/api/rules", watchAgent: true, watchPanels: true });
	const agents = usePanelData(() => apiGet<CardAgentsResponse>("/api/card-agents"), { cacheKey: "/api/card-agents", watchAgent: true });
	const { busy, run } = useAction(toast);

	const [tab, setTab] = useState<"global" | "local" | "library">("global");
	const [showDiff, setShowDiff] = useState(false);
	const [openScopes, setOpenScopes] = useState<Record<PromptScope, boolean>>({
		system: false,
		global: false,
		agent: false,
		btw: false,
		card: false,
		agents: false,
	});
	const [openAgentsCats, setOpenAgentsCats] = useState<Record<"preset" | "lorebook" | "custom", boolean>>({
		preset: false,
		lorebook: false,
		custom: false,
	});

	const saveScopeContent = useCallback(
		async (scope: PromptScope, content: string) => {
			if (scope === "agents") {
				const r = await apiPut<CardAgentsSaveResponse>("/api/card-agents", { content });
				toast("info", t("卡档案已保存（{n} 字），下一拍生效", { n: r.chars.toLocaleString() }));
				apiGetCacheClear("/api/presets");
				apiGetCacheClear("/api/preset");
				apiGetCacheClear("/api/lorebook");
				files.reload();
				agents.reload();
				bumpWatchPanels();
				return;
			}
			const r = await apiPut<RulesSaveResponse>("/api/rules", { scope, content });
			if (scope === "system") {
				toast("info", t("SYSTEM.md 已保存（{n} 字）——重启梨园后生效", { n: r.chars.toLocaleString() }));
			} else {
				toast("info", t("已保存（{n} 字），下一拍生效", { n: r.chars.toLocaleString() }));
			}
			if (scope === "card") {
				apiGetCacheClear("/api/presets");
				apiGetCacheClear("/api/preset");
				files.reload();
			}
			rules.reload();
			bumpWatchPanels();
		},
		[toast, rules, agents, files],
	);

	const togglePromptEntry = (scope: PromptScope, rawText: string, entryName: string, enabled: boolean) =>
		run(async () => {
			const next = toggleEntry(rawText, entryName, enabled);
			if (next === null) return;
			await saveScopeContent(scope, next);
		});

	const toggleScopeAccordion = (slot: PromptSlotMeta, entries: PromptEntry[]) => {
		const willOpen = !openScopes[slot.scope];
		setOpenScopes((prev) => ({ ...prev, [slot.scope]: willOpen }));
		// 若该文件只有单段无标题正文（如 SYSTEM.md），展开时同步在右侧展开编辑器，免去二次点击
		if (willOpen && entries.length <= 1 && (!entries[0] || !entries[0].name)) {
			onChangeEditorTarget?.({
				scope: slot.scope,
				mode: entries.length === 1 ? "entry" : "full",
				entryName: entries[0]?.name ?? "",
			});
		}
	};

	// ---------------- 预设库：装载 / 保存（2026-09-14 用户定序：先编辑原版，再装载处理） ----------------

	/** 装载：设为活动预设（config.preset）——服务端随即按开关转译进这张卡的提示词文件（首次约 30 秒，问一次模型）。
	 *  重新装载（活动预设）：丢弃草稿与这份预设的声明缓存，全部重问一次模型后重落条目。 */
	const loadPreset = (file: string, redeclare = false) =>
		run(async () => {
			await apiPost("/api/presets/select", { file, ...(redeclare ? { redeclare: true } : {}) });
			toast(
				"info",
				redeclare
					? t("已重新装载——重问一次模型（约 30 秒）后落新条目")
					: t("已装载并转译——在上方预设库里展开该预设拨开关即自动更新"),
			);
			files.reload();
			rules.reload();
			agents.reload();
		});

	/** 卸载：不再使用活动预设（文件保留在库里；卡文件里的预设条目由服务端剥净） */
	const unloadPreset = () =>
		run(async () => {
			await apiPost("/api/presets/select", { file: null });
			toast("info", t("已卸载——预设文件保留在库里"));
			if (editorTarget?.kind === "preset-samplers") onChangeEditorTarget?.(null);
			files.reload();
			rules.reload();
			agents.reload();
			bumpWatchPanels();
		});

	// ---------------- 库内任意预设：不装载也能展开拨开关（2026-09-14 用户点名） ----------------

	type BlockRow = PresetBlockView & { content: string };
	const [openFile, setOpenFile] = useState<string | null>(null);
	const [renamingFile, setRenamingFile] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [blockDetails, setBlockDetails] = useState<Record<string, { dirty: boolean; blocks: BlockRow[] } | undefined>>({});
	const blockPatchQueue = useRef<Map<string, Map<string, boolean>>>(new Map());
	const blockPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const loadBlocks = useCallback(async (file: string) => {
		try {
			const r = await apiGet<PresetBlocksResponse>(`/api/presets/blocks?file=${encodeURIComponent(file)}`);
			setBlockDetails((prev) => ({
				...prev,
				[file]: {
					dirty: r.dirty,
					blocks: r.blocks.map((b) => ({ ...b, marker: b.marker === true, content: b.content ?? "" })),
				},
			}));
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	}, [toast]);

	const expandPreset = (file: string) => {
		if (openFile === file) {
			setOpenFile(null);
			return;
		}
		setOpenFile(file);
		void loadBlocks(file);
	};

	/** 拨开关：本地即时反馈＋280ms 合并写回。活动预设进草稿并即时重转译（刷新局部提示词）；其余直接写原版文件 */
	const toggleLibraryBlock = (file: string, id: string, enabled: boolean) => {
		setBlockDetails((prev) => {
			const cur = prev[file];
			if (!cur) return prev;
			return { ...prev, [file]: { ...cur, blocks: cur.blocks.map((b) => (b.id === id ? { ...b, enabled } : b)) } };
		});
		const m = blockPatchQueue.current.get(file) ?? new Map<string, boolean>();
		m.set(id, enabled);
		blockPatchQueue.current.set(file, m);
		if (blockPatchTimer.current) clearTimeout(blockPatchTimer.current);
		blockPatchTimer.current = setTimeout(() => {
			const batch = [...blockPatchQueue.current.entries()].map(([file, m]) => ({
				file,
				blocks: [...m.entries()].map(([id, enabled]) => ({ id, enabled })),
			}));
			blockPatchQueue.current.clear();
			for (const b of batch) {
				void apiPut("/api/presets/blocks", b)
					.then(() => {
						if (b.file === activeFile) {
							setDirty(true);
							rules.reload();
							agents.reload();
						}
						bumpWatchPanels();
					})
					.catch((e) => toast("error", e instanceof Error ? e.message : String(e)));
			}
		}, 280);
	};

	/** 卡档案（刀3）：删除回投影 */
	const deleteAgents = () =>
		run(async () => {
			await apiDelete("/api/card-agents");
			toast("info", t("已删除卡档案——回到自动投影"));
			if (editorTarget && editorTarget.kind !== "preset-block" && editorTarget.kind !== "preset-samplers" && editorTarget.scope === "agents") {
				onChangeEditorTarget?.(null);
			}
			agents.reload();
			bumpWatchPanels();
		});

	// ---------------- 活动预设草稿状态 ----------------

	type FullPresetResponse = PresetResponse & {
		dirty?: boolean;
		preset: { name: string; samplers: Record<string, number>; blocks: Array<PresetBlockView & { content?: string }> } | null;
	};
	const PRESET_FULL_PATH = "/api/preset?full=1&working=1";

	const [dirty, setDirty] = useState(false);
	const [missing, setMissing] = useState<string | undefined>();
	const activeFile = files.data?.active ?? null;

	const loadFromDisk = useCallback(async () => {
		try {
			const r = await apiGet<FullPresetResponse>(PRESET_FULL_PATH);
			setMissing(r.missing);
			setDirty(r.dirty === true);
		} catch {
			// ignore
		}
	}, []);

	useEffect(() => {
		if (files.data === null) return;
		if (activeFile) void loadFromDisk();
		else {
			setDirty(false);
			setMissing(undefined);
		}
		if (openFile) void loadBlocks(openFile);
	}, [activeFile, files.data, loadFromDisk, openFile, loadBlocks]);

	const saveToDisk = () =>
		run(async () => {
			await apiPost("/api/preset/save", {});
			setDirty(false);
			files.reload();
			if (openFile) void loadBlocks(openFile);
			bumpWatchPanels();
		}, t("预设已保存到文件"));

	const revertDraft = () =>
		run(async () => {
			await apiPost("/api/preset/revert", {});
			await loadFromDisk();
			if (openFile) void loadBlocks(openFile);
			bumpWatchPanels();
		}, t("已恢复为文件中的版本"));

	const doImport = async (file: File) => {
		try {
			const json = JSON.parse(await file.text()) as Record<string, unknown>;
			const r = await apiPost<{ file: string; kind: "st" | "rp"; blockCount: number; enabledCount: number }>(
				"/api/presets/import",
				{ name: file.name.replace(/\.json$/i, ""), json },
			);
			toast("info", t("已导入预设库（{blocks} 条 · 启用 {enabled}）——已设为活动预设并转译", { blocks: r.blockCount, enabled: r.enabledCount }));
			files.reload();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const doExport = async (file: string) => {
		try {
			const r = await apiGet<{ name: string; json: unknown }>(`/api/presets/export?file=${encodeURIComponent(file)}`);
			downloadJson(`${r.name}.json`, r.json);
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const removePreset = (file: string) =>
		run(async () => {
			await apiDelete(`/api/presets?file=${encodeURIComponent(file)}`);
			if (openFile === file) setOpenFile(null);
			if (
				(editorTarget?.kind === "preset-block" || editorTarget?.kind === "preset-samplers") &&
				editorTarget.file === file
			) {
				onChangeEditorTarget?.(null);
			}
			files.reload();
		}, t("已从预设库删除"));

	const submitRenamePreset = (file: string) => {
		const nextName = renameValue.trim();
		if (!nextName) return;
		void run(async () => {
			const r = await apiPost<{ ok: boolean; file: string }>("/api/presets/rename", {
				file,
				name: nextName,
			});
			setRenamingFile(null);
			if (r.file && r.file !== file) {
				setBlockDetails((prev) => {
					const cur = prev[file];
					if (!cur) return prev;
					const copy = { ...prev, [r.file]: cur };
					delete copy[file];
					return copy;
				});
				if (openFile === file) setOpenFile(r.file);
				if (
					(editorTarget?.kind === "preset-block" || editorTarget?.kind === "preset-samplers") &&
					editorTarget.file === file
				) {
					onChangeEditorTarget?.({ ...editorTarget, file: r.file, presetName: nextName });
				}
			}
			files.reload();
			rules.reload();
			agents.reload();
			bumpWatchPanels();
		}, t("已重命名预设"));
	};

	const renderEntryRow = (
		slot: PromptSlotMeta,
		rawText: string,
		entries: PromptEntry[],
		e: PromptEntry,
		hidePresetBadge = false,
	) => {
		const isSelected =
			editorTarget !== null &&
			editorTarget.kind !== "preset-block" &&
			editorTarget.kind !== "preset-samplers" &&
			editorTarget.scope === slot.scope &&
			editorTarget.mode === "entry" &&
			editorTarget.entryName === e.name;
		const entryLabel = e.title || (entries.length === 1 ? slot.title() : t("（开头）"));
		return (
			<div
				key={e.name || "__preamble__"}
				className={`lore-item preset-block global-entry-row ${e.enabled ? "" : "off"} ${isSelected ? "active open" : ""}`}
			>
				<div className="lore-head">
					<button
						type="button"
						className="preset-block-toggle"
						aria-pressed={isSelected}
						onClick={() =>
							onChangeEditorTarget?.(
								isSelected
									? null
									: {
											scope: slot.scope,
											mode: "entry",
											entryName: e.name,
										},
							)
						}
					>
						<div className="block-info">
							<span className="lore-title">{entryLabel}</span>
							{!(hidePresetBadge && e.source?.kind === "preset") && <SourceBadge entry={e} />}
							<span className="lore-meta">
								{e.name
									? t("{n} 字 · {state}", {
											n: e.content.length.toLocaleString(),
											state: e.enabled ? t("开") : t("关"),
										})
									: t("{n} 字", {
											n: e.content.length.toLocaleString(),
										})}
							</span>
						</div>
					</button>
					{e.name !== "" && (
						<div className="preset-block-acts">
							<Toggle
								checked={e.enabled}
								disabled={busy}
								onChange={(v) => void togglePromptEntry(slot.scope, rawText, e.name, v)}
							/>
						</div>
					)}
				</div>
			</div>
		);
	};

	const renderPromptSlot = (slot: PromptSlotMeta) => {
		const rawText = contentOfScope(rules.data, agents.data, slot.scope);
		const entries = parsePromptEntries(rawText);
		const isOpen = openScopes[slot.scope];
		const isPromptTarget =
			editorTarget !== null &&
			editorTarget.kind !== "preset-block" &&
			editorTarget.kind !== "preset-samplers" &&
			editorTarget.scope === slot.scope;
		const isFullSelected = isPromptTarget && editorTarget.mode === "full";
		const isCreateSelected = isPromptTarget && editorTarget.mode === "create";
		const isProjection = slot.scope === "agents" && agents.data?.active === "projection";
		return (
			<div
				key={slot.scope}
				className={`lore-item preset-block global-prompt-group ${isOpen ? "open" : ""}`}
			>
				<div className="lore-head global-prompt-head">
					<button
						type="button"
						className="preset-block-toggle"
						aria-expanded={isOpen}
						onClick={() => toggleScopeAccordion(slot, entries)}
					>
						<span className={`group-caret ${isOpen ? "open" : ""}`}>▸</span>
						<div className="block-info">
							<span className="lore-title">{slot.title()}</span>
							<span className="preset-src-badge">{slot.file}</span>
							{isProjection && <span className="preset-src-badge">{t("投影")}</span>}
							<span className="lore-meta">
								{entries.length > 1
									? t("{count} 条 · {n} 字", {
											count: entries.length,
											n: rawText.length.toLocaleString(),
										})
									: t("{n} 字", { n: rawText.length.toLocaleString() })}
							</span>
						</div>
					</button>
					<div className="preset-block-acts">
						<button
							type="button"
							className={`act ${isFullSelected ? "active" : ""}`}
							title={t("在右侧展开整份文件查看或编辑")}
							onClick={() =>
								onChangeEditorTarget?.(
									isFullSelected ? null : { scope: slot.scope, mode: "full" },
								)
							}
						>
							{t("全文")}
						</button>
					</div>
				</div>
				{isOpen && (
					<div className="preset-block-body global-prompt-entries">
						<div className="field-hint" style={{ marginBottom: 6 }}>
							{slot.hint()}
						</div>
						{isProjection && (
							<div className="field-hint" style={{ marginBottom: 6 }}>
								{t("还没有卡档案——当前卡内容以自动投影提供。")}
							</div>
						)}
						{slot.scope === "agents" ? (
							<div className="agents-subcat-list">
								{(
									[
										{
											key: "preset" as const,
											label: t("预设"),
											items: entries.filter((e) => e.source?.kind === "preset"),
											emptyHint: t("暂无预设转译条目。"),
										},
										{
											key: "lorebook" as const,
											label: t("世界书"),
											items: entries.filter((e) => e.source?.kind === "lorebook"),
											emptyHint: t("暂无挂载世界书常驻条目。"),
										},
										{
											key: "custom" as const,
											label: t("自定义"),
											items: entries.filter((e) => !e.source),
											emptyHint: t("暂无自定义条目，点击下方「＋ 添加条目」编写。"),
										},
									]
								).map((cat) => {
									const catOpen = openAgentsCats[cat.key];
									const catChars = cat.items.reduce((sum, item) => sum + item.content.length, 0);
									return (
										<div
											key={cat.key}
											className={`lore-item preset-block agents-subcat-group ${catOpen ? "open" : ""}`}
										>
											<div className="lore-head agents-subcat-head">
												<button
													type="button"
													className="preset-block-toggle"
													aria-expanded={catOpen}
													onClick={() =>
														setOpenAgentsCats((prev) => ({
															...prev,
															[cat.key]: !prev[cat.key],
														}))
													}
												>
													<span className={`group-caret ${catOpen ? "open" : ""}`}>▸</span>
													<div className="block-info">
														<span className="lore-title">{cat.label}</span>
														<span className="lore-meta">
															{t("{count} 条 · {n} 字", {
																count: cat.items.length,
																n: catChars.toLocaleString(),
															})}
														</span>
													</div>
												</button>
											</div>
											{catOpen && (
												<div className="preset-block-body agents-subcat-entries">
													{cat.items.length === 0 ? (
														<div className="sp-empty">{cat.emptyHint}</div>
													) : (
														cat.items.map((e) =>
															renderEntryRow(slot, rawText, entries, e, cat.key === "preset"),
														)
													)}
												</div>
											)}
										</div>
									);
								})}
							</div>
						) : (
							<>
								{entries.length === 0 && (
									<div className="sp-empty">{t("暂无条目，点击下方「＋ 添加条目」或右上角「全文」编写。")}</div>
								)}
								{entries.map((e) => renderEntryRow(slot, rawText, entries, e))}
							</>
						)}
						<div className="panel-row" style={{ marginTop: 6 }}>
							<button
								type="button"
								className={`act ${isCreateSelected ? "active" : ""}`}
								disabled={busy}
								onClick={() => {
									if (slot.scope === "agents") {
										setOpenAgentsCats((prev) => ({ ...prev, custom: true }));
									}
									onChangeEditorTarget?.({
										scope: slot.scope,
										mode: "create",
									});
								}}
							>
								{t("＋ 添加条目")}
							</button>
							{slot.scope === "agents" && agents.data && (
								<>
									<button type="button" className="act" disabled={busy} onClick={() => setShowDiff((v) => !v)}>
										{showDiff ? t("收起对照") : t("对照投影")}
									</button>
									{agents.data.exists && (
										<ConfirmButton
											className="act preset-del-btn"
											disabled={busy}
											confirmText={t("确认删除（回到投影）")}
											onConfirm={() => void deleteAgents()}
										>
											{t("删除")}
										</ConfirmButton>
									)}
								</>
							)}
						</div>
						{slot.scope === "agents" && showDiff && agents.data && (
							<pre className="field-hint" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", marginTop: 6 }}>
								{diffPreview(agents.data.projection, agents.data.content || agents.data.projection)}
							</pre>
						)}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="panel-body">
			<div className="preset-tabs" role="tablist">
				<button
					type="button"
					role="tab"
					aria-selected={tab === "global"}
					className={`preset-tab ${tab === "global" ? "active" : ""}`}
					onClick={() => {
						if (
							editorTarget &&
							(editorTarget.kind === "preset-block" ||
								editorTarget.kind === "preset-samplers" ||
								!GLOBAL_PROMPT_SLOTS.some((s) => s.scope === editorTarget.scope))
						) {
							onChangeEditorTarget?.(null);
						}
						setTab("global");
					}}
				>
					{t("全局系统提示词")}
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "local"}
					className={`preset-tab ${tab === "local" ? "active" : ""}`}
					onClick={() => {
						if (
							editorTarget &&
							(editorTarget.kind === "preset-block" ||
								editorTarget.kind === "preset-samplers" ||
								!LOCAL_PROMPT_SLOTS.some((s) => s.scope === editorTarget.scope))
						) {
							onChangeEditorTarget?.(null);
						}
						setTab("local");
					}}
				>
					{t("局部提示词")}
					{agents.data?.active === "projection" ? <span className="preset-tab-count">{t("投影")}</span> : null}
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={tab === "library"}
					className={`preset-tab ${tab === "library" ? "active" : ""}`}
					onClick={() => {
						if (editorTarget && editorTarget.kind !== "preset-block" && editorTarget.kind !== "preset-samplers") {
							onChangeEditorTarget?.(null);
						}
						setTab("library");
					}}
				>
					{t("预设库")}
					{activeFile ? <span className="preset-tab-count">{t("已装载")}</span> : null}
				</button>
			</div>

			{tab === "global" && (
				<>
					<PanelStatus loading={rules.loading} error={rules.error} hasData={!!rules.data} />
					{rules.data && (
						<div className="global-prompt-list">
							{GLOBAL_PROMPT_SLOTS.map((slot) => renderPromptSlot(slot))}
						</div>
					)}
				</>
			)}

			{tab === "local" && (
				<>
					<PanelStatus
						loading={rules.loading || agents.loading}
						error={rules.error || agents.error}
						hasData={Boolean(rules.data && agents.data)}
					/>
					{rules.data && agents.data && (
						<div className="global-prompt-list">
							{LOCAL_PROMPT_SLOTS.map((slot) => renderPromptSlot(slot))}
						</div>
					)}
				</>
			)}

			{tab === "library" && (
				<>
					<section className="sp-section">
						<div className="preset-chan-head">
							<h4>{t("预设库")}</h4>
							<label className="drawer-btn" title={t("导入酒馆预设 JSON（原文存档，导入后自动装载）")}>
								{t("导入")}
								<input
									type="file"
									accept=".json,application/json"
									hidden
									onChange={(e) => {
										const f = e.target.files?.[0];
										if (f) void doImport(f);
										e.target.value = "";
									}}
								/>
							</label>
						</div>
						<PanelStatus loading={files.loading} error={files.error} hasData={!!files.data} />
						<div className="global-prompt-list">
							{files.data?.presets.map((p) => {
								const isActive = activeFile === p.file;
								const detail = blockDetails[p.file];
								const isExpanded = openFile === p.file;
								const isDirtyPreset = Boolean((isActive && dirty) || detail?.dirty);
								const isSamplersSelected =
									editorTarget?.kind === "preset-samplers" && editorTarget.file === p.file;
								const visibleBlocks = detail ? detail.blocks.filter((b) => !b.marker) : [];
								return (
									<div
										key={p.file}
										className={`lore-item preset-block global-prompt-group ${isExpanded ? "open" : ""}`}
									>
										<div className="lore-head global-prompt-head">
											<button
												type="button"
												className="preset-block-toggle"
												aria-expanded={isExpanded}
												title={t("展开块开关（不必装载即可编辑原版）")}
												onClick={() => expandPreset(p.file)}
											>
												<span className={`group-caret ${isExpanded ? "open" : ""}`}>▸</span>
												<div className="block-info">
													<span className="lore-title">{p.name}</span>
													{isActive && <span className="preset-src-badge preset">{t("活动预设")}</span>}
													{detail && (
														<span className="lore-meta">
															{t("{count} 条", { count: visibleBlocks.length })}
														</span>
													)}
												</div>
											</button>
											<div className="preset-block-acts">
												<button
													type="button"
													className="act"
													disabled={busy}
													title={
														isActive
															? t("丢弃草稿与声明缓存，重新编译并重问一次模型（约 30 秒）")
															: undefined
													}
													onClick={() => void loadPreset(p.file, isActive)}
												>
													{isActive ? t("重新装载") : t("装载")}
												</button>
												{isActive && (
													<ConfirmButton
														className="act"
														disabled={busy}
														confirmText={t("确认卸载（卡文件里的预设条目一并移除，预设文件保留）")}
														onConfirm={() => void unloadPreset()}
													>
														{t("卸载")}
													</ConfirmButton>
												)}
											</div>
										</div>
										{isExpanded && (
											<div className="preset-block-body global-prompt-entries">
												<div className="panel-row" style={{ marginBottom: 4 }}>
													{isActive && (
														<>
															<button
																type="button"
																className="act"
																disabled={busy || !isDirtyPreset}
																title={t("把未落盘的改动写回预设文件")}
																onClick={() => void saveToDisk()}
															>
																{isDirtyPreset ? t("保存 *") : t("保存")}
															</button>
															<button
																type="button"
																className="act"
																disabled={busy || !isDirtyPreset}
																onClick={() => void revertDraft()}
															>
																{t("还原")}
															</button>
															<button
																type="button"
																className={`act ${isSamplersSelected ? "active" : ""}`}
																disabled={busy}
																onClick={() =>
																	onChangeEditorTarget?.(
																		isSamplersSelected
																			? null
																			: {
																					kind: "preset-samplers",
																					file: p.file,
																					presetName: p.name,
																				},
																	)
																}
															>
																{t("采样参数")}
															</button>
														</>
													)}
													<button
														type="button"
														className={`act ${renamingFile === p.file ? "active" : ""}`}
														disabled={busy}
														onClick={() => {
															if (renamingFile === p.file) {
																setRenamingFile(null);
															} else {
																setRenamingFile(p.file);
																setRenameValue(p.name);
															}
														}}
													>
														{t("重命名")}
													</button>
													<button type="button" className="act" disabled={busy} onClick={() => void doExport(p.file)}>
														{t("导出")}
													</button>
													<ConfirmButton
														className="act preset-del-btn"
														disabled={busy}
														confirmText={t("确认删除")}
														onConfirm={() => void removePreset(p.file)}
													>
														{t("删除")}
													</ConfirmButton>
												</div>
												{renamingFile === p.file && (
													<div className="panel-row" style={{ marginBottom: 6 }}>
														<input
															className="panel-search"
															style={{ flex: 1, minWidth: 0 }}
															value={renameValue}
															disabled={busy}
															autoFocus
															placeholder={t("输入新预设名…")}
															onChange={(ev) => setRenameValue(ev.target.value)}
															onKeyDown={(ev) => {
																if (ev.key === "Enter") submitRenamePreset(p.file);
																if (ev.key === "Escape") setRenamingFile(null);
															}}
														/>
														<button
															type="button"
															className="act"
															disabled={busy || !renameValue.trim() || renameValue.trim() === p.name}
															onClick={() => submitRenamePreset(p.file)}
														>
															{t("确定")}
														</button>
														<button
															type="button"
															className="act"
															disabled={busy}
															onClick={() => setRenamingFile(null)}
														>
															{t("取消")}
														</button>
													</div>
												)}
												{!detail && <div className="field-hint">{t("读取中…")}</div>}
												{detail && (
													<>
														{isDirtyPreset && (
															<div className="field-hint preset-dirty-hint">
																{t("有未保存修改：已转译、已用于对话；点「保存」写回预设文件。")}
															</div>
														)}
														{visibleBlocks.length === 0 && (
															<div className="sp-empty">{t("该预设没有可拨的块。")}</div>
														)}
														{visibleBlocks.map((b) => {
															const isSelected =
																editorTarget?.kind === "preset-block" &&
																editorTarget.file === p.file &&
																editorTarget.blockId === b.id;
															return (
																<div
																	key={b.id}
																	className={`lore-item preset-block global-entry-row ${b.enabled ? "" : "off"} ${isSelected ? "active open" : ""}`}
																>
																	<div className="lore-head">
																		<button
																			type="button"
																			className="preset-block-toggle"
																			aria-pressed={isSelected}
																			onClick={() =>
																				onChangeEditorTarget?.(
																					isSelected
																						? null
																						: {
																								kind: "preset-block",
																								file: p.file,
																								presetName: p.name,
																								blockId: b.id,
																							},
																				)
																			}
																		>
																			<div className="block-info">
																				<span className="lore-title">{b.name || b.id}</span>
																				<span className="lore-meta">
																					{t("{n} 字 · {channel}", {
																						n: b.content.length.toLocaleString(),
																						channel: CHANNEL_LABEL[b.channel] ? t(CHANNEL_LABEL[b.channel]) : b.channel,
																					})}
																					{b.depth !== undefined ? t(" · 深度{depth}", { depth: b.depth }) : ""}
																				</span>
																			</div>
																		</button>
																		<div className="preset-block-acts">
																			<Toggle
																				checked={b.enabled}
																				disabled={busy}
																				onChange={(v) => toggleLibraryBlock(p.file, b.id, v)}
																			/>
																		</div>
																	</div>
																</div>
															);
														})}
														<div className="field-hint">
															{t("拨开关＝编辑这份预设的原版选项：活动预设进草稿（「保存」落盘）并即时重转译；未装载的直接写文件，装载时生效。")}
														</div>
													</>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
						{files.data && files.data.presets.length === 0 && (
							<div className="sp-empty">{t("预设库是空的。")}</div>
						)}
						{missing && <div className="panel-error">{t("配置指向的预设文件不存在：{file}", { file: missing })}</div>}
					</section>
				</>
			)}
		</div>
	);
}

/**
 * 右侧扩出的全局提示词编辑器副栏（420px，与 ConnectEditorPane 同级）：
 * 分两种阅读模式：「观看模式」（Markdown 渲染）与「Markdown 原文」（源码查看与编辑）。
 */
export function PresetEditorPane({
	target,
	onChangeTarget,
	onClose,
	toast,
}: {
	target: PresetEditTarget;
	onChangeTarget: (target: PresetEditTarget | null) => void;
	onClose: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	if (target.kind === "preset-block") {
		return <PresetBlockEditorSubPane target={target} onClose={onClose} toast={toast} />;
	}
	if (target.kind === "preset-samplers") {
		return <PresetSamplersSubPane target={target} onClose={onClose} toast={toast} />;
	}
	return <PromptSlotEditorSubPane target={target} onChangeTarget={onChangeTarget} onClose={onClose} toast={toast} />;
}

function PresetBlockEditorSubPane({
	target,
	onClose,
	toast,
}: {
	target: Extract<PresetEditTarget, { kind: "preset-block" }>;
	onClose: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const blockPath = `/api/presets/blocks?file=${encodeURIComponent(target.file)}`;
	const blocksData = usePanelData(() => apiGet<PresetBlocksResponse>(blockPath), {
		cacheKey: blockPath,
		watchAgent: true,
	});
	const { busy, run } = useAction(toast);

	const block = useMemo(
		() => blocksData.data?.blocks.find((b) => b.id === target.blockId) ?? null,
		[blocksData.data, target.blockId],
	);
	const sourceContent = block?.content ?? "";

	const [viewMode, setViewMode] = useState<"preview" | "raw">("preview");
	const [draft, setDraft] = useState(sourceContent);
	const [dirty, setDirty] = useState(false);

	const targetKey = `${target.file}::${target.blockId}`;
	const lastTargetKey = useRef(targetKey);
	const lastSource = useRef(sourceContent);

	useEffect(() => {
		if (targetKey !== lastTargetKey.current) {
			lastTargetKey.current = targetKey;
			lastSource.current = sourceContent;
			setDraft(sourceContent);
			setDirty(false);
			return;
		}
		if (!dirty && sourceContent !== lastSource.current) {
			setDraft(sourceContent);
		}
		lastSource.current = sourceContent;
	}, [targetKey, sourceContent, dirty]);

	const patchBlock = useCallback(
		async (patch: PresetBlockPatch) => {
			await apiPut("/api/presets/blocks", {
				file: target.file,
				blocks: [patch],
			});
			blocksData.reload();
			bumpWatchPanels();
		},
		[target.file, blocksData],
	);

	const handleSave = useCallback(() => {
		if (!block) return;
		void run(async () => {
			await patchBlock({ id: block.id, content: draft });
			setDirty(false);
		}, t("已保存（{n} 字），下一拍生效", { n: draft.length.toLocaleString() }));
	}, [block, draft, patchBlock, run]);

	const handleToggle = (enabled: boolean) => {
		if (!block) return;
		void run(async () => {
			await patchBlock({ id: block.id, enabled });
		});
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !dirty) {
				onClose();
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				if (!busy && dirty) {
					e.preventDefault();
					handleSave();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, handleSave, dirty, busy]);

	const headerTitle = block?.name || block?.id || target.blockId;
	const channelText = block
		? CHANNEL_LABEL[block.channel]
			? t(CHANNEL_LABEL[block.channel])
			: block.channel
		: "";

	return (
		<aside className="rc-lore-picker conn-editor-sub preset-editor-sub" aria-label={headerTitle}>
			<div className="panel-head rc-lore-picker-head">
				<span className="panel-head-title" title={headerTitle}>
					<IconPreset size={15} />
					<span>{headerTitle}</span>
				</span>
				<span className="panel-head-actions">
					<div className="preset-tabs preset-sub-tabs" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={viewMode === "preview"}
							className={`preset-tab ${viewMode === "preview" ? "active" : ""}`}
							onClick={() => setViewMode("preview")}
						>
							{t("观看模式")}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={viewMode === "raw"}
							className={`preset-tab ${viewMode === "raw" ? "active" : ""}`}
							onClick={() => setViewMode("raw")}
						>
							{t("Markdown 原文")}
						</button>
					</div>
					<button type="button" className="icon-btn" onClick={onClose} title={t("关闭")} aria-label={t("关闭")}>
						<IconClose size={15} />
					</button>
				</span>
			</div>

			<div className="panel-body conn-editor-sub-body preset-editor-sub-body">
				<div className="preset-sub-toolbar">
					<div className="preset-sub-meta">
						<span className="preset-src-badge preset">{target.presetName}</span>
						<span className="field-hint" style={{ margin: 0 }}>
							{block
								? t("{n} 字 · {channel}", {
										n: draft.length.toLocaleString(),
										channel: channelText,
									}) + (block.depth !== undefined ? t(" · 深度{depth}", { depth: block.depth }) : "")
								: t("{n} 字", { n: draft.length.toLocaleString() })}
							{dirty ? t(" · 未保存") : ""}
						</span>
					</div>
					<div className="preset-block-acts">
						{block && (
							<Toggle checked={block.enabled} disabled={busy} onChange={(v) => handleToggle(v)} />
						)}
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={busy || !dirty}
							onClick={handleSave}
						>
							{dirty ? t("保存 *") : t("保存")}
						</button>
					</div>
				</div>

				{viewMode === "preview" ? (
					draft.trim().length > 0 ? (
						<article
							className="chat-asset-readme artifact-md preset-sub-readme"
							onDoubleClick={() => setViewMode("raw")}
						>
							{renderMarkdown(draft)}
						</article>
					) : (
						<div className="chat-asset-empty">
							{t("无正文（求值后零字或 setvar 类块：装配时会被丢弃，开关无效果）")}
						</div>
					)
				) : (
					<textarea
						className="panel-search ta preset-block-ta preset-sub-textarea"
						rows={20}
						spellCheck={false}
						value={draft}
						disabled={busy}
						placeholder={t("写给模型的常驻提示词（markdown）…")}
						onChange={(e) => {
							setDraft(e.target.value);
							setDirty(true);
						}}
					/>
				)}
			</div>
		</aside>
	);
}

function PresetSamplersSubPane({
	target,
	onClose,
	toast,
}: {
	target: Extract<PresetEditTarget, { kind: "preset-samplers" }>;
	onClose: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	type FullPresetResponse = PresetResponse & {
		dirty?: boolean;
		preset: { name: string; samplers: Record<string, number>; blocks: Array<PresetBlockView & { content?: string }> } | null;
	};
	const PRESET_FULL_PATH = "/api/preset?full=1&working=1";
	const presetData = usePanelData(() => apiGet<FullPresetResponse>(PRESET_FULL_PATH), {
		cacheKey: PRESET_FULL_PATH,
		watchAgent: true,
	});
	const { busy, run } = useAction(toast);
	const [samplers, setSamplers] = useState<Record<string, number>>({});
	const [dirty, setDirty] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (presetData.data?.preset) {
			setSamplers({ ...presetData.data.preset.samplers });
			setDirty(presetData.data.dirty === true);
		}
	}, [presetData.data]);

	const patchSampler = (key: string, value: number) => {
		const next = { ...samplers, [key]: value };
		setSamplers(next);
		setDirty(true);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			void apiPut("/api/preset", { blocks: [], samplers: next })
				.then(() => bumpWatchPanels())
				.catch((e) => toast("error", e instanceof Error ? e.message : String(e)));
		}, 280);
	};

	const saveToDisk = () =>
		run(async () => {
			await apiPost("/api/preset/save", {});
			setDirty(false);
			presetData.reload();
			bumpWatchPanels();
		}, t("预设已保存到文件"));

	const headerTitle = `${target.presetName} · ${t("采样参数")}`;

	return (
		<aside className="rc-lore-picker conn-editor-sub preset-editor-sub" aria-label={headerTitle}>
			<div className="panel-head rc-lore-picker-head">
				<span className="panel-head-title" title={headerTitle}>
					<IconPreset size={15} />
					<span>{headerTitle}</span>
				</span>
				<span className="panel-head-actions">
					<button
						type="button"
						className="drawer-btn save-btn"
						disabled={busy || !dirty}
						onClick={() => void saveToDisk()}
					>
						{dirty ? t("保存 *") : t("保存")}
					</button>
					<button type="button" className="icon-btn" onClick={onClose} title={t("关闭")} aria-label={t("关闭")}>
						<IconClose size={15} />
					</button>
				</span>
			</div>
			<div className="panel-body conn-editor-sub-body preset-editor-sub-body">
				<PanelStatus loading={presetData.loading} error={presetData.error} hasData={!!presetData.data} />
				{presetData.data?.preset && (
					<>
						{Object.keys(samplers).length === 0 && (
							<div className="sp-empty">{t("该预设未带采样参数。")}</div>
						)}
						{SAMPLER_META.filter((m) => m.key in samplers).map((m) => (
							<SliderField
								key={m.key}
								label={m.key}
								hint={t(m.hint)}
								value={samplers[m.key]}
								min={m.min}
								max={m.max}
								step={m.step}
								onChange={(nv) => patchSampler(m.key, nv)}
							/>
						))}
					</>
				)}
			</div>
		</aside>
	);
}

function PromptSlotEditorSubPane({
	target,
	onChangeTarget,
	onClose,
	toast,
}: {
	target: Extract<PresetEditTarget, { scope: PromptScope }>;
	onChangeTarget: (target: PresetEditTarget | null) => void;
	onClose: () => void;
	toast: (level: "info" | "warning" | "error", text: string) => void;
}) {
	const rules = usePanelData(() => apiGet<RulesResponse>("/api/rules"), { cacheKey: "/api/rules", watchAgent: true, watchPanels: true });
	const agents = usePanelData(() => apiGet<CardAgentsResponse>("/api/card-agents"), { cacheKey: "/api/card-agents", watchAgent: true });
	const { busy, run } = useAction(toast);

	const slot = ALL_PROMPT_SLOTS.find((s) => s.scope === target.scope) ?? ALL_PROMPT_SLOTS[0];
	const rawFile = contentOfScope(rules.data, agents.data, slot.scope);
	const entries = useMemo(() => parsePromptEntries(rawFile), [rawFile]);

	const entry = useMemo(() => {
		if (target.mode !== "entry") return null;
		const wanted = target.entryName ?? "";
		return entries.find((e) => e.name === wanted) ?? null;
	}, [target.mode, target.entryName, entries]);

	const sourceContent = useMemo(() => {
		if (target.mode === "create") return "";
		if (target.mode === "full") return rawFile;
		if (entry) return entry.content;
		if (!target.entryName && entries.length === 0) return rawFile;
		return "";
	}, [target.mode, target.entryName, rawFile, entry, entries.length]);

	const [viewMode, setViewMode] = useState<"preview" | "raw">(
		target.mode === "create" ? "raw" : "preview",
	);
	const [draft, setDraft] = useState(sourceContent);
	const [dirty, setDirty] = useState(false);
	const [newName, setNewName] = useState("");
	const [createError, setCreateError] = useState<string | null>(null);

	const targetKey = `${target.scope}::${target.mode}::${target.entryName ?? ""}`;
	const lastTargetKey = useRef(targetKey);
	const lastSource = useRef(sourceContent);

	useEffect(() => {
		if (targetKey !== lastTargetKey.current) {
			lastTargetKey.current = targetKey;
			lastSource.current = sourceContent;
			setDraft(sourceContent);
			setDirty(false);
			setNewName("");
			setCreateError(null);
			if (target.mode === "create") setViewMode("raw");
			return;
		}
		if (!dirty && sourceContent !== lastSource.current) {
			setDraft(sourceContent);
		}
		lastSource.current = sourceContent;
	}, [targetKey, sourceContent, dirty, target.mode]);

	const saveRawFile = useCallback(
		async (nextFileText: string) => {
			if (slot.scope === "agents") {
				const r = await apiPut<CardAgentsSaveResponse>("/api/card-agents", {
					content: nextFileText,
				});
				toast("info", t("卡档案已保存（{n} 字），下一拍生效", { n: r.chars.toLocaleString() }));
				apiGetCacheClear("/api/presets");
				apiGetCacheClear("/api/preset");
				apiGetCacheClear("/api/lorebook");
				agents.reload();
				bumpWatchPanels();
				return;
			}
			const r = await apiPut<RulesSaveResponse>("/api/rules", {
				scope: slot.scope,
				content: nextFileText,
			});
			if (slot.effect === "restart") {
				toast("info", t("SYSTEM.md 已保存（{n} 字）——重启梨园后生效", { n: r.chars.toLocaleString() }));
			} else {
				toast("info", t("已保存（{n} 字），下一拍生效", { n: r.chars.toLocaleString() }));
			}
			if (slot.scope === "card") {
				apiGetCacheClear("/api/presets");
				apiGetCacheClear("/api/preset");
			}
			rules.reload();
			bumpWatchPanels();
		},
		[slot.scope, slot.effect, toast, rules, agents],
	);

	const handleSave = useCallback(() => {
		if (target.mode === "create") {
			const name = newName.trim();
			if (!name) return;
			if (entries.some((e) => e.name === name)) {
				setCreateError(t("已有同名条目「{name}」", { name }));
				return;
			}
			const next = appendEntry(rawFile, name, escapeEntryText(draft));
			if (next === null) return;
			void run(async () => {
				await saveRawFile(next);
				setDirty(false);
				setViewMode("preview");
				onChangeTarget({ scope: slot.scope, mode: "entry", entryName: name });
			});
			return;
		}
		if (target.mode === "full" || (!entry?.name && entries.length <= 1)) {
			void run(async () => {
				await saveRawFile(draft);
				setDirty(false);
			});
			return;
		}
		if (!entry) return;
		const next = setEntryContent(rawFile, entry.name, escapeEntryText(draft));
		if (next === null) return;
		void run(async () => {
			await saveRawFile(next);
			setDirty(false);
		});
	}, [target.mode, newName, entries, rawFile, draft, entry, run, saveRawFile, onChangeTarget, slot.scope]);

	const handleToggleEntry = (enabled: boolean) => {
		if (!entry || !entry.name) return;
		const next = toggleEntry(rawFile, entry.name, enabled);
		if (next === null) return;
		void run(async () => {
			await saveRawFile(next);
		});
	};

	const handleDeleteEntry = () => {
		if (!entry || !entry.name) return;
		const next = deleteEntry(rawFile, entry.name);
		if (next === null) return;
		void run(async () => {
			await saveRawFile(next);
			onClose();
		});
	};

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !dirty) {
				onClose();
			} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
				if (!busy && (target.mode === "create" ? Boolean(newName.trim()) : dirty)) {
					e.preventDefault();
					handleSave();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose, handleSave, dirty, busy, target.mode, newName]);

	const headerTitle =
		target.mode === "create"
			? t("添加条目")
			: target.mode === "full"
				? t("{title} · 全文", { title: slot.title() })
				: entry?.title || (entries.length <= 1 ? slot.title() : t("（开头）"));

	const effectNote = slot.effect === "restart" ? t("保存后重启生效") : t("保存后下一拍生效");
	const canSave = target.mode === "create" ? Boolean(newName.trim()) : dirty;
	const previewMd =
		target.mode === "create" && newName.trim()
			? `## ${newName.trim()}\n\n${draft}`
			: draft;

	return (
		<aside className="rc-lore-picker conn-editor-sub preset-editor-sub" aria-label={headerTitle}>
			<div className="panel-head rc-lore-picker-head">
				<span className="panel-head-title" title={headerTitle}>
					<IconPreset size={15} />
					<span>{headerTitle}</span>
				</span>
				<span className="panel-head-actions">
					<div className="preset-tabs preset-sub-tabs" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={viewMode === "preview"}
							className={`preset-tab ${viewMode === "preview" ? "active" : ""}`}
							onClick={() => setViewMode("preview")}
						>
							{t("观看模式")}
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={viewMode === "raw"}
							className={`preset-tab ${viewMode === "raw" ? "active" : ""}`}
							onClick={() => setViewMode("raw")}
						>
							{t("Markdown 原文")}
						</button>
					</div>
					<button
						type="button"
						className="icon-btn"
						onClick={onClose}
						title={t("关闭")}
						aria-label={t("关闭")}
					>
						<IconClose size={15} />
					</button>
				</span>
			</div>

			<div className="panel-body conn-editor-sub-body preset-editor-sub-body">
				<div className="preset-sub-toolbar">
					<div className="preset-sub-meta">
						<span className="preset-src-badge">{slot.file}</span>
						<span className="field-hint" style={{ margin: 0 }}>
							{t("{n} 字", { n: draft.length.toLocaleString() })}
							{dirty ? t(" · 未保存") : ""} · {effectNote}
						</span>
					</div>
					<div className="preset-block-acts">
						{target.mode === "entry" && entry && entry.name !== "" && (
							<>
								<Toggle
									checked={entry.enabled}
									disabled={busy}
									onChange={(v) => handleToggleEntry(v)}
								/>
								<ConfirmButton
									className="act preset-del-btn"
									disabled={busy}
									confirmText={t("确认删除")}
									onConfirm={handleDeleteEntry}
								>
									{t("删除")}
								</ConfirmButton>
							</>
						)}
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={busy || !canSave}
							onClick={handleSave}
						>
							{dirty ? t("保存 *") : t("保存")}
						</button>
					</div>
				</div>

				{target.mode === "create" && (
					<div className="preset-sub-create-head">
						<input
							className="panel-search"
							placeholder={t("条目名（## 小节标题）")}
							value={newName}
							disabled={busy}
							autoFocus
							onChange={(ev) => {
								setNewName(ev.target.value);
								setCreateError(null);
							}}
						/>
						{createError && (
							<div className="field-hint" style={{ color: "var(--danger, #e07a5f)" }}>
								{createError}
							</div>
						)}
					</div>
				)}

				{viewMode === "preview" ? (
					previewMd.trim().length > 0 ? (
						<article
							className="chat-asset-readme artifact-md preset-sub-readme"
							onDoubleClick={() => setViewMode("raw")}
						>
							{renderMarkdown(previewMd)}
						</article>
					) : (
						<div className="chat-asset-empty">{t("暂无内容")}</div>
					)
				) : (
					<textarea
						className="panel-search ta preset-block-ta preset-sub-textarea"
						rows={20}
						spellCheck={false}
						value={draft}
						disabled={busy}
						placeholder={t("写给模型的常驻提示词（markdown）…")}
						onChange={(e) => {
							setDraft(e.target.value);
							setDirty(true);
						}}
					/>
				)}
			</div>
		</aside>
	);
}

