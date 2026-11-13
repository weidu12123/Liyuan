/**
 * 预设宏求值器 —— 复刻酒馆 evaluateMacros 的两条语义。
 *
 * 承诺边界（文档同步）：求值 setvar / getvar / addvar / random / roll / trim / {{//注释}} /
 * lastusermessage / char / user；**清单外的 {{…}} 原样保留**，仅记入 unsupported 供调用方上报。
 * 后者是酒馆行为（macros.js 只替换认识的宏，其余留在编译后的提示词里）：作者大量拿
 * {{字段说明}} 当写给模型看的占位符（状态栏字段尤甚），剥掉等于删作者的话。
 *
 * 语义要点：
 * - 变量表挂在 MacroEnv 上，跨块共享：按预设块顺序依次求值，前面块 setvar、后面块 getvar。
 * - 求值内层优先（嵌套宏先解），setvar 的值为急切求值结果。
 * - {{random}} / {{roll}} 内容寻址钉死：同参数恒得同值（见 evalToken 内注）。
 * - 轮数耗尽的残留 token 同样原样保留，不再剥净。
 */

export interface MacroEnv {
	vars: Map<string, string>;
	globalVars: Map<string, string>;
	charName: string;
	userName: string;
	/** 本轮用户原文（{{lastusermessage}}）；戏外/缺省为 undefined → 空串 */
	userText?: string;
	/** 当前聊天最新一条消息正文（{{lastmessage}}） */
	lastMessage?: string;
	/** 当前聊天最新一条角色回复正文（{{lastcharmessage}}） */
	lastCharMessage?: string;
	/** 世界书 position=7 (outlet) 槽位映射 */
	outlets?: Map<string, string>;
	/** 本轮求值发生过写入的局部键 */
	dirtyLocal?: Set<string>;
	/** 本轮求值发生过写入的全局键 */
	dirtyGlobal?: Set<string>;
}

interface MacroEvalResult {
	text: string;
	/** 本次调用遇到的清单外宏名（去重） */
	unsupported: string[];
}

