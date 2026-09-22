/**
 * 设置面板：外观（昼夜）+ 世界书扫描 + agent 行为 + 内置向量记忆。
 * 主题立刻生效、只存本机 localStorage，不写 rp.config。
 * 记忆配置写 `.liyuan-memory/config.json`，不必重载 agent。
 */

import { useEffect, useRef, useState } from "react";
import { api, apiGet, apiPut, createBackup, downloadBackup, importBackup, type RpConfigView } from "../api.ts";
import { ConfirmButton, PanelStatus, SliderField, Toggle, useAction, usePanelData } from "./kit.tsx";
import { LocaleSwitch } from "./LocaleSwitch.tsx";
import { t } from "../i18n/index.ts";

type MemoryStoreStats = {
	id: string;
	name: string;
	kind: string;
	enabled: boolean;
	everyNTurns: number;
	chunkCount: number;
	maxChunks: number;
};

type MemoryStatus = {
	config: {
		enabled: boolean;
		searchTopK: number;
		injectOnTurn?: boolean;
		embedMode?: "local" | "cloud";
		cloudEmbed?: { baseUrl: string; apiKey: string; model: string };
		cloudEmbedConfigured?: boolean;
		stores: Array<{ id: string; everyNTurns: number; enabled: boolean }>;
	};
	stores: MemoryStoreStats[];
	/** 当前对话作用域（角色卡 + 会话） */
	scope?: { sessionId: string; card?: string; scopeId: string };
};

type MemoryChunkRow = {
	id: string;
	text: string;
	textLen: number;
	meta?: { source?: string; title?: string; fileName?: string; mergeCount?: number };
	createdAt: string;
};

