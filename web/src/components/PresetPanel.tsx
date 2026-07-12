/**
 * 预设面板（左栏，PLAN-PANELS-V2 §2.6）：布局按使用频率排——
 * ① 预设选择条（切换即生效＋另存为/重命名/删除/导入/导出，借鉴 ST preset-manager）
 * ② 核心采样参数（上下文/温度/top_p…滑条，高频）
 * ③ 提示词块（按通道分组＋全开关＋字数小计，低频）。块内容编辑本轮不做（用户后续换模型时改）。
 */

import { useEffect, useMemo, useState } from "react";
import {
	apiDelete,
	apiGet,
	apiPost,
	apiPut,
	downloadJson,
	type ConvertReportItem,
	type PresetResponse,
	type PresetsResponse,
} from "../api.ts";
import { ConfirmButton, PanelStatus, SliderField, Toggle, useAction, usePanelData } from "./kit.tsx";

const CHANNEL_LABEL: Record<string, string> = {
	system: "系统区",
	postHistory: "末端注入",
};

// 常见采样参数的范围与说明；排序即展示序（高频在前），未知参数排最后裸输入
const SAMPLER_META: Array<{ key: string; min: number; max: number; step: number; hint: string }> = [
	{ key: "temperature", min: 0, max: 2, step: 0.01, hint: "越高越随机发散，越低越确定" },
	{ key: "top_p", min: 0, max: 1, step: 0.01, hint: "核采样：只从累计概率 top_p 的词里选" },
	{ key: "top_k", min: 0, max: 200, step: 1, hint: "只从概率最高的 k 个词里选（0=不限）" },
	{ key: "frequency_penalty", min: -2, max: 2, step: 0.01, hint: "惩罚高频词，抑制复读" },
	{ key: "presence_penalty", min: -2, max: 2, step: 0.01, hint: "惩罚已出现词，鼓励换话题" },
	{ key: "repetition_penalty", min: 1, max: 2, step: 0.01, hint: "重复惩罚（1=不惩罚）" },
	{ key: "min_p", min: 0, max: 1, step: 0.01, hint: "过滤概率低于峰值 min_p 倍的词" },
];

