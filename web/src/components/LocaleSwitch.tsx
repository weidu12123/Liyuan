/**
 * 界面语言切换（中 / EN）。
 * persist=true：写进 config.uiLanguage（一个实例一种语言，服务端也跟着换）；
 * persist=false：只改本浏览器显示（登录页——还没登录，写不了配置）。
 */

import { apiPut } from "../api.ts";
import { getLocale, setLocale, t, useLocale, type UiLocale } from "../i18n/index.ts";

export function LocaleSwitch({ persist = true, onError }: { persist?: boolean; onError?: (msg: string) => void }) {
	const locale = useLocale();
	const pick = (next: UiLocale) => {
		if (next === getLocale()) return;
		setLocale(next);
		if (persist) {
			apiPut("/api/config", { uiLanguage: next }).catch((e) => onError?.((e as Error).message || t("保存失败")));
		}
	};
	return (
		<div className="seg-row locale-switch" role="group" aria-label={t("界面语言")}>
			<button type="button" className={locale === "zh" ? "seg active" : "seg"} onClick={() => pick("zh")}>
				{"中文" /* i18n-ignore：语言自己的名字 */}
			</button>
			<button type="button" className={locale === "en" ? "seg active" : "seg"} onClick={() => pick("en")}>
				EN
			</button>
		</div>
	);
}