/** 条目管理列表：刷新 + 单条删除 */
function MemoryChunkManager({
	storeId,
	label,
	enabled,
	busy,
	run,
	toast,
	onChanged,
}: {
	storeId: string;
	label: string;
	enabled: boolean;
	busy: boolean;
	run: (fn: () => Promise<void>, doneText?: string) => Promise<void>;
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onChanged: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [chunks, setChunks] = useState<MemoryChunkRow[]>([]);
	const [loading, setLoading] = useState(false);

	const refresh = async () => {
		setLoading(true);
		try {
			const r = await apiGet<{ chunks: MemoryChunkRow[] }>(
				`/api/memory/chunks?storeId=${encodeURIComponent(storeId)}`,
			);
			setChunks(r.chunks ?? []);
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (open) void refresh();
	}, [open, storeId]);

	const del = (id: string) =>
		run(async () => {
			await api("/api/memory/chunk/delete", {
				method: "POST",
				body: JSON.stringify({ storeId, id }),
			});
			setChunks((cs) => cs.filter((c) => c.id !== id));
			onChanged();
		}, "已删除条目");

	return (
		<div className="memory-chunk-mgr" style={{ marginTop: 8 }}>
			<div className="access-actions" style={{ gap: 8 }}>
				<button
					type="button"
					className="drawer-btn"
					disabled={!enabled}
					onClick={() => setOpen((v) => !v)}
				>
					{open ? "收起条目" : `管理「${label}」条目`}
				</button>
				{open ? (
					<button type="button" className="drawer-btn" disabled={busy || loading} onClick={() => void refresh()}>
						刷新列表
					</button>
				) : null}
			</div>
			{open && (
				<div className="memory-chunk-list">
					{loading && !chunks.length ? <div className="field-hint">加载中…</div> : null}
					{!loading && chunks.length === 0 ? <div className="field-hint">暂无条目</div> : null}
					<ul className="memory-hits">
						{chunks.map((c) => {
							const src =
								c.meta?.source === "import"
									? "导入"
									: c.meta?.source === "manual"
										? "手动"
										: c.meta?.source === "narrative"
											? "剧情"
											: c.meta?.source || "";
							const title = c.meta?.title || c.meta?.fileName || "";
							const merge = c.meta?.mergeCount && c.meta.mergeCount > 1 ? ` · 合并×${c.meta.mergeCount}` : "";
							return (
								<li key={c.id} className="memory-chunk-item">
									<div className="memory-chunk-meta">
										<span className="memory-score">
											{src}
											{title ? ` · ${title}` : ""}
											{merge} · {c.textLen}字
										</span>
										<button
											type="button"
											className="drawer-btn"
											disabled={busy}
											onClick={() => void del(c.id)}
											style={{ marginLeft: 8, padding: "2px 8px", fontSize: 12 }}
										>
											删除
										</button>
									</div>
									<div className="memory-chunk-text">
										{c.text.slice(0, 220)}
										{c.text.length > 220 ? "…" : ""}
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}

/** 内置向量记忆：剧情库（agent 合并）+ 额外库（导入/手动 + 条目管理） */
function MemorySection({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<MemoryStatus>("/api/memory"), {
		cacheKey: "/api/memory",
	});
	const { busy, run } = useAction(toast);
	const [open, setOpen] = useState(false);
	const [enabled, setEnabled] = useState(false);
	const [searchTopK, setSearchTopK] = useState(5);
	const [injectOnTurn, setInjectOnTurn] = useState(true);
	const [embedMode, setEmbedMode] = useState<"local" | "cloud">("local");
	const [cloudBase, setCloudBase] = useState("https://api.openai.com/v1");
	const [cloudKey, setCloudKey] = useState("");
	const [cloudModel, setCloudModel] = useState("text-embedding-3-small");
	const [keyConfigured, setKeyConfigured] = useState(false);
	const [narrativeEvery, setNarrativeEvery] = useState(3);
	const [narrativeOn, setNarrativeOn] = useState(true);
	const [externalOn, setExternalOn] = useState(true);
	const [probeQ, setProbeQ] = useState("");
	const [probeHits, setProbeHits] = useState<Array<{ text: string; score: number }>>([]);
	const [manualText, setManualText] = useState("");
	const [manualTitle, setManualTitle] = useState("");
	const fileRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!data) return;
		setEnabled(data.config.enabled);
		setSearchTopK(data.config.searchTopK);
		setInjectOnTurn(data.config.injectOnTurn !== false);
		setEmbedMode(data.config.embedMode === "cloud" ? "cloud" : "local");
		setCloudBase(data.config.cloudEmbed?.baseUrl || "https://api.openai.com/v1");
		setCloudModel(data.config.cloudEmbed?.model || "text-embedding-3-small");
		setKeyConfigured(data.config.cloudEmbedConfigured === true);
		setCloudKey("");
		const nar = data.stores.find((s) => s.id === "narrative");
		const ext = data.stores.find((s) => s.id === "external");
		if (nar) {
			setNarrativeOn(nar.enabled);
			setNarrativeEvery(nar.everyNTurns);
		}
		if (ext) setExternalOn(ext.enabled);
		if (data.config.enabled) setOpen(true);
	}, [data]);

	const save = () =>
		run(async () => {
			await apiPut("/api/memory", {
				enabled,
				searchTopK,
				injectOnTurn,
				embedMode,
				cloudEmbed: {
					baseUrl: cloudBase,
					apiKey: cloudKey.trim() || (keyConfigured ? "••••••••" : ""),
					model: cloudModel,
				},
				stores: [
					{ id: "narrative", enabled: narrativeOn, everyNTurns: narrativeEvery },
					{ id: "external", enabled: externalOn },
				],
			});
			reload();
		}, "记忆设置已保存");

	const probeEmbed = () =>
		run(async () => {
			await apiPut("/api/memory", {
				embedMode: "cloud",
				cloudEmbed: {
					baseUrl: cloudBase,
					apiKey: cloudKey.trim() || (keyConfigured ? "••••••••" : ""),
					model: cloudModel,
				},
			});
			const r = await api<{ ok: boolean; dim?: number; error?: string }>("/api/memory/probe-embed", {
				method: "POST",
				body: "{}",
			});
			if (!r.ok) throw new Error(r.error || "探测失败");
			reload();
		}, "云端 embedding 正常");

	const clearStore = (storeId: string, label: string) =>
		run(async () => {
			await api("/api/memory/clear", { method: "POST", body: JSON.stringify({ storeId }) });
			reload();
		}, `已清空「${label}」`);

	const reembedAll = () =>
		run(async () => {
			await apiPut("/api/memory", {
				enabled,
				searchTopK,
				injectOnTurn,
				embedMode,
				cloudEmbed: {
					baseUrl: cloudBase,
					apiKey: cloudKey.trim() || (keyConfigured ? "••••••••" : ""),
					model: cloudModel,
				},
				stores: [
					{ id: "narrative", enabled: narrativeOn, everyNTurns: narrativeEvery },
					{ id: "external", enabled: externalOn },
				],
			});
			const r = await api<{
				totalUpdated?: number;
				totalChunks?: number;
				mode?: string;
				model?: string;
			}>("/api/memory/reembed", {
				method: "POST",
				body: "{}",
			});
			reload();
			const n = r.totalUpdated ?? 0;
			const t = r.totalChunks ?? 0;
			if (t === 0) toast("info", "当前对话库为空，无需重向量化");
			else toast("info", `重向量化完成：${n}/${t} 条（${r.mode === "cloud" ? r.model : "本地"}）`);
		});

	const onImportFile = async (file: File) => {
		const text = await file.text();
		await run(async () => {
			await api("/api/memory/import", {
				method: "POST",
				body: JSON.stringify({ storeId: "external", text, fileName: file.name }),
			});
			reload();
		});
	};

	const manualAdd = () =>
		run(async () => {
			const text = manualText.trim();
			if (text.length < 8) throw new Error("内容太短");
			await api("/api/memory/manual", {
				method: "POST",
				body: JSON.stringify({
					text,
					title: manualTitle.trim() || undefined,
					storeId: "external",
				}),
			});
			setManualText("");
			reload();
		});

	const probe = () =>
		run(async () => {
			const r = await api<{ hits: Array<{ text: string; score: number }> }>("/api/memory/search", {
				method: "POST",
				body: JSON.stringify({ storeId: "narrative", query: probeQ, topK: searchTopK }),
			});
			setProbeHits(r.hits ?? []);
		}, "检索完成");

	const narCount = data?.stores.find((s) => s.id === "narrative")?.chunkCount ?? 0;
	const narMax = data?.stores.find((s) => s.id === "narrative")?.maxChunks ?? "—";
	const extCount = data?.stores.find((s) => s.id === "external")?.chunkCount ?? 0;
	const extMax = data?.stores.find((s) => s.id === "external")?.maxChunks ?? "—";

	return (
		<section className="sp-section">
			<h4>向量记忆</h4>
			<div className="field-hint">
				按「当前角色卡 + 当前对话」隔离。
				<strong>剧情数据库</strong>仅 agent 自动<strong>合并</strong>入库；
				<strong>额外数据库</strong>用于导入与手动向量化（每段可成条目，可逐条删除）。
			</div>
			{data?.scope?.sessionId ? (
				<div className="field-hint">
					当前库作用域：会话 {data.scope.sessionId.slice(0, 8)}…
					{data.scope.card ? ` · 卡 ${data.scope.card.split(/[/\\]/).pop()}` : ""}
				</div>
			) : null}
			{loading && !data ? <div className="field-hint">加载中…</div> : null}
			{error ? <div className="field-hint" style={{ color: "var(--danger, #c44)" }}>{error}</div> : null}
			<div className="toggle-row">
				<span>启用向量记忆</span>
				<Toggle
					checked={enabled}
					onChange={(v) => {
						setEnabled(v);
						setOpen(v);
					}}
				/>
			</div>
			{(open || enabled) && data && (
				<div className="memory-panel">
					<div className="field-label" style={{ marginBottom: 6 }}>
						嵌入模式
					</div>
					<div className="access-actions" style={{ gap: 8, marginBottom: 8 }}>
						<button
							type="button"
							className={`drawer-btn ${embedMode === "local" ? "save-btn" : ""}`}
							onClick={() => setEmbedMode("local")}
						>
							本地（免模型）
						</button>
						<button
							type="button"
							className={`drawer-btn ${embedMode === "cloud" ? "save-btn" : ""}`}
							onClick={() => setEmbedMode("cloud")}
						>
							云端 embedding
						</button>
					</div>
					<div className="field-hint">
						换模式后用「重向量化」保留原文只重算向量（云端只花 embedding 费）。
					</div>
					{embedMode === "cloud" && (
						<div className="memory-cloud">
							<input
								className="field-input"
								placeholder="Base URL（如 https://api.openai.com/v1）"
								value={cloudBase}
								onChange={(e) => setCloudBase(e.target.value)}
							/>
							<input
								className="field-input"
								type="password"
								placeholder={keyConfigured ? "API Key（已保存，留空不改）" : "API Key"}
								value={cloudKey}
								autoComplete="off"
								onChange={(e) => setCloudKey(e.target.value)}
							/>
							<input
								className="field-input"
								placeholder="模型名（如 text-embedding-3-small）"
								value={cloudModel}
								onChange={(e) => setCloudModel(e.target.value)}
							/>
							<button type="button" className="drawer-btn" disabled={busy} onClick={() => void probeEmbed()}>
								测试 embedding 连接
							</button>
						</div>
					)}
					<div className="access-actions" style={{ marginTop: 8 }}>
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={busy || !enabled}
							onClick={() => void reembedAll()}
						>
							按当前模式重向量化
						</button>
					</div>

					{/* —— 剧情数据库 —— */}
					<div className="toggle-row" style={{ marginTop: 14 }}>
						<span>剧情数据库</span>
						<Toggle checked={narrativeOn} onChange={setNarrativeOn} />
					</div>
					<div className="field-hint">
						条数 {narCount} / {narMax}。仅 agent 自动写入：到轮次后<strong>合并进最后一条</strong>
						（约满 1800 字才新开一条），不接受手动/导入。
					</div>
					{narrativeOn && (
						<SliderField
							label="每隔多少轮助手回复合并入库"
							hint="1=每轮尝试合并；3=每 3 轮。0=不自动写"
							value={narrativeEvery}
							min={0}
							max={20}
							onChange={setNarrativeEvery}
						/>
					)}
					<div className="access-actions">
						<button
							type="button"
							className="drawer-btn"
							disabled={busy}
							onClick={() => clearStore("narrative", "剧情数据库")}
						>
							清空剧情库
						</button>
					</div>
					<MemoryChunkManager
						storeId="narrative"
						label="剧情"
						enabled={enabled}
						busy={busy}
						run={run}
						toast={toast}
						onChanged={reload}
					/>

					{/* —— 额外数据库 —— */}
					<div className="toggle-row" style={{ marginTop: 14 }}>
						<span>额外数据库</span>
						<Toggle checked={externalOn} onChange={setExternalOn} />
					</div>
					<div className="field-hint">
						条数 {extCount} / {extMax}。导入文件会切块成多条；手动向量化短文 1 条、长文多条。可逐条删除。
					</div>
					<div className="access-actions">
						<button type="button" className="drawer-btn" disabled={busy || !enabled} onClick={() => fileRef.current?.click()}>
							导入文本文件
						</button>
						<input
							ref={fileRef}
							type="file"
							accept=".txt,.md,.text,text/plain,text/markdown"
							hidden
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f) void onImportFile(f);
								if (fileRef.current) fileRef.current.value = "";
							}}
						/>
						<button type="button" className="drawer-btn" disabled={busy} onClick={() => clearStore("external", "额外数据库")}>
							清空额外库
						</button>
					</div>
					<div className="field-label" style={{ marginTop: 10, marginBottom: 4 }}>
						手动向量化（写入额外库）
					</div>
					<input
						className="field-input"
						placeholder="可选标题"
						value={manualTitle}
						onChange={(e) => setManualTitle(e.target.value)}
						disabled={!enabled || busy}
					/>
					<textarea
						className="field-input"
						placeholder="粘贴要记住的设定/摘录…"
						value={manualText}
						onChange={(e) => setManualText(e.target.value)}
						rows={4}
						disabled={!enabled || busy}
						style={{ resize: "vertical", minHeight: 72 }}
					/>
					<div className="access-actions">
						<button
							type="button"
							className="drawer-btn save-btn"
							disabled={busy || !enabled || manualText.trim().length < 8}
							onClick={() => void manualAdd()}
						>
							写入额外库
						</button>
					</div>
					<MemoryChunkManager
						storeId="external"
						label="额外"
						enabled={enabled}
						busy={busy}
						run={run}
						toast={toast}
						onChanged={reload}
					/>

					<div className="toggle-row" style={{ marginTop: 12 }}>
						<span>每轮自动检索并注入模型</span>
						<Toggle checked={injectOnTurn} onChange={setInjectOnTurn} />
					</div>
					<div className="field-hint">
						开=用户发言后检索剧情库+额外库，以【剧情记忆】注入。关=只入库不注入。
					</div>
					<SliderField
						label="检索 / 注入条数 top-k"
						hint="试检索与每轮注入共用上限"
						value={searchTopK}
						min={1}
						max={15}
						onChange={setSearchTopK}
					/>
					<div className="access-actions" style={{ flexWrap: "wrap", gap: 8 }}>
						<input
							className="field-input"
							placeholder="试检索剧情库…"
							value={probeQ}
							onChange={(e) => setProbeQ(e.target.value)}
							style={{ flex: 1, minWidth: 120 }}
						/>
						<button type="button" className="drawer-btn" disabled={busy || !probeQ.trim() || !enabled} onClick={() => void probe()}>
							检索
						</button>
					</div>
					{probeHits.length > 0 && (
						<ul className="memory-hits">
							{probeHits.map((h, i) => (
								<li key={i}>
									<span className="memory-score">{h.score.toFixed(2)}</span> {h.text.slice(0, 160)}
									{h.text.length > 160 ? "…" : ""}
								</li>
							))}
						</ul>
					)}

					<div className="sticky-save" style={{ marginTop: 12 }}>
						<button type="button" className="drawer-btn save-btn" disabled={busy} onClick={() => void save()}>
							保存记忆设置
						</button>
					</div>
				</div>
			)}
		</section>
	);
}

/** 访问密码区：未设置=开放（首次零门槛），设置后全端登录才可用 */
function AccessSection({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const [required, setRequired] = useState<boolean | null>(null);
	const [oldPw, setOldPw] = useState("");
	const [newPw, setNewPw] = useState("");
	const [newPw2, setNewPw2] = useState("");
	const { busy, run } = useAction(toast);

	useEffect(() => {
		void api<{ required: boolean }>("/api/access/status")
			.then((r) => setRequired(r.required))
			.catch(() => setRequired(false));
	}, []);

	const submit = (turningOff: boolean) =>
		run(async () => {
			if (!turningOff) {
				if (newPw.length < 4) throw new Error("新密码至少 4 位");
				if (newPw !== newPw2) throw new Error("两次输入的新密码不一致");
			}
			const r = await api<{ required: boolean }>("/api/access/set", {
				method: "POST",
				body: JSON.stringify({ oldPassword: oldPw, newPassword: turningOff ? "" : newPw }),
			});
			setRequired(r.required);
			setOldPw("");
			setNewPw("");
			setNewPw2("");
		}, turningOff ? "已关闭访问密码" : "已设置访问密码（其他设备需重新登录）");

	return (
		<section className="sp-section">
			<h4>访问密码</h4>
			<div className="field-hint">
				{required
					? "已开启：所有设备访问本站都需输入密码。修改或关闭需先验证当前密码。"
					: "未开启：任何能连到本站的人都可直接使用。部署到公网 / 局域网共享时建议设置。"}
			</div>
			{required === null ? null : (
				<>
					{required && (
						<input
							className="field-input"
							type="password"
							placeholder="当前密码"
							value={oldPw}
							autoComplete="current-password"
							onChange={(e) => setOldPw(e.target.value)}
						/>
					)}
					<input
						className="field-input"
						type="password"
						placeholder={required ? "新密码（至少 4 位）" : "设置密码（至少 4 位）"}
						value={newPw}
						autoComplete="new-password"
						onChange={(e) => setNewPw(e.target.value)}
					/>
					<input
						className="field-input"
						type="password"
						placeholder="再输一次新密码"
						value={newPw2}
						autoComplete="new-password"
						onChange={(e) => setNewPw2(e.target.value)}
					/>
					<div className="access-actions">
						<button className="drawer-btn save-btn" disabled={busy || !newPw} onClick={() => submit(false)}>
							{required ? "修改密码" : "设置密码"}
						</button>
						{required && (
							<button className="drawer-btn" disabled={busy || !oldPw} onClick={() => submit(true)}>
								关闭密码
							</button>
						)}
					</div>
				</>
			)}
		</section>
	);
}

/** 项目完整备份：本机备份 / 导出下载 / 导入恢复（恢复覆盖当前项目，先留恢复前快照） */
function BackupSection({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const { busy, run } = useAction(toast);
	const fileRef = useRef<HTMLInputElement>(null);
	const [pendingFile, setPendingFile] = useState<File | null>(null);

	const onBackup = () =>
		run(async () => {
			const r = await createBackup();
			toast("info", `已在本机备份 ${r.files} 个文件（.liyuan-cache/backup/${r.filename}）`);
		});

	const onPickImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		const f = e.target.files?.[0];
		if (f) setPendingFile(f);
		if (fileRef.current) fileRef.current.value = "";
	};

	const doImport = () =>
		run(async () => {
			if (!pendingFile) return;
			const r = await importBackup(pendingFile);
			setPendingFile(null);
			toast("info", r.note || "已导入，正在重启应用…");
		});

	return (
		<section className="sp-section">
			<h4>备份与恢复</h4>
			<div className="field-hint">
				完整备份本项目的角色卡、世界书、预设、会话、向量记忆、面板、知识库、素材与配置（含 API
				密钥与访问密码，请妥善保管）。恢复会<strong>整体覆盖</strong>当前项目，并自动先留一份恢复前快照。
			</div>
			<div className="access-actions" style={{ flexWrap: "wrap" }}>
				<button type="button" className="drawer-btn" disabled={busy} onClick={onBackup}>
					备份
				</button>
				<button type="button" className="drawer-btn" disabled={busy} onClick={() => downloadBackup()}>
					导出
				</button>
				<button type="button" className="drawer-btn" disabled={busy} onClick={() => fileRef.current?.click()}>
					导入
				</button>
				<input
					ref={fileRef}
					type="file"
					accept=".zip,application/zip"
					hidden
					onChange={onPickImport}
				/>
			</div>
			{pendingFile && (
				<div className="memory-chunk-mgr" style={{ marginTop: 8 }}>
					<div className="field-hint">
						待导入：{pendingFile.name}（覆盖当前项目全部数据）
					</div>
					<div className="access-actions">
						<ConfirmButton className="drawer-btn" disabled={busy} confirmText="确认覆盖当前项目" onConfirm={() => void doImport()}>
							开始导入
						</ConfirmButton>
						<button type="button" className="drawer-btn" disabled={busy} onClick={() => setPendingFile(null)}>
							取消
						</button>
					</div>
				</div>
			)}
		</section>
	);
}

export function SettingsPanel({
	toast,
	onOpenAbout,
	currentVersion,
}: {
	toast: (level: "info" | "warning" | "error", text: string) => void;
	onOpenAbout?: () => void;
	currentVersion?: string;
}) {
	const { data, error, loading, reload } = usePanelData(() => apiGet<{ config: RpConfigView }>("/api/config"), { cacheKey: "/api/config" });
	const { busy, run } = useAction(toast);

	const [scanDepth, setScanDepth] = useState(4);
	const [maxLore, setMaxLore] = useState(3);
	const [compactEvery, setCompactEvery] = useState(30);
	const [backendControl, setBackendControl] = useState(true);
	const [askMode, setAskMode] = useState(false);
	const [dirty, setDirty] = useState(false);

	useEffect(() => {
		if (data) {
			setScanDepth(data.config.scanDepth);
			setMaxLore(data.config.maxLoreInjections);
			setCompactEvery(data.config.compactEveryNTurns ?? 30);
			setBackendControl(data.config.backendControl !== false);
			setAskMode(data.config.creationMode === "ask");
			setDirty(false);
		}
	}, [data]);

	const touch = () => setDirty(true);


	const save = () =>
		run(async () => {
			// 只改本面板可见项；不碰 lorebook / importStripTags（由别处或默认处理）
			await apiPut("/api/config", {
				greeting: true,
				scanDepth,
				maxLoreInjections: maxLore,
				compactEveryNTurns: compactEvery,
				backendControl,
				creationMode: askMode ? "ask" : "silent",
			});
			reload();
		}, "已保存并重载会话");

	return (
		<div className="panel-body panel-body-sticky">
			<PanelStatus loading={loading} error={error} hasData={!!data} />
			<section className="sp-section">
				<h4>{t("界面语言")}</h4>
				<LocaleSwitch onError={(msg) => toast("error", msg)} />
				<div className="field-hint">{t("只换界面文案；模型用什么语言写正文由角色与提示词决定。")}</div>
			</section>
			<AccessSection toast={toast} />
			<BackupSection toast={toast} />
			<MemorySection toast={toast} />
			{data && (
				<>
					<section className="sp-section">
						<h4>世界书</h4>
						<SliderField
							label="关键词扫描深度"
							hint="被动触发回看最近几条消息"
							value={scanDepth}
							min={1}
							max={20}
							onChange={(v) => {
								setScanDepth(v);
								touch();
							}}
						/>
						<SliderField
							label="每轮注入条目上限"
							hint="0 = 关闭被动注入（常驻条目不受影响）"
							value={maxLore}
							min={0}
							max={10}
							onChange={(v) => {
								setMaxLore(v);
								touch();
							}}
						/>
					</section>

					<section className="sp-section">
						<h4>上下文压缩</h4>
						<SliderField
							label="固定楼层压缩周期"
							hint="每 N 个剧情轮把早期正文压成接力摘要（原文归档进剧情库可召回）；0 = 仅在上下文吃紧时被动压缩"
							value={compactEvery}
							min={0}
							max={100}
							onChange={(v) => {
								setCompactEvery(v);
								touch();
							}}
						/>
					</section>

					<section className="sp-section">
						<h4>agent 行为</h4>
						<div className="toggle-row">
							<span>后端操控（bash / 文件等通用工具）</span>
							<Toggle
								checked={backendControl}
								onChange={(v) => {
									setBackendControl(v);
									touch();
								}}
							/>
						</div>
						<div className="field-hint">
							开启后 agent 能操作本机（调用你的其他项目、查资料）；全部调用都会显示在过程条。仅在自己的设备上开启。
						</div>
						<div className="toggle-row">
							<span>决策门禁（戏内选择卡）</span>
							<Toggle
								checked={askMode}
								onChange={(v) => {
									setAskMode(v);
									touch();
								}}
							/>
						</div>
						<div className="field-hint">
							开=询问档：剧情相关（含「我该怎么办」）一律戏内，用选择卡共创；关=静默档自行推进。戏外只办系统事，不处理剧情。
						</div>
					</section>

					<section className="sp-section">
						<h4>关于</h4>
						<div className="field-hint">
							梨园 Liyuan v{currentVersion || "1.6.0"} · 基于 pi 构建的 RP Agent
						</div>
						{onOpenAbout && (
							<div className="access-actions" style={{ marginTop: 6 }}>
								<button type="button" className="drawer-btn" onClick={onOpenAbout}>
									查看完整关于
								</button>
							</div>
						)}
					</section>

					<div className="sticky-save">
						<button className="drawer-btn save-btn" disabled={busy || !dirty} onClick={save}>
							{dirty ? "保存并重载会话" : "已保存"}
						</button>
					</div>
				</>
			)}
		</div>
	);
}