function toMacroMap(src?: Map<string, string> | Record<string, unknown>): Map<string, string> {
	const map = new Map<string, string>();
	if (!src) return map;
	if (src instanceof Map) {
		for (const [k, v] of src.entries()) map.set(String(k), String(v ?? ""));
		return map;
	}
	for (const [k, v] of Object.entries(src)) {
		if (v === undefined) continue;
		map.set(k, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
	}
	return map;
}

export function createMacroEnv(init: {
	charName: string;
	userName: string;
	userText?: string;
	lastMessage?: string;
	lastCharMessage?: string;
	vars?: Map<string, string> | Record<string, unknown>;
	globalVars?: Map<string, string> | Record<string, unknown>;
	outlets?: Map<string, string> | Record<string, unknown>;
}): MacroEnv {
	return {
		vars: toMacroMap(init.vars),
		globalVars: toMacroMap(init.globalVars),
		outlets: init.outlets ? toMacroMap(init.outlets) : undefined,
		charName: init.charName,
		userName: init.userName,
		userText: init.userText,
		lastMessage: init.lastMessage,
		lastCharMessage: init.lastCharMessage,
		dirtyLocal: new Set(),
		dirtyGlobal: new Set(),
	};
}

function addVarValue(map: Map<string, string>, key: string, value: string, dirty?: Set<string>): void {
	const k = key.trim();
	if (!k) return;
	const cur = map.get(k);
	const valTrim = value.trim();
	const valNum = Number(valTrim);
	if (cur === undefined) {
		const next = valTrim !== "" && Number.isFinite(valNum) ? String(valNum) : value;
		map.set(k, next);
		dirty?.add(k);
		return;
	}
	const curTrim = cur.trim();
	const curNum = Number(curTrim);
	if (curTrim !== "" && valTrim !== "" && Number.isFinite(curNum) && Number.isFinite(valNum)) {
		map.set(k, String(curNum + valNum));
	} else {
		map.set(k, cur + value);
	}
	dirty?.add(k);
}

function stepVarValue(map: Map<string, string>, key: string, delta: 1 | -1, dirty?: Set<string>): string {
	const k = key.trim();
	if (!k) return "";
	const cur = map.get(k);
	const curTrim = cur?.trim() ?? "";
	const n = curTrim !== "" && Number.isFinite(Number(curTrim)) ? Number(curTrim) : 0;
	const next = String(n + delta);
	map.set(k, next);
	dirty?.add(k);
	return next;
}

const MAX_PASSES = 16;
/** 内层优先的宏 token：{{ 到最近的 }}，内部不再含 {{ */
const TOKEN = /\{\{(?:(?!\{\{)[\s\S])*?\}\}/g;
const COMMENT = /\{\{\s*\/\/[\s\S]*?\}\}/g;
const TRIM = /\s*\{\{\s*trim\s*\}\}\s*/gi;

export function evalPresetMacros(text: string, env: MacroEnv): MacroEvalResult {
	const unsupported = new Set<string>();
	let t = text;
	for (let pass = 0; pass < MAX_PASSES; pass++) {
		const before = t;
		t = t.replace(COMMENT, "");
		t = t.replace(TRIM, "");
		t = t.replace(TOKEN, (token) => evalToken(token, env, unsupported));
		if (t === before) break;
	}
	// 注释与 {{trim}} 始终剥净（酒馆同样剥）；其余残留 token 原样保留，交给模型看见
	t = t.replace(COMMENT, "").replace(TRIM, "");
	return { text: t, unsupported: [...unsupported] };
}

function evalToken(token: string, env: MacroEnv, unsupported: Set<string>): string {
	const body = token.slice(2, -2);
	// 宏名：到第一个冒号/空白为止（兼容 {{random:a,b}} 单冒号旧写法）
	const nameMatch = body.match(/^\s*([^:\s{}]+)/);
	const name = (nameMatch?.[1] ?? "").toLowerCase();
	// 参数区：宏名后剥掉一个 :: 或 :
	const rest = body.slice((nameMatch?.[0] ?? "").length).replace(/^(::|:)/, "");

	switch (name) {
		case "char":
		case "charifnotgroup":
			return env.charName;
		case "user":
			return env.userName;
		case "lastusermessage":
			return env.userText ?? "";
		case "lastmessage":
			return env.lastMessage ?? "";
		case "lastcharmessage":
			return env.lastCharMessage ?? "";
		case "space": {
			const n = Math.max(1, Math.min(200, Math.trunc(Number(rest.trim()) || 1)));
			return " ".repeat(n);
		}
		case "newline": {
			const n = Math.max(1, Math.min(50, Math.trunc(Number(rest.trim()) || 1)));
			return "\n".repeat(n);
		}
		case "noop":
			return "";
		case "setvar": {
			const [key, ...valueParts] = rest.split("::");
			if (key !== undefined && key.trim()) {
				const k = key.trim();
				env.vars.set(k, valueParts.join("::"));
				env.dirtyLocal?.add(k);
			}
			return "";
		}
		case "addvar": {
			const [key, ...valueParts] = rest.split("::");
			if (key !== undefined && key.trim()) {
				addVarValue(env.vars, key, valueParts.join("::"), env.dirtyLocal);
			}
			return "";
		}
		case "incvar":
			return stepVarValue(env.vars, rest.split("::")[0] ?? "", 1, env.dirtyLocal);
		case "decvar":
			return stepVarValue(env.vars, rest.split("::")[0] ?? "", -1, env.dirtyLocal);
		case "getvar":
			return env.vars.get(rest.split("::")[0]?.trim() ?? "") ?? "";
		case "hasvar":
		case "varexists":
			return env.vars.has(rest.split("::")[0]?.trim() ?? "") ? "true" : "false";
		case "deletevar":
		case "flushvar": {
			const k = rest.split("::")[0]?.trim() ?? "";
			if (k) {
				env.vars.delete(k);
				env.dirtyLocal?.add(k);
			}
			return "";
		}
		case "setglobalvar": {
			const [key, ...valueParts] = rest.split("::");
			if (key !== undefined && key.trim()) {
				const k = key.trim();
				env.globalVars.set(k, valueParts.join("::"));
				env.dirtyGlobal?.add(k);
			}
			return "";
		}
		case "addglobalvar": {
			const [key, ...valueParts] = rest.split("::");
			if (key !== undefined && key.trim()) {
				addVarValue(env.globalVars, key, valueParts.join("::"), env.dirtyGlobal);
			}
			return "";
		}
		case "incglobalvar":
			return stepVarValue(env.globalVars, rest.split("::")[0] ?? "", 1, env.dirtyGlobal);
		case "decglobalvar":
			return stepVarValue(env.globalVars, rest.split("::")[0] ?? "", -1, env.dirtyGlobal);
		case "getglobalvar":
			return env.globalVars.get(rest.split("::")[0]?.trim() ?? "") ?? "";
		case "outlet": {
			const outletKey = rest.split("::")[0]?.trim() ?? "";
			if (env.outlets) return env.outlets.get(outletKey) ?? "";
			if (name) unsupported.add(name);
			return token;
		}
		case "random": {
			const args = rest.includes("::") ? rest.split("::") : rest.split(",");
			// 内容寻址钉死（M-C，TAXONOMY §4.5）：同参数恒选同项。破限信件体的几十个
			// {{random}} 若每拍重摇，system 头部字节每拍不同 → R3 前缀缓存全砸。
			// 变体性对本架构无价值（防缓存是 ST 场景的意图），缓存稳定是硬收益。
			let h = 0;
			for (let i = 0; i < rest.length; i++) h = (h * 31 + rest.charCodeAt(i)) | 0;
			const picked = args[Math.abs(h) % args.length] ?? "";
			return picked;
		}
		case "roll": {
			// 语法同 ST：{{roll:XdY(+Z)}} 或 {{roll XdY}}；dY 省略个数按 1 计
			const expr = rest.trim();
			const dice = expr.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
			const faces = dice ? Number(dice[2]) : 0;
			if (!dice || !Number.isFinite(faces) || faces < 1) {
				unsupported.add(name);
				return token;
			}
			const count = Math.min(Math.max(dice[1] ? Number(dice[1]) : 1, 1), 100);
			// 与 {{random}} 同一条内容寻址钉死：同表达式恒得同值，保住 R3 前缀缓存
			let h = 0;
			for (let i = 0; i < expr.length; i++) h = (h * 31 + expr.charCodeAt(i)) | 0;
			let sum = 0;
			for (let i = 0; i < count; i++) {
				h = (h * 1103515245 + 12345) | 0;
				sum += (Math.abs(h) % faces) + 1;
			}
			return String(sum + (dice[3] ? Number(dice[3]) : 0));
		}
		default:
			// 酒馆语义：不认识的宏原样留在提示词里（多半是作者写给模型看的占位符）
			if (name) unsupported.add(name);
			return token;
	}
}
