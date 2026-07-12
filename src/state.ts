/**
 * 结构化世界状态：读写、补丁合并、注入格式化。
 * 这是对 ST「模型忘状态」痛点的架构级解法（PLAN.md §3）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readJsonFile } from "./jsonio.ts";
import type { CharacterState, WorldState } from "./types.ts";

const TOP_KEYS = ["time", "location", "characters", "inventory", "flags", "plot_threads"] as const;

export function defaultState(): WorldState {
	return {
		time: "",
		location: "",
		characters: {},
		inventory: [],
		flags: {},
		plot_threads: [],
	};
}

export function loadState(file: string): WorldState {
	try {
		const raw = readJsonFile(file) as Partial<WorldState>;
		return { ...defaultState(), ...raw };
	} catch {
		return defaultState();
	}
}

export function saveState(file: string, state: WorldState): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

export interface PatchResult {
	state: WorldState;
	/** 人类可读的变更摘要（用于工具返回，让模型确认写入了什么） */
	applied: string[];
	warnings: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const normName = (s: string) => s.trim().toLowerCase();

/**
 * 把补丁中的角色键归一到已知的规范名（大小写/首尾空白不敏感），
 * 防止同一角色被记成多份（实测 flash 会写出 "Alice"/"alice " 变体）。
 * 中文译名与原名的等同（爱丽丝=Alice）无法机械判定，交给 Phase 2 scribe。
 */
export function canonicalizeCharacterKeys(
	patch: Record<string, unknown>,
	knownNames: string[],
): Record<string, unknown> {
	const chars = patch.characters;
	if (!chars || typeof chars !== "object" || Array.isArray(chars)) return patch;

	const canon = new Map<string, string>();
	for (const n of knownNames) {
		const k = normName(n);
		if (k && !canon.has(k)) canon.set(k, n.trim());
	}
	const out: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(chars as Record<string, unknown>)) {
		const key = canon.get(normName(name)) ?? name.trim();
		if (!canon.has(normName(name))) canon.set(normName(name), key);
		// 补丁内部撞到同一规范名：浅合并（后写的字段覆盖）
		if (out[key] && value && typeof value === "object" && typeof out[key] === "object") {
			out[key] = { ...(out[key] as object), ...(value as object) };
		} else {
			out[key] = value;
		}
	}
	return { ...patch, characters: out };
}

/**
 * 合并补丁。语义（工具描述中向模型说明）：
 * - time / location：字符串整体替换
 * - characters：按角色名合并字段；传 null 删除该角色
 * - flags：按键合并；传 null 删除该键
 * - inventory / plot_threads：数组整体替换（须传完整数组）
 * - 未知顶层键拒绝并告警（保持 schema 诚实）
 */
export function applyPatch(state: WorldState, patch: Record<string, unknown>): PatchResult {
	const next: WorldState = structuredClone(state);
	const applied: string[] = [];
	const warnings: string[] = [];

	for (const [key, value] of Object.entries(patch)) {
		switch (key) {
			case "time":
			case "location": {
				if (typeof value === "string") {
					next[key] = value;
					applied.push(`${key} → ${value}`);
				} else warnings.push(`${key} 需要字符串，已忽略`);
				break;
			}
			case "characters": {
				if (value && typeof value === "object" && !Array.isArray(value)) {
					for (const [name, cs] of Object.entries(value as Record<string, unknown>)) {
						if (cs === null) {
							delete next.characters[name];
							applied.push(`characters.${name} 已移除`);
							continue;
						}
						if (!cs || typeof cs !== "object") {
							warnings.push(`characters.${name} 需要对象或 null，已忽略`);
							continue;
						}
						const cur: CharacterState = next.characters[name] ?? { affinity: 0, status: "", notes: "" };
						const p = cs as Partial<Record<keyof CharacterState, unknown>>;
						if (typeof p.affinity === "number") cur.affinity = clamp(Math.round(p.affinity), -100, 100);
						if (typeof p.status === "string") cur.status = p.status;
						if (typeof p.notes === "string") cur.notes = p.notes;
						next.characters[name] = cur;
						applied.push(`characters.${name} 已更新`);
					}
				} else warnings.push("characters 需要对象，已忽略");
				break;
			}
			case "flags": {
				if (value && typeof value === "object" && !Array.isArray(value)) {
					for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
						if (v === null) {
							delete next.flags[k];
							applied.push(`flags.${k} 已移除`);
						} else if (typeof v === "string") {
							next.flags[k] = v;
							applied.push(`flags.${k} → ${v}`);
						} else {
							next.flags[k] = JSON.stringify(v);
							applied.push(`flags.${k} 已更新`);
						}
					}
				} else warnings.push("flags 需要对象，已忽略");
				break;
			}
			case "inventory":
			case "plot_threads": {
				if (Array.isArray(value)) {
					next[key] = value.filter((x): x is string => typeof x === "string");
					applied.push(`${key} → [${next[key].join("、")}]`);
				} else warnings.push(`${key} 需要完整数组（整体替换语义），已忽略`);
				break;
			}
			default:
				warnings.push(`未知字段 ${key}，允许的顶层字段：${TOP_KEYS.join(", ")}`);
		}
	}
	return { state: next, applied, warnings };
}

/** 注入用的紧凑可读格式 */
export function formatState(state: WorldState): string {
	const lines: string[] = [];
	if (state.time) lines.push(`时间：${state.time}`);
	if (state.location) lines.push(`地点：${state.location}`);
	for (const [name, c] of Object.entries(state.characters)) {
		const parts = [`好感 ${c.affinity}`];
		if (c.status) parts.push(`状态：${c.status}`);
		if (c.notes) parts.push(`备注：${c.notes}`);
		lines.push(`${name}：${parts.join("；")}`);
	}
	if (state.inventory.length) lines.push(`物品：${state.inventory.join("、")}`);
	for (const [k, v] of Object.entries(state.flags)) lines.push(`${k}：${v}`);
	if (state.plot_threads.length) lines.push(`剧情线：${state.plot_threads.map((t) => `「${t}」`).join(" ")}`);
	return lines.length ? lines.join("\n") : "（尚无记录）";
}
