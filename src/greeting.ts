/**
 * 开场白装配（角色卡能力，非生成流程）。
 *
 * 从旧 director.ts 抽出——director 整体已删除（harness 层重做，2026-08-02）。
 * 这里只负责：按 greetingIndex 从卡的开场白池取一条、跑宏替换、加标题。
 */

import { applyMacros } from "./card.ts";
import { getUiLocale } from "./i18n/index.ts";
import type { CharacterCard, RpConfig } from "./types.ts";

/** 开场白正文（首条 firstMes 或用户选中的备选开场白；宏已替换） */
export function buildGreeting(card: CharacterCard, config: RpConfig): string {
	const pool = [card.firstMes, ...card.alternateGreetings];
	const idx = config.greetingIndex ?? 0;
	const mes = (idx >= 0 && idx < pool.length ? pool[idx] : "") || card.firstMes;
	const head = getUiLocale() === "en" ? `[Opening · ${card.name}]` : `【开场 · ${card.name}】`;
	return `${head}\n${applyMacros(mes, { charName: card.name, userName: config.userName })}`;
}
