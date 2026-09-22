/**
 * 界面文案的中 / 英切换（docs/PLAN-I18N.md）。
 *
 * 键＝中文原文：源码里照旧写中文，`en` 目录是一张「中文 → 英文」的表；缺条目回落中文。
 * 只有界面外壳走这里——正文、状态栏、卡皮肤、过程记录里的模型输出永远不经过 t()。
 *
 * locale 的来源：`config.uiLanguage`（一个实例一种语言，服务端也按它出话）。配置还没到
 * （登录页）或没写时，按浏览器语言先显示；上次生效的值缓存在 localStorage，避免首屏闪一下。
 */

import { useSyncExternalStore } from "react";
import { en } from "./en.ts";
import { readUiJson, writeUiJson } from "../uiStore.ts";

export type UiLocale = "zh" | "en";

const STORE_KEY = "liyuan.ui.lang";

function fromNavigator(): UiLocale {
	try {
		const lang = (navigator.language || "").toLowerCase();
		return lang.startsWith("zh") ? "zh" : "en";
	} catch {
		return "zh";
	}
}

function coerce(v: unknown): UiLocale | null {
	return v === "zh" || v === "en" ? v : null;
}

let current: UiLocale = coerce(readUiJson<string>(STORE_KEY)) ?? fromNavigator();
const listeners = new Set<() => void>();

function applyDocument(): void {
	try {
		document.documentElement.lang = current === "zh" ? "zh-CN" : "en";
	} catch {
		/* 非浏览器环境（测试） */
	}
}
applyDocument();

/** 当前界面语言（非 React 代码用） */
export function getLocale(): UiLocale {
	return current;
}

/** 切换并通知所有 useLocale 的组件；写 localStorage 缓存。落盘到配置由调用方负责。 */
export function setLocale(next: UiLocale): void {
	if (next === current) return;
	current = next;
	writeUiJson(STORE_KEY, next);
	applyDocument();
	for (const fn of listeners) fn();
}

/** 配置到达时对齐：配置里写了就以它为准；没写就保持当前（浏览器语言 / 缓存） */
export function syncLocaleFromConfig(uiLanguage: unknown): void {
	const v = coerce(uiLanguage);
	if (v) setLocale(v);
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** 组件里订阅语言：切换时重渲染。App 顶层订阅一次即可级联；被 memo 的组件自己再订阅。 */
export function useLocale(): UiLocale {
	return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export type TVars = Record<string, string | number | boolean | null | undefined>;

function fill(template: string, vars?: TVars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars && vars[k] != null ? String(vars[k]) : m));
}

/**
 * 翻译一句外壳文案。
 * - `t("保存")`
 * - `t("已建立配置仓库：{ids}", { ids })`——占位符 `{name}`
 * - 英文条目可写 `"{n} chapter|{n} chapters"`：按 `vars.n`（没有 n 就取第一个数字变量）是否为 1 选单复数
 */
export function t(zh: string, vars?: TVars): string {
	let out = zh;
	if (current === "en") {
		const hit = en[zh];
		if (hit !== undefined) {
			out = hit;
			if (out.includes("|")) {
				const n = vars ? (typeof vars.n === "number" ? vars.n : Object.values(vars).find((v) => typeof v === "number")) : undefined;
				const [one, many] = out.split("|");
				out = n === 1 ? one : (many ?? one);
			}
		}
	}
	return fill(out, vars);
}

/** 日期时间按当前语言格式化（只给外壳；正文里的时间不经这里） */
export function fmtDateTime(d: Date | number | string, opts?: Intl.DateTimeFormatOptions): string {
	const date = d instanceof Date ? d : new Date(d);
	if (Number.isNaN(date.getTime())) return "";
	try {
		return date.toLocaleString(current === "zh" ? "zh-CN" : "en-US", opts);
	} catch {
		return date.toISOString();
	}
}

/** 供测试/脚本核对：英文目录本身 */
export { en as enCatalog };
