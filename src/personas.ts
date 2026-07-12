/**
 * 用户角色（persona）存储（PLAN-PANELS-V2 §2.5）：多身份清单 + 当前选择 + 按卡绑定。
 *
 * 落点 .liyuan-personas.json（项目根，全局共享不按卡分）。config.userName/userPersona
 * 是"当前 persona 的投影"——切换 persona 即写进 liyuan.config.json（触发会话重载）。
 * 绑定：全局 current + 按卡 map（打开某卡会话时按"卡锁定→current"优先级自动选用）。
 * 头像：assets/personas/<id>.png，路径记在 persona.avatar（相对项目根）。
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PERSONAS_FILE } from "./paths.ts";

export interface Persona {
	id: string;
	name: string;
	persona: string;
	/** 头像相对路径（如 assets/personas/pxxx.png）；无则前端显示字首 */
	avatar?: string;
}

export interface PersonaStore {
	personas: Persona[];
	/** 当前选中的 persona id（全局默认） */
	current: string | null;
	/** 按卡锁定：卡路径 → persona id */
	byCard: Record<string, string>;
}

const storePath = (cwd: string) => join(cwd, PERSONAS_FILE);

/** 头像默认落点（按 id 一图；PNG） */
export function personaAvatarRelPath(id: string): string {
	const safe = id.replace(/[^a-zA-Z0-9_-]/g, "_") || "persona";
	return `assets/personas/${safe}.png`;
}

export function personaAvatarAbsPath(cwd: string, id: string): string {
	return join(cwd, personaAvatarRelPath(id));
}

const EMPTY: PersonaStore = { personas: [], current: null, byCard: {} };

export function loadPersonas(cwd: string): PersonaStore {
	const p = storePath(cwd);
	if (!existsSync(p)) return { ...EMPTY, byCard: {} };
	try {
		const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<PersonaStore>;
		return {
			personas: Array.isArray(raw.personas) ? raw.personas.filter(isPersona) : [],
			current: typeof raw.current === "string" ? raw.current : null,
			byCard: raw.byCard && typeof raw.byCard === "object" ? { ...(raw.byCard as Record<string, string>) } : {},
		};
	} catch {
		return { ...EMPTY, byCard: {} };
	}
}

function isPersona(x: unknown): x is Persona {
	if (!x || typeof x !== "object") return false;
	const p = x as Persona;
	if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.persona !== "string") return false;
	if (p.avatar !== undefined && typeof p.avatar !== "string") return false;
	return true;
}

export function savePersonas(cwd: string, store: PersonaStore): void {
	writeFileSync(storePath(cwd), `${JSON.stringify(store, null, "\t")}\n`, "utf8");
}

const genId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 新建 persona，返回其 id */
export function createPersona(
	store: PersonaStore,
	input: { name: string; persona?: string },
): { store: PersonaStore; id: string } {
	const id = genId();
	const p: Persona = { id, name: input.name.trim() || "新身份", persona: (input.persona ?? "").trim() };
	return { store: { ...store, personas: [...store.personas, p] }, id };
}

export function updatePersona(
	store: PersonaStore,
	id: string,
	patch: { name?: string; persona?: string; avatar?: string | null },
): PersonaStore {
	return {
		...store,
		personas: store.personas.map((p) => {
			if (p.id !== id) return p;
			const next: Persona = {
				...p,
				...(patch.name !== undefined ? { name: patch.name.trim() || p.name } : {}),
				...(patch.persona !== undefined ? { persona: patch.persona } : {}),
			};
			if (patch.avatar === null) delete next.avatar;
			else if (typeof patch.avatar === "string") next.avatar = patch.avatar;
			return next;
		}),
	};
}

/** 写入头像文件并回写 store.avatar；data 为裁剪后的 PNG/JPEG 字节 */
export function savePersonaAvatar(cwd: string, store: PersonaStore, id: string, data: Buffer): PersonaStore {
	if (!findPersona(store, id)) throw new Error("身份不存在");
	if (data.length < 24) throw new Error("图片过小或为空");
	// 简单魔数：PNG / JPEG
	const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
	const isJpg = data[0] === 0xff && data[1] === 0xd8;
	if (!isPng && !isJpg) throw new Error("仅支持 PNG / JPEG 头像");
	const rel = personaAvatarRelPath(id);
	const abs = join(cwd, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, data);
	return updatePersona(store, id, { avatar: rel });
}

/** 清除头像字段并尽量删除文件 */
export function clearPersonaAvatar(cwd: string, store: PersonaStore, id: string): PersonaStore {
	const p = findPersona(store, id);
	if (!p) throw new Error("身份不存在");
	const paths = new Set<string>();
	if (p.avatar) paths.add(join(cwd, p.avatar));
	paths.add(personaAvatarAbsPath(cwd, id));
	for (const abs of paths) {
		try {
			if (existsSync(abs)) unlinkSync(abs);
		} catch {
			// 文件删不掉不阻塞
		}
	}
	return updatePersona(store, id, { avatar: null });
}

export function deletePersona(cwd: string, store: PersonaStore, id: string): PersonaStore {
	// 顺带清头像文件
	const withClear = findPersona(store, id) ? clearPersonaAvatar(cwd, store, id) : store;
	const byCard: Record<string, string> = {};
	for (const [card, pid] of Object.entries(withClear.byCard)) if (pid !== id) byCard[card] = pid;
	return {
		...withClear,
		personas: withClear.personas.filter((p) => p.id !== id),
		current: withClear.current === id ? null : withClear.current,
		byCard,
	};
}

export const findPersona = (store: PersonaStore, id: string | null | undefined): Persona | null =>
	id ? (store.personas.find((p) => p.id === id) ?? null) : null;

/** 打开某卡时应选用的 persona（卡锁定优先，回落全局 current） */
export function personaForCard(store: PersonaStore, cardPath: string): Persona | null {
	return findPersona(store, store.byCard[cardPath]) ?? findPersona(store, store.current);
}
