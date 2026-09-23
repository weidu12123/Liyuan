/**
 * mermaid 图表块（```mermaid）：按需加载 mermaid，渲染成 SVG。
 * 库只在正文里真出现图表时才拉取；加载或语法失败时回落成普通代码块，不挡正文。
 */
import { useEffect, useState } from "react";
import { getTheme } from "../theme.ts";

const MERMAID_SRC = "https://cdn.jsdelivr.net/npm/mermaid@11.12.1/dist/mermaid.min.js";

type MermaidApi = {
	initialize: (c: Record<string, unknown>) => void;
	render: (id: string, src: string) => Promise<{ svg: string }>;
};

let loading: Promise<MermaidApi> | null = null;
const loadMermaid = (): Promise<MermaidApi> => {
	const w = window as unknown as { mermaid?: MermaidApi };
	if (w.mermaid) return Promise.resolve(w.mermaid);
	loading ??= new Promise<MermaidApi>((resolve, reject) => {
		const s = document.createElement("script");
		s.src = MERMAID_SRC;
		s.async = true;
		s.onload = () => (w.mermaid ? resolve(w.mermaid) : reject(new Error("mermaid 未挂上"))); // i18n-ignore：内部错误，只进 catch，不上屏
		s.onerror = () => reject(new Error("mermaid 加载失败")); // i18n-ignore：同上
		document.head.appendChild(s);
	});
	return loading;
};

let seq = 0;

export function MermaidBlock({ code }: { code: string }) {
	const [svg, setSvg] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let live = true;
		setSvg(null);
		setFailed(false);
		void loadMermaid()
			.then(async (m) => {
				const dark = getTheme() === "dark";
				m.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: dark ? "dark" : "neutral", fontFamily: "inherit" });
				const { svg } = await m.render(`liyuan-mermaid-${seq++}`, code);
				if (live) setSvg(svg);
			})
			.catch(() => { if (live) setFailed(true); });
		return () => { live = false; };
	}, [code]);
	if (failed) return <pre className="msg-md-code" data-lang="mermaid"><code>{code}</code></pre>;
	if (!svg) return <pre className="msg-md-code msg-mermaid-pending" data-lang="mermaid"><code>{code}</code></pre>;
	return <div className="msg-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
