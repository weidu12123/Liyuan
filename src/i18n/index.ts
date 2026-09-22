/**
 * 服务端界面文案的中 / 英切换（docs/PLAN-I18N.md）。
 *
 * 进程级一个 locale，跟 `config.uiLanguage` 走（`loadConfig` 每次读盘都对齐一次）。
 * 只给送到界面的话用：抛给前端的错误、notify、过程条摘要、运行时生成的缺省名。
 * 送模文案、落盘协议（目录名、条目类型）永远不经过这里。
 */

import { en } from "./en.ts";

export type UiLocale = "zh" | "en";

let current: UiLocale = "zh";

export function getUiLocale(): UiLocale {
	return current;
}

/** 非法值当没写：保持 zh */
export function setUiLocale(v: unknown): void {
	current = v === "en" ? "en" : "zh";
}

export type TVars = Record<string, string | number | boolean | null | undefined>;

function fill(template: string, vars?: TVars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars && vars[k] != null ? String(vars[k]) : m));
}

/** 同前端 t()：键＝中文原文；占位符 `{name}`；英文条目 `a|b` 按 n 选单复数；缺条目回落中文 */
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

export { en as enCatalog };
