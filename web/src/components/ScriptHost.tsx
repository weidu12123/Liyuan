/**
 * 页面级脚本宿主：每条启用脚本运行在各自独立的隐藏同源 iframe（`TH-script--<source>--<id>`），
 * 使每条脚本的全局命名空间、`getScriptId()` 与 `script` 作用域变量物理隔离，
 * 同时通过父页外链 `<script src>` 同步拦截守卫与按帧/整体清理收口生命周期。
 */

import { useEffect, useRef } from "react";
import { authorScriptSig } from "../../../src/authorScripts.ts";
import type { AuthorScript } from "../wire.ts";
import {
	AUTHOR_SCRIPTS_GLOBAL,
	buildScriptHostDoc,
	isBlockedExternalScriptNode,
	SCRIPT_HOST_SANDBOX,
	scriptFrameMeta,
} from "../scriptHostDoc.ts";
import { t } from "../i18n/index.ts";

export { isBlockedExternalScriptNode, scriptFrameMeta };

type HostWindow = Window & { [AUTHOR_SCRIPTS_GLOBAL]?: AuthorScript[] };

/** 这些节点是梨园自己的：React 根，以及包含根的祖先（万一将来根被包了一层） */
function isLiyuanOwned(el: Element, root: Element | null): boolean {
	if (!root) return false;
	return el === root || el.contains(root);
}

/** 在父页挂载作者脚本期间启用同步外链 `<script src>` 插入拦截，全部脚本退出后恢复原型 */
function installExternalScriptGuard(): () => void {
	const topSet = new Set<unknown>([document.body, document.head, document.documentElement]);
	const origin = typeof window !== "undefined" ? window.location?.origin : undefined;
	const origAppendChild = Node.prototype.appendChild;
	const origInsertBefore = Node.prototype.insertBefore;
	const warnBlocked = (node: unknown) => {
		const el = node as { src?: string; getAttribute?: (k: string) => string | null };
		const src = el?.getAttribute?.("src") || el?.src || "";
		console.warn(`[liyuan scriptHost] 已拦截向父页插入外部脚本：${src}`); // i18n-ignore
	};
	Node.prototype.appendChild = function <T extends Node>(this: Node, child: T): T {
		if (topSet.has(this) && isBlockedExternalScriptNode(child, origin)) {
			warnBlocked(child);
			return child;
		}
		return origAppendChild.call(this, child) as T;
	};
	Node.prototype.insertBefore = function <T extends Node>(this: Node, child: T, refNode: Node | null): T {
		if (topSet.has(this) && isBlockedExternalScriptNode(child, origin)) {
			warnBlocked(child);
			return child;
		}
		return origInsertBefore.call(this, child, refNode) as T;
	};
	return () => {
		Node.prototype.appendChild = origAppendChild;
		Node.prototype.insertBefore = origInsertBefore;
	};
}

function ScriptFrame({
	script,
	ownerMap,
	onBootWindow,
}: {
	script: AuthorScript;
	ownerMap: WeakMap<Element, string>;
	onBootWindow: (frameKey: string, active: boolean) => void;
}) {
	const meta = scriptFrameMeta(script);
	const frameRef = useRef<HTMLIFrameElement | null>(null);

	useEffect(() => {
		onBootWindow(meta.key, true);
		const timer = window.setTimeout(() => onBootWindow(meta.key, false), 150);

		const onBooted = (e: MessageEvent) => {
			if (e.source !== frameRef.current?.contentWindow) return;
			const d = e.data as { liyuanScriptHostBooted?: { ok: number; failed: number; total: number; scriptId?: string } } | null;
			const rep = d && typeof d === "object" ? d.liyuanScriptHostBooted : null;
			if (!rep) return;
			onBootWindow(meta.key, false);
		};
		window.addEventListener("message", onBooted);

		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("message", onBooted);
			onBootWindow(meta.key, false);
			let frameDoc: Document | null = null;
			try {
				frameDoc = frameRef.current?.contentDocument ?? null;
			} catch {
				frameDoc = null;
			}
			// 先停帧（销毁计时器与监听），再回收确定归属本帧挂载的父页节点
			try {
				const f = frameRef.current;
				if (f) f.src = "about:blank";
			} catch {
				/* 帧已被 React 摘掉 */
			}
			const root = document.getElementById("root");
			const containers = [document.body, document.head, document.documentElement];
			for (const parent of containers) {
				if (!parent) continue;
				for (const el of Array.from(parent.children)) {
					if (el === document.head || el === document.body) continue;
					if (isLiyuanOwned(el, root)) continue;
					if (ownerMap.get(el) === meta.key || (frameDoc && el.ownerDocument === frameDoc)) {
						try {
							el.remove();
						} catch {
							/* ignore */
						}
					}
				}
			}
		};
	}, [meta.key, ownerMap, onBootWindow]);

	return (
		<iframe
			ref={frameRef}
			id={meta.frameId}
			name={meta.frameId}
			data-liyuan-card-runtime="script"
			data-liyuan-script-key={meta.key}
			title={t("作者脚本宿主")}
			aria-hidden="true"
			tabIndex={-1}
			sandbox={SCRIPT_HOST_SANDBOX}
			srcDoc={buildScriptHostDoc()}
			style={{ position: "absolute", width: 0, height: 0, border: 0, visibility: "hidden" }}
		/>
	);
}