export function PresetPanel({ toast }: { toast: (level: "info" | "warning" | "error", text: string) => void }) {
	const files = usePanelData(() => apiGet<PresetsResponse>("/api/presets"), { cacheKey: "/api/presets" });
	const detail = usePanelData(() => apiGet<PresetResponse>("/api/preset"), { cacheKey: "/api/preset" });
	const { busy, run } = useAction(toast);

	const reloadAll = () => {
		files.reload();
		detail.reload();
	};

	const [samplers, setSamplers] = useState<Record<string, number>>({});
	const [samplersDirty, setSamplersDirty] = useState(false);
	useEffect(() => {
		if (detail.data?.preset) {
			setSamplers(detail.data.preset.samplers);
			setSamplersDirty(false);
		}
	}, [detail.data]);

	// 采样参数按 SAMPLER_META 序展示，未知参数尾随
	const orderedSamplers = useMemo(() => {
		const known = SAMPLER_META.filter((m) => m.key in samplers).map((m) => ({ ...m, value: samplers[m.key] }));
		const unknown = Object.entries(samplers)
			.filter(([k]) => !SAMPLER_META.some((m) => m.key === k))
			.map(([key, value]) => ({ key, value }));
		return { known, unknown };
	}, [samplers]);

	const grouped = useMemo(() => {
		const map = new Map<string, NonNullable<PresetResponse["preset"]>["blocks"]>();
		for (const b of detail.data?.preset?.blocks ?? []) {
			const list = map.get(b.channel) ?? [];
			list.push(b);
			map.set(b.channel, list);
		}
		return [...map.entries()];
	}, [detail.data]);

	// ---- 预设文件操作 ----
	const [report, setReport] = useState<ConvertReportItem[] | null>(null);

	const selectPreset = (file: string | null) =>
		run(async () => {
			await apiPost("/api/presets/select", { file });
			reloadAll();
		});

	const saveAs = () => {
		const name = prompt("另存为预设名：");
		if (!name?.trim()) return;
		void run(async () => {
			await apiPost("/api/presets/saveas", { name: name.trim() });
			reloadAll();
		}, "已另存并启用");
	};

	const rename = () => {
		const active = files.data?.active;
		if (!active) return;
		const name = prompt("新名字：", files.data?.presets.find((p) => p.file === active)?.name ?? "");
		if (!name?.trim()) return;
		void run(async () => {
			await apiPost("/api/presets/rename", { file: active, name: name.trim() });
			reloadAll();
		}, "已重命名");
	};

	const removeActive = () => {
		const active = files.data?.active;
		if (!active) return;
		void run(async () => {
			await apiDelete(`/api/presets?file=${encodeURIComponent(active)}`);
			reloadAll();
		}, "已删除（当前不使用预设）");
	};

	const doExport = async () => {
		const active = files.data?.active;
		if (!active) return;
		try {
			const r = await apiGet<{ name: string; json: unknown }>(`/api/presets/export?file=${encodeURIComponent(active)}`);
			downloadJson(`${r.name}.json`, r.json);
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const doImport = async (file: File) => {
		setReport(null);
		try {
			const json = JSON.parse(await file.text()) as Record<string, unknown>;
			const r = await apiPost<{ report: ConvertReportItem[]; blockCount: number; converted: boolean }>("/api/presets/import", {
				name: file.name.replace(/\.json$/i, ""),
				json,
			});
			if (r.converted) setReport(r.report);
			toast("info", `已导入并启用（${r.blockCount} 个内容块${r.converted ? "，ST 预设已转换" : ""}）`);
			reloadAll();
		} catch (e) {
			toast("error", e instanceof Error ? e.message : String(e));
		}
	};

	const toggleBlock = (id: string, enabled: boolean) =>
		run(async () => {
			await apiPut("/api/preset", { blocks: [{ id, enabled }] });
			detail.reload();
		});

	const toggleChannel = (blocks: { id: string }[], enabled: boolean) =>
		run(async () => {
			await apiPut("/api/preset", { blocks: blocks.map((b) => ({ id: b.id, enabled })) });
			detail.reload();
		});

	const saveSamplers = () =>
		run(async () => {
			await apiPut("/api/preset", { samplers });
			detail.reload();
		}, "采样参数已保存并重载");

	return (
		<div className="panel-body">
			<PanelStatus loading={files.loading} error={files.error} hasData={!!files.data} />
			{files.data && (
				<>
					{/* ① 预设选择条 */}
					<section className="sp-section">
						<h4>预设</h4>
						<select
							className="panel-search"
							value={files.data.active ?? ""}
							disabled={busy}
							onChange={(e) => void selectPreset(e.target.value || null)}
							aria-label="选择预设"
						>
							<option value="">（不使用预设）</option>
							{files.data.presets.map((p) => (
								<option key={p.file} value={p.file}>
									{p.name}（{p.file}）
								</option>
							))}
						</select>
						<div className="panel-row list-toolbar preset-actions">
							<button className="drawer-btn" disabled={busy} onClick={saveAs} title="把当前预设内容另存为新预设并启用">
								另存为
							</button>
							<button className="drawer-btn" disabled={busy || !files.data.active} onClick={rename}>
								重命名
							</button>
							<label className="drawer-btn" title="导入预设 JSON（ST 预设自动转换）">
								导入
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
							<button className="drawer-btn" disabled={busy || !files.data.active} onClick={() => void doExport()}>
								导出
							</button>
							<ConfirmButton className="drawer-btn" disabled={busy || !files.data.active} confirmText="确认删除" onConfirm={removeActive}>
								删除
							</ConfirmButton>
						</div>
						{report && (
							<details className="legacy-group" open>
								<summary>转换分诊报告（{report.length} 项）</summary>
								{report.map((r, i) => (
									<div key={i} className="kv">
										<span className="kv-k">{r.name || r.identifier}</span>
										<span className="kv-v">
											{r.action}
											{r.contentChars > 0 ? ` · ${r.contentChars} 字` : ""}
										</span>
									</div>
								))}
							</details>
						)}
					</section>

					<PanelStatus loading={detail.loading} error={detail.error} hasData={!!detail.data} />
					{detail.data?.missing && <div className="panel-error">配置指向的预设文件不存在：{detail.data.missing}</div>}

					{detail.data?.preset && (
						<>
							{/* ② 核心采样参数（高频置顶） */}
							<section className="sp-section">
								<h4>采样参数</h4>
								{Object.keys(samplers).length === 0 && <div className="sp-empty">该预设未带采样参数。</div>}
								{orderedSamplers.known.map((m) => (
									<SliderField
										key={m.key}
										label={m.key}
										hint={m.hint}
										value={m.value}
										min={m.min}
										max={m.max}
										step={m.step}
										onChange={(nv) => {
											setSamplers((s) => ({ ...s, [m.key]: nv }));
											setSamplersDirty(true);
										}}
									/>
								))}
								{orderedSamplers.unknown.map(({ key, value }) => (
									<div key={key} className="kv sampler-row">
										<span className="kv-k">{key}</span>
										<input
											className="panel-search num"
											type="number"
											step="0.01"
											value={value}
											onChange={(e) => {
												const n = Number(e.target.value);
												if (Number.isFinite(n)) {
													setSamplers((s) => ({ ...s, [key]: n }));
													setSamplersDirty(true);
												}
											}}
										/>
									</div>
								))}
								{Object.keys(samplers).length > 0 && (
									<button className="drawer-btn" disabled={busy || !samplersDirty} onClick={saveSamplers}>
										{samplersDirty ? "保存采样参数" : "已保存"}
									</button>
								)}
							</section>

							{/* ③ 提示词块 */}
							<section className="sp-section">
								<h4>提示词块</h4>
								<div className="field-hint">系统区块进 system prompt，末端注入块随每轮【导演备注】走。</div>
								{grouped.map(([channel, blocks]) => {
									const totalChars = blocks.reduce((n, b) => n + (b.enabled ? b.chars : 0), 0);
									const allOn = blocks.every((b) => b.enabled);
									return (
										<div key={channel} className="preset-group">
											<div className="preset-group-head">
												<span className="preset-group-name">
													{CHANNEL_LABEL[channel] ?? channel}
													<span className="lore-meta">
														{blocks.length} 块 · 启用 {totalChars} 字
													</span>
												</span>
												<button className="act" disabled={busy} onClick={() => toggleChannel(blocks, !allOn)}>
													{allOn ? "全关" : "全开"}
												</button>
											</div>
											{blocks.map((b) => (
												<div key={b.id} className={`lore-item ${b.enabled ? "" : "off"}`}>
													<div className="lore-head">
														<div className="block-info">
															<span className="lore-title">{b.name}</span>
															<span className="lore-meta">{b.chars} 字</span>
														</div>
														<Toggle checked={b.enabled} disabled={busy} onChange={(v) => toggleBlock(b.id, v)} />
													</div>
												</div>
											))}
										</div>
									);
								})}
							</section>
						</>
					)}
					{!detail.data?.preset && !detail.data?.missing && (
						<div className="sp-empty">当前未使用预设。可从上方「导入」一份 ST 预设（自动转换），或「另存为」建一份空预设。</div>
					)}
				</>
			)}
		</div>
	);
}
