/**
 * agent 预览运行器：接到 `card_preview` 帧，在页面里可见地渲染当前创作稿，
 * 收集预览壳上报的错误/警告/交互/DOM 摘要，超时后回报服务端。
 * 用户看得到 agent 在测什么；面板留到用户关闭或下一次预览替换。
 */
import { useEffect, useRef, useState } from "react";
import type { CardProjectPreview } from "../../../src/card-authoring-types.ts";
import { apiPost } from "../api.ts";
import { buildCardAuthoringPreview, CARD_PREVIEW_SANDBOX, cardPreviewUrl } from "../cardAuthoringPreview.ts";
import "./CardAuthoring.css";
import { t } from "../i18n/index.ts";

export interface CardPreviewRequestFrame {
	id: string;
	data: CardProjectPreview;
	message: string;
	variables: Record<string, unknown>;
	wait: number;
}
export type PreviewEvent = { token: string; level: string; source: string; message: string };

/** 预览壳事件的可读列表：ready/dom 不上屏，错误红字 */
export function PreviewEventList({ events }: { events: PreviewEvent[] }) {
	const shown = events.filter((e) => e.level !== "ready" && e.level !== "dom");
	if (!shown.length) return null;
	return (
		<div className="card-preview-events">
			{shown.map((e, i) => (
				<pre key={i} className={e.level === "error" ? "card-authoring-error" : "card-preview-event"}>{e.source}：{e.message}</pre>
			))}
		</div>
	);
}

export function PreviewRunner({ request, onClose }: { request: CardPreviewRequestFrame | null; onClose: () => void }) {
	const [events, setEvents] = useState<PreviewEvent[]>([]);
	const [state, setState] = useState<"running" | "reported" | "timeout">("running");
	const frame = useRef<HTMLIFrameElement>(null);
	const url = request ? cardPreviewUrl(buildCardAuthoringPreview(request.data, request.message, request.variables, request.id)) : "";

	useEffect(() => {
		if (!request) return;
		setEvents([]);
		setState("running");
		const collected: PreviewEvent[] = [];
		let ready = false;
		let done = false;
		let readyTimer: ReturnType<typeof setTimeout> | undefined;
		const report = async (isReady: boolean) => {
			if (done) return;
			done = true;
			try {
				await apiPost("/api/card/authoring/preview-report", { id: request.id, ready: isReady, events: collected.map(({ level, source, message }) => ({ level, source, message })) });
				setState("reported");
			} catch {
				setState("timeout");
			}
		};
		const onMessage = (e: MessageEvent) => {
			const p = (e.data as { liyuanCardPreview?: PreviewEvent } | null)?.liyuanCardPreview;
			if (!p || p.token !== request.id || typeof p.message !== "string") return;
			const item = { ...p, message: p.message.slice(0, 8000) };
			collected.push(item);
			setEvents((old) => [...old.slice(-199), item]);
			if (p.level === "ready" && !ready) {
				ready = true;
				// 就绪后按 agent 要求的时长观察，再向各帧要一次 DOM 快照，留 1s 收齐
				readyTimer = setTimeout(() => {
					try { frame.current?.contentWindow?.postMessage({ liyuanPreviewSnapshot: true }, "*"); } catch { /* 帧已卸载 */ }
					setTimeout(() => void report(true), 1000);
				}, request.wait);
			}
		};
		window.addEventListener("message", onMessage);
		// 页面根本没就绪（脚本把壳搞崩了 / data: URL 被拦）：也要回报，agent 才知道
		const guard = setTimeout(() => { if (!ready) void report(false); }, request.wait + 10_000);
		return () => {
			window.removeEventListener("message", onMessage);
			clearTimeout(guard);
			if (readyTimer) clearTimeout(readyTimer);
		};
	}, [request]);

	if (!request) return null;
	const errors = events.filter((e) => e.level === "error").length;
	return (
		<div className="card-preview-runner">
			<div className="card-preview-runner-head">
				<span>
					{t("Agent 预览 · {state}", { state: state === "running" ? t("运行中") : state === "reported" ? t("已回报") : t("回报失败") })}
					{errors ? t(" · {n} 个错误", { n: errors }) : ""}
				</span>
				<button type="button" className="act" onClick={onClose}>{t("关闭")}</button>
			</div>
			<iframe key={request.id} ref={frame} title={t("Agent 预览")} sandbox={CARD_PREVIEW_SANDBOX} src={url} />
			<PreviewEventList events={events} />
		</div>
	);
}
