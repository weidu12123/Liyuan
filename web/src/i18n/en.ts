/**
 * 英文目录：按界面区域分片，避免多人/多刀同时改一个文件。
 * 键＝中文原文；同一个键在多片里出现时后者覆盖（i18n-check 会报不一致的重复）。
 */
import { app } from "./en/app.ts";
import { cards } from "./en/cards.ts";
import { connect } from "./en/connect.ts";
import { core } from "./en/core.ts";
import { lore } from "./en/lore.ts";
import { messages } from "./en/messages.ts";
import { panels } from "./en/panels.ts";
import { powers } from "./en/powers.ts";
import { preset } from "./en/preset.ts";
import { sessions } from "./en/sessions.ts";

export const en: Record<string, string> = {
	...core,
	...app,
	...messages,
	...sessions,
	...cards,
	...lore,
	...preset,
	...connect,
	...powers,
	...panels,
};
