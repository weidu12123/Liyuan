/**
 * 对话流 HTML 沙箱帧（底层展示通道）。
 *
 * - 默认：sandbox 禁止脚本（静态 HTML/CSS）
 * - scripts=true：allow-scripts，仍无 allow-same-origin → 无法读写父页面
 * - seamless=true：无痕模式（卡皮肤/整楼界面）——幽灵操作、真实高度、样式主权
 * - 与侧栏 ArtifactPanel 锁死策略不同：此处按消息/工具显式开关脚本，服务「中途渲染 UI」
 *
 * 视口接管型程序卡（某卡、某卡开局创建器等）UI 是 fixed/100% 铺满。
 * 若初始 iframe 只有 minHeight(120)，量高永远量出 120 → 按钮被裁切在框外 → 用户感觉「点了没反应」。
 * 接管型：按视口锁高、不注入上报器、不收内容量高消息——内容量高与卡内
 * ResizeObserver 互踩会形成「收拢/涨高」乒乓（某卡开局创建器持续抖动事故）。
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildSrcDoc, looksLikeProgramApp, programViewportHeight } from "../frameDoc.ts";
import { t } from "../i18n/index.ts";

export { looksLikeProgramApp, programViewportHeight } from "../frameDoc.ts";

export function HtmlFrame({
	html,
	title,
	scripts = false,
	seamless = false,
	minHeight = 120,
	maxHeight = 560,
}: {
	html: string;
	title?: string;
	scripts?: boolean;
	/** 无痕模式：卡皮肤/整楼界面；agent show_html 保持 false */
	seamless?: boolean;
	minHeight?: number;
	maxHeight?: number;
}) {
	const frameId = useId();
	const ref = useRef<HTMLIFrameElement>(null);
	const wrapRef = useRef<HTMLElement>(null);
	/**
	 * 视口门控（8/19）：**滚进视口才 boot 这一帧**。
	 *
	 * 由来：作者美化卡的实测重量是每帧 35KB CSS + 28KB JS + 10 处 backdrop-filter/blur
	 * + 56 处动画 + 10 个定时器；作者规则 maxDepth=2 让最新 3 条各带 2 帧 ⇒ 刷新/切会话
	 * 时 6 个独立文档同时 boot，浏览器当场卡住。梨园侧不碰作者的一个字，只是不在屏外 boot。
	 *
	 * 一旦进过视口就**不再卸载**：卡内有 localStorage 主题、折叠态等自持状态，来回卸载
	 * 会把用户的交互清零，比省下的开销更烦。
	 */
	const [inView, setInView] = useState(false);
	const programApp = useMemo(() => seamless && looksLikeProgramApp(html, scripts), [html, scripts, seamless]);
	const [height, setHeight] = useState(() =>
		programApp && typeof window !== "undefined" ? programViewportHeight(window) : minHeight,
	);
	const [showSource, setShowSource] = useState(false);
	// 未进视口不建 srcdoc：整页卡的 srcdoc 可达数十 KB，没必要为屏外的帧逐次拼串
	// memo：html 来自 splitRichContentParts 的 useMemo，输入不变就不重拼——此前每次重渲染
	// 都重拼整份串再扔掉（533KB 帧实测 ~18ms/次）。视口高度进依赖：折 vh 用它，变了才该重拼
	const viewportPx = inView && typeof window !== "undefined" ? window.innerHeight : undefined;
	const srcDoc = useMemo(
		() => (inView ? buildSrcDoc(html, scripts, seamless, viewportPx) : ""),
		[html, scripts, seamless, inView, viewportPx],
	);

	useEffect(() => {
		if (inView) return;
		const el = wrapRef.current;
		if (!el) return;
		// 环境不支持就直接放行（SSR/老浏览器）——门控是优化，不能变成不显示
		if (typeof IntersectionObserver === "undefined") {
			setInView(true);
			return;
		}
		// 提前一屏 boot：滚到跟前时卡已经画好，用户看不出门控存在
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					setInView(true);
					io.disconnect();
				}
			},
			{ rootMargin: "800px 0px" },
		);
		io.observe(el);
		return () => io.disconnect();
	}, [inView]);

	/**
	 * 沙箱矩阵：
	 * - 静态 seamless：only same-origin（量高，无脚本）
	 * - 脚本帧（三档程序卡）：scripts + same-origin + forms
	 *   必须同源，否则 IndexedDB/Dexie/localStorage 在不透明源上 SecurityError，
	 *   卡初始化挂掉 → 按钮永远绑不上（某卡等）。
	 *   风险：同源脚本可读父页 DOM——仅对卡作者 HTML 开启；垫片不提供改正文通道。
	 * - agent show_html 非 seamless 脚本：仅 scripts（调试用，保持隔离）
	 */
	const sandbox = scripts
		? seamless
			? "allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
			: "allow-scripts"
		: seamless
			? "allow-same-origin"
			: "";
	const cap = seamless ? Number.POSITIVE_INFINITY : maxHeight;

	// 程序卡：跟视口，避免 120px 裁切；resize 时同步
	useEffect(() => {
		if (!programApp) return;
		const apply = () => setHeight(programViewportHeight(window));
		apply();
		window.addEventListener("resize", apply);
		return () => window.removeEventListener("resize", apply);
	}, [programApp, srcDoc]);

	// 静态帧量高(seamless 下 same-origin 可读;旧模式维持原 try/catch 行为)
	useEffect(() => {
		if (scripts) {
			if (!seamless) setHeight(maxHeight);
			return;
		}
		const el = ref.current;
		if (!el) return;
		const fit = () => {
			try {
				const doc = el.contentDocument;
				const body = doc?.body;
				// 与脚本帧同一策略：量内容子节点，避免 100vh/scrollHeight 反馈环
				let h = 0;
				if (body) {
					for (const node of Array.from(body.children)) {
						const tag = node.tagName;
						if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK") continue;
						const eln = node as HTMLElement;
						h = Math.max(h, eln.offsetTop + eln.offsetHeight, Math.ceil(eln.getBoundingClientRect().bottom));
					}
					if (h < 1) h = body.offsetHeight || 0;
				}
				if (h < 1) h = doc?.documentElement?.scrollHeight || minHeight;
				const next = Math.min(cap, Math.max(minHeight, Math.ceil(h)));
				setHeight((prev) => (Math.abs(prev - next) < 2 ? prev : next));
			} catch {
				/* opaque origin(非 seamless 静态帧) */
			}
		};
		el.addEventListener("load", fit);
		const t = window.setTimeout(fit, 50);
		const t2 = window.setTimeout(fit, 200);
		return () => {
			el.removeEventListener("load", fit);
			window.clearTimeout(t);
			window.clearTimeout(t2);
		};
	}, [srcDoc, scripts, seamless, minHeight, cap, maxHeight]);

	// 脚本帧高度上报(seamless 内容流)：小部件/状态栏跟内容。
	// 程序卡（接管型）不订阅：视口锁高，srcdoc 也不带上报器；防御性拒收避免任何乒乓回路
	useEffect(() => {
		if (!scripts || !seamless || programApp) return;
		const onMsg = (e: MessageEvent) => {
			if (e.source !== ref.current?.contentWindow) return;
			const d = e.data as { liyuanFrameHeight?: unknown; frameId?: unknown };
			if (!d || d.frameId !== frameId || typeof d.liyuanFrameHeight !== "number" || !(d.liyuanFrameHeight > 0)) {
				return;
			}
			const raw = Math.ceil(d.liyuanFrameHeight);
			// 内容流帧（seamless 非接管型）高度上限：大方放行，蠕变靠下方 ratchet 防护。
			// 旧值 min(2400, 92%vh) 在 1080p 只有 ~828px，某卡等长欢迎消息被裁半截。
			const hardCap = typeof window !== "undefined"
				? Math.max(2400, Math.floor(window.innerHeight * 4))
				: 10000;
			const next = Math.max(minHeight, Math.min(hardCap, raw));
			setHeight((prev) => {
				if (Math.abs(prev - next) < 2) return prev;
				// 允许首次拉高；拒绝「每次只多几 px」的 100vh 蠕变
				if (next > prev && next - prev <= 8 && prev > minHeight + 20) return prev;
				return next;
			});
		};
		window.addEventListener("message", onMsg);
		return () => window.removeEventListener("message", onMsg);
	}, [scripts, seamless, frameId, minHeight, programApp]);

	return (
		<figure
			ref={wrapRef}
			className={`msg-html ${scripts ? "msg-html-scripts" : ""} ${seamless ? "msg-html-seamless" : ""} ${programApp ? "msg-html-program" : ""}`}
		>
			{!seamless && (
				<div className="msg-html-bar">
					<span className="msg-html-title">{title?.trim() || (scripts ? t("交互界面") : "HTML")}</span>
					<span className="msg-html-tags">
						{scripts ? <span className="chip chip-html-js">{t("脚本")}</span> : <span className="chip chip-html-static">{t("静态")}</span>}
						<button type="button" className="act" onClick={() => setShowSource((v) => !v)}>
							{showSource ? t("收起源码") : t("源码")}
						</button>
					</span>
				</div>
			)}
			{seamless && (
				<div className="msg-html-ghost">
					<button type="button" className="act" onClick={() => setShowSource((v) => !v)}>
						{showSource ? t("收起源码") : t("源码")}
					</button>
				</div>
			)}
			{inView ? (
				<iframe
					ref={ref}
					name={frameId}
					className="msg-html-frame"
					data-liyuan-card-runtime="message"
					title={title || (seamless ? t("界面") : "HTML")}
					sandbox={sandbox}
					srcDoc={srcDoc}
					style={{ height }}
				/>
			) : (
				// 占位：占住同样的高度，滚动条与布局不跳；进视口即换成真帧
				<div className="msg-html-frame" style={{ height }} aria-hidden="true" />
			)}
			{showSource && <pre className="msg-html-source">{html}</pre>}
			{!seamless && title?.trim() && !showSource && <figcaption className="msg-html-cap">{title}</figcaption>}
		</figure>
	);
}
