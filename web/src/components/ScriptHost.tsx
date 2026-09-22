/**
 * 页面级脚本宿主：跑卡/预设声明的作者运行时脚本，让它们的常驻 UI（悬浮球等）
 * 挂在**梨园页面**上而不是某条消息的气泡里。
 *
 * 数据来自 `cardfront.scripts`（见 src/authorScripts.ts）；文档由 scriptHostDoc 拼；
 * 本组件只管三件事：给帧一个稳定的生命周期、把清单递到同源全局、**换卡时把作者挂上来的
 * 东西收回去**。
 *
 * ## 「作者挂了什么」怎么判——按形状，不按名字
 * 梨园自己的一切都渲染在 `#root` 里（全仓零 `createPortal`，body 的持久顶层子节点只有它）。
 * 所以判据是：**宿主活着期间，新出现在 `body`/`head` 顶层、且不属于 `#root` 的节点，归作者**。
 * 收回时只删这些。不问 id、不问 class、不列卡名——换一张没见过的卡照样成立。
 *
 * 为什么非收不可：作者脚本开头都会 `pdoc.getElementById(自己的ID)?.remove()` 自清，
 * 但那只在**同一个脚本再次运行**时有效。从「带球的卡」切到「不带球的卡」时没人再跑那段，
 * 球就永远留在屏幕上了。这一步是梨园对自己页面的责任，不能指望作者代码。
 */

import { useEffect, useRef } from "react";
import { authorScriptSig } from "../../../src/authorScripts.ts";
import type { AuthorScript } from "../wire.ts";
import { AUTHOR_SCRIPTS_GLOBAL, buildScriptHostDoc, SCRIPT_HOST_SANDBOX } from "../scriptHostDoc.ts";
import { t } from "../i18n/index.ts";

type HostWindow = Window & { [AUTHOR_SCRIPTS_GLOBAL]?: AuthorScript[] };

/** 这些节点是梨园自己的：React 根，以及包含根的祖先（万一将来根被包了一层） */
function isLiyuanOwned(el: Element, root: Element | null): boolean {
	if (!root) return false;
	return el === root || el.contains(root);
}

export function ScriptHost({ scripts }: { scripts: AuthorScript[] }) {
	/**
	 * 清单指纹：换卡/换预设才重启宿主；同一份清单重渲染不动帧（重启＝作者脚本重跑一遍）。
	 * 用 authorScriptSig 而不是在这儿手写一遍——服务端的轻清单、App 的「要不要拉正文」、
	 * 这里的「要不要重启帧」是同一个判断，抄三遍就等着它们哪天对不上。
	 */
	const generation = authorScriptSig(scripts);
	const frameRef = useRef<HTMLIFrameElement | null>(null);

	/**
	 * 清单在**渲染期**就挂上去，不能等 effect——React 先提交 DOM（iframe 随即开始加载并跑加载器）
	 * 再跑 effect，反过来就有一个真实竞态：帧读 `parent.__liyuanAuthorScripts` 读到 undefined，
	 * 一条脚本都不跑。渲染期赋值发生在提交之前，顺序才是确定的。
	 * 赋值幂等（同一份清单写几遍都一样），StrictMode 双渲染无副作用。
	 */
	if (typeof window !== "undefined" && scripts.length) {
		(window as HostWindow)[AUTHOR_SCRIPTS_GLOBAL] = scripts;
	}

	useEffect(() => {
		if (!scripts.length) return;
		const w = window as HostWindow;
		w[AUTHOR_SCRIPTS_GLOBAL] = scripts;

		const root = document.getElementById("root");
		/**
		 * 三个顶层容器都要看。**`documentElement` 不是多余的**：实测有作者写
		 * `(pdoc.documentElement || pdoc.body).appendChild(root)`，球就成了 `<html>` 的直接子节点、
		 * 与 `<head>`/`<body>` 平级（照样按 fixed 正常渲染）。只盯 body/head 会漏掉整个球，
		 * 换卡后它就赖在屏幕上了——这是真卡实测抓出来的，不是设想。
		 */
		const containers = [document.body, document.head, document.documentElement] as const;
		const before = containers.map((c) => new Set(Array.from(c.children)));

		/** 宿主活着期间新增的顶层节点里，属于作者的那些 */
		const authorMounted = (): Element[] => {
			const out = new Set<Element>();
			for (const [i, parent] of containers.entries()) {
				for (const el of Array.from(parent.children)) {
					if (before[i].has(el)) continue;
					// documentElement 的子节点里 head/body 本身要排除（它们在快照里，但保险起见）
					if (el === document.head || el === document.body) continue;
					if (isLiyuanOwned(el, root)) continue;
					out.add(el);
				}
			}
			return [...out];
		};

		// 诊断：脚本跑完却什么都没往父页挂，多半是 same-origin 没生效、
		// 作者的降级分支把 UI 挂进了这个 0×0 的隐藏帧里（用户会看到「什么都没发生」）。
		const onBooted = (e: MessageEvent) => {
			if (e.source !== frameRef.current?.contentWindow) return;
			const d = e.data as { liyuanScriptHostBooted?: { ok: number; failed: number; total: number } } | null;
			const rep = d && typeof d === "object" ? d.liyuanScriptHostBooted : null;
			if (!rep) return;
			window.setTimeout(() => {
				const n = authorMounted().length;
				if (rep.ok > 0 && n === 0) {
					// 开发者控制台诊断，不是界面文案
					console.warn(
						`[liyuan scriptHost] ${rep.ok} 份作者脚本已执行，但父页没有新增节点——` + // i18n-ignore
							`若卡带悬浮球却不见踪影，检查宿主帧的 same-origin 是否生效`, // i18n-ignore
					);
				}
			}, 1200);
		};
		window.addEventListener("message", onBooted);

		return () => {
			window.removeEventListener("message", onBooted);
			// 先卸帧（停掉作者的 setInterval/监听），再收 DOM——反了的话计时器可能把节点又画回来
			try {
				const f = frameRef.current;
				if (f) f.src = "about:blank";
			} catch {
				/* 帧已被 React 摘掉 */
			}
			for (const el of authorMounted()) {
				try {
					el.remove();
				} catch {
					/* 已被作者自己清掉 */
				}
			}
			// 只在全局还是我们挂的那一份时才摘：换卡时新一轮渲染已经把新清单挂上去了，
			// 旧 effect 的 cleanup 在那之后跑，无条件 delete 会把新清单一起删掉（新帧读不到）。
			if (w[AUTHOR_SCRIPTS_GLOBAL] === scripts) delete w[AUTHOR_SCRIPTS_GLOBAL];
		};
	}, [generation]);

	if (!scripts.length) return null;
	return (
		<iframe
			key={generation}
			ref={frameRef}
			name="liyuan-script-host"
			data-liyuan-card-runtime="script"
			title={t("作者脚本宿主")}
			aria-hidden="true"
			tabIndex={-1}
			sandbox={SCRIPT_HOST_SANDBOX}
			srcDoc={buildScriptHostDoc()}
			// 自己不显示任何东西：零尺寸 + 隐藏，产物挂在父页。用 visibility 而非 display:none,
			// 后者在部分浏览器里会让帧内布局测量拿到 0（作者脚本常量父窗口尺寸算球的初始位置）。
			style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }}
		/>
	);
}