export function ScriptHost({ scripts }: { scripts: AuthorScript[] }) {
	const generation = authorScriptSig(scripts);
	const ownerMapRef = useRef<WeakMap<Element, string>>(new WeakMap());
	const activeBootKeysRef = useRef<string[]>([]);
	const scriptsRef = useRef(scripts);
	scriptsRef.current = scripts;

	const handleBootWindow = useRef((frameKey: string, active: boolean) => {
		const list = activeBootKeysRef.current;
		if (active) {
			if (!list.includes(frameKey)) list.push(frameKey);
		} else {
			const idx = list.indexOf(frameKey);
			if (idx >= 0) list.splice(idx, 1);
		}
	});

	/**
	 * 清单在渲染期即挂到父页全局，避免子帧比父 effect 先加载读到 undefined。
	 */
	if (typeof window !== "undefined" && scripts.length) {
		(window as HostWindow)[AUTHOR_SCRIPTS_GLOBAL] = scripts;
	}

	useEffect(() => {
		const currentScripts = scriptsRef.current;
		if (!currentScripts.length) return;
		const w = window as HostWindow;
		w[AUTHOR_SCRIPTS_GLOBAL] = currentScripts;

		const root = document.getElementById("root");
		const containers = [document.body, document.head, document.documentElement] as const;
		const baseline = containers.map((c) => new Set(Array.from(c.children)));

		const removeGuard = installExternalScriptGuard();

		const observer = new MutationObserver((mutations) => {
			const activeKeys = activeBootKeysRef.current;
			const singleOwner = activeKeys.length === 1 ? activeKeys[0] : undefined;
			if (!singleOwner) return;
			for (const m of mutations) {
				for (const node of Array.from(m.addedNodes)) {
					if (node instanceof Element && !isLiyuanOwned(node, root) && !ownerMapRef.current.has(node)) {
						ownerMapRef.current.set(node, singleOwner);
					}
				}
			}
		});
		for (const c of containers) {
			observer.observe(c, { childList: true });
		}

		return () => {
			observer.disconnect();
			removeGuard();
			// 当整批脚本清空卸载或清单重生成时，保证父页所有非 baseline 新增作者节点清零
			for (const [i, parent] of containers.entries()) {
				for (const el of Array.from(parent.children)) {
					if (baseline[i]!.has(el)) continue;
					if (el === document.head || el === document.body) continue;
					if (isLiyuanOwned(el, root)) continue;
					try {
						el.remove();
					} catch {
						/* 已被单帧或脚本自身移除 */
					}
				}
			}
			if (w[AUTHOR_SCRIPTS_GLOBAL] === currentScripts) delete w[AUTHOR_SCRIPTS_GLOBAL];
		};
	}, [generation]);

	if (!scripts.length) return null;
	return (
		<>
			{scripts.map((s) => {
				const meta = scriptFrameMeta(s);
				return (
					<ScriptFrame
						key={meta.reactKey}
						script={s}
						ownerMap={ownerMapRef.current}
						onBootWindow={handleBootWindow.current}
					/>
				);
			})}
		</>
	);
}
