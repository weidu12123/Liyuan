/**
 * 把当前稿子画面截成 PNG（agent 的 screenshot 工具用）。
 *
 * 截的是页面里真实渲染的那一块：卡皮肤画在同源 iframe 里，mermaid 是内联 SVG。
 * html-to-image 拍不到别的文档，所以先把每个同源 iframe 的内容内联进克隆体再拍。
 * file 给了就只截那一章（.story-chapter），否则截整页稿子（.story-body）。
 */
import { toPng } from "html-to-image";

const inlineFrames = (source: HTMLElement, clone: HTMLElement): void => {
	const srcFrames = [...source.querySelectorAll("iframe")];
	const dstFrames = [...clone.querySelectorAll("iframe")];
	srcFrames.forEach((frame, i) => {
		const dst = dstFrames[i];
		if (!dst) return;
		let doc: Document | null = null;
		try { doc = frame.contentDocument; } catch { doc = null; }
		const box = document.createElement("div");
		box.className = "msg-html-frame";
		if (doc?.body) {
			for (const style of doc.querySelectorAll("style")) box.appendChild(style.cloneNode(true));
			for (const node of doc.body.childNodes) box.appendChild(node.cloneNode(true));
		}
		const h = frame.getBoundingClientRect().height;
		if (h) box.style.minHeight = `${Math.round(h)}px`;
		dst.replaceWith(box);
	});
};

export async function captureStoryPng(file?: string): Promise<{ png: string; width: number; height: number } | null> {
	const pane = document.querySelector(".story-pane");
	if (!pane) return null;
	let target: HTMLElement | null = pane.querySelector(".story-body");
	if (file) {
		const chapters = [...pane.querySelectorAll<HTMLElement>(".story-chapter")];
		target = chapters.find((c) => c.querySelector(".story-chapter-file")?.textContent === file) ?? null;
		if (!target) return null;
	}
	if (!target) return null;
	const clone = target.cloneNode(true) as HTMLElement;
	inlineFrames(target, clone);
	// 挂到屏外拍：克隆体需要在文档里才有布局
	const stage = document.createElement("div");
	stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${Math.round(target.getBoundingClientRect().width)}px;background:var(--bg,#fff);`;
	stage.appendChild(clone);
	document.body.appendChild(stage);
	try {
		const url = await toPng(clone, { pixelRatio: 1, cacheBust: true });
		const png = url.replace(/^data:image\/png;base64,/, "");
		return { png, width: Math.round(clone.scrollWidth), height: Math.round(clone.scrollHeight) };
	} catch {
		return null;
	} finally {
		stage.remove();
	}
}
