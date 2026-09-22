import { useEffect, useRef, useState } from "react";
import type { CardProjectBuild, CardProjectPreview, CardProjectStatus } from "../../../src/card-authoring-types.ts";
import { apiGet, apiPost } from "../api.ts";
import { buildCardAuthoringPreview, CARD_PREVIEW_SANDBOX, cardPreviewUrl } from "../cardAuthoringPreview.ts";
import "./CardAuthoring.css";
import { t } from "../i18n/index.ts";

type Source = { id: string; text: string; hash: string };
type PreviewEvent = { token: string; level: string; source: string; message: string };

export function CardAuthoring({ card, onApplied }: { card: string; onApplied: () => void }) {
	const [open, setOpen] = useState(false);
	const [status, setStatus] = useState<CardProjectStatus | null>(null);
	const [selected, setSelected] = useState("");
	const [source, setSource] = useState<Source | null>(null);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [build, setBuild] = useState<CardProjectBuild | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [variables, setVariables] = useState<string | null>(null);
	const [preview, setPreview] = useState<{ url: string; token: string } | null>(null);
	const [events, setEvents] = useState<PreviewEvent[]>([]);
	const frame = useRef<HTMLIFrameElement>(null);
	const active = useRef(true);
	const dirty = source !== null && text !== source.text;
	useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

	const operation = <T,>(args: Record<string, unknown>) => apiPost<T>("/api/card/authoring", { ...args, card });
	const refresh = async () => {
		const next = await apiGet<CardProjectStatus>("/api/card/authoring?card=" + encodeURIComponent(card), { bypassCache: true });
		if (active.current) setStatus(next);
		return next;
	};
	const run = async (fn: () => Promise<void>) => {
		setBusy(true); setError(""); setNotice("");
		try { await fn(); } catch (e) { if (active.current) setError(e instanceof Error ? e.message : String(e)); }
		finally { if (active.current) setBusy(false); }
	};
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		apiGet<CardProjectStatus>("/api/card/authoring?card=" + encodeURIComponent(card), { bypassCache: true })
			.then(s => { if (!cancelled) setStatus(s); })
			.catch(e => { if (!cancelled) setError(String(e.message || e)); });
		return () => { cancelled = true; };
	}, [open, card]);
	useEffect(() => {
		if (!selected) { setSource(null); return; }
		let cancelled = false;
		setSource(null); setError("");
		operation<Source>({ action: "read", resource: selected }).then(s => {
			if (!cancelled) { setSource(s); setText(s.text); }
		}).catch(e => { if (!cancelled) setError(String(e.message || e)); });
		return () => { cancelled = true; };
	}, [selected, card]);
	useEffect(() => {
		if (!preview) return;
		const onMessage = (e: MessageEvent) => {
			if (e.source !== frame.current?.contentWindow) return;
			const p = e.data?.liyuanCardPreview as PreviewEvent | undefined;
			if (!p || p.token !== preview.token || typeof p.message !== "string") return;
			setEvents(old => [...old.slice(-49), { ...p, message: p.message.slice(0, 4000) }]);
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [preview]);

	const save = async () => {
		if (!source || !dirty) return;
		const next = await operation<{ hash: string }>({ action: "write", resource: selected, text, version: source.hash });
		if (active.current) { setSource({ id: selected, text, hash: next.hash }); setBuild(null); }
		await refresh();
	};
	const prepare = () => run(async () => {
		const next = await operation<CardProjectStatus>({ action: "prepare" });
		setStatus(next);
		setSelected((next.resources.find(r => r.kind === "regex-template" || r.kind === "script") ?? next.resources[0])?.id ?? "");
	});
	const check = () => run(async () => {
		setPreview(null); setEvents([]);
		await save();
		const result = await operation<CardProjectBuild>({ action: "check" });
		setBuild(result);
		await refresh();
		if (!result.errors.length) setNotice(t("资源检查通过，{n} 项变更", { n: result.changed.length }));
	});
	const showPreview = () => run(async () => {
		setPreview(null); setEvents([]);
		await save();
		const data = await apiPost<CardProjectPreview>("/api/card/authoring/preview", { card });
		setBuild(data.build);
		if (data.build.errors.length) return;
		const sample = message || data.greetings[0] || "";
		const values = variables?.trim() ? JSON.parse(variables) : data.variables;
		if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(t("测试变量需为 JSON 对象"));
		const token = String(Date.now()) + "-" + Math.random().toString(36).slice(2);
		setMessage(sample); setVariables(JSON.stringify(values, null, 2));
		setEvents([]);
		setPreview({ token, url: cardPreviewUrl(buildCardAuthoringPreview(data, sample, values, token)) });
	});

	return (
		<section className="sp-section card-authoring">
			<button type="button" className="act" aria-expanded={open} onClick={() => setOpen(v => !v)}>
				{open ? t("收起代码与资源") : t("代码与资源")}
			</button>
			{open && <>
				{error && <p className="card-authoring-error" role="alert">{error}</p>}
				{status && !status.prepared && <div className="panel-row">
					<span>{t("{n} 项资源", { n: status.resources.length })}</span>
					<button className="drawer-btn" disabled={busy} onClick={prepare}>{t("建立创作稿")}</button>
				</div>}
				{status?.prepared && <>
					<div className="panel-row card-authoring-toolbar">
						<span>{t("{n} 项待应用", { n: status.resources.filter(r => r.changed).length })}</span>
						<button className="act" disabled={busy || dirty} onClick={() => void run(async () => {
							await refresh(); setSource(null); setSelected(""); setBuild(null); setPreview(null);
						})}>{t("刷新资源")}</button>
						{status.canUndo && <button className="act" disabled={busy || dirty || status.conflict} onClick={() => void run(async () => {
								setStatus(await operation<CardProjectStatus>({ action: "undo" })); setBuild(null); setPreview(null); onApplied(); setNotice(t("已撤回应用，创作稿仍保留"));
						})}>{t("撤回应用")}</button>}
					</div>
					{status.conflict && <p className="card-authoring-error" role="status">{t("原卡已有其他修改，创作稿已保留，应用将停止覆盖。")}</p>}
											<label className="card-authoring-label">
							{t("资源")}
							<select aria-label={t("卡资源")} value={selected} disabled={busy || dirty} onChange={e => { setSelected(e.target.value); setBuild(null); }}>
								<option value="">{t("选择资源")}</option>
								{status.resources.map((r, i) => <option key={r.id} value={r.id}>{i + 1}. {r.name}{r.changed ? t(" · 已修改") : ""}</option>)}
								<option value="raw">{t("原包 JSON（只读）")}</option>
							</select>
						</label>
					{source && <>
						<textarea className="panel-search ta card-source-editor" aria-label={t("资源源码")} spellCheck={false}
								readOnly={selected === "raw"} disabled={busy} rows={12} value={text} onChange={e => { setText(e.target.value); setBuild(null); setPreview(null); }} />
						<div className="panel-row card-authoring-toolbar">
							<button className="drawer-btn" disabled={busy || !dirty || selected === "raw"} onClick={() => void run(async () => { await save(); setNotice(t("创作稿已保存")); })}>{t("保存创作稿")}</button>
							{dirty && <button className="act" disabled={busy} onClick={() => setText(source.text)}>{t("还原编辑")}</button>}
						</div>
					</>}
					<details className="legacy-group">
						<summary>{t("测试内容与变量")}</summary>
						<label className="card-authoring-label">{t("测试消息")}
							<textarea className="panel-search ta" aria-label={t("测试消息")} rows={5} value={message ?? ""} placeholder={t("留空使用默认开场")}
								onChange={e => setMessage(e.target.value)} />
						</label>
						<label className="card-authoring-label">{t("测试变量")}
							<textarea className="panel-search ta card-source-editor" aria-label={t("测试变量")} rows={5} value={variables ?? ""}
								placeholder={t("首次预览读取卡内初值")} onChange={e => setVariables(e.target.value)} />
						</label>
					</details>
					<div className="panel-row card-authoring-toolbar">
						<button className="drawer-btn" disabled={busy} onClick={check}>{t("检查")}</button>
						<button className="drawer-btn" disabled={busy} onClick={showPreview}>{t("预览")}</button>
						<button className="drawer-btn save-btn" disabled={busy || dirty || !build || !!build.errors.length || !build.changed.length || status.conflict}
							onClick={() => void run(async () => {
								setStatus(await operation<CardProjectStatus>({ action: "apply", buildHash: build!.hash }));
								setBuild(null); onApplied(); setNotice(t("已应用并重载"));
							})}>{t("应用到角色卡")}</button>
					</div>
					{build?.errors.map((e, i) => <pre className="card-authoring-error" key={i}>{status.resources.find(r => r.id === e.resource)?.name ?? e.resource}：{e.message}</pre>)}
					{notice && <p role="status">{notice}</p>}
					{preview && <div className="card-preview">
						<div className="panel-row card-authoring-toolbar"><span>{t("测试预览")}</span><button className="act" onClick={() => setPreview(null)}>{t("关闭预览")}</button></div>
						<iframe key={preview.token} ref={frame} title={t("角色卡创作预览")} sandbox={CARD_PREVIEW_SANDBOX} src={preview.url} />
						{events.filter(e => e.level !== "ready").map((e, i) => <pre key={i} className={e.level === "error" ? "card-authoring-error" : "card-preview-event"}>{e.source}：{e.message}</pre>)}
					</div>}
				</>}
			</>}
		</section>
	);
}
