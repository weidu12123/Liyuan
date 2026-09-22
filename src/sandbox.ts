/**
 * 工作模式沙箱（docs/PLAN-SANDBOX.md）：卡目录为界，卡外申请。
 *
 * 只管 pi 原生文件工具（NATIVE_TOOL_ACCESS）；梨园自己发行的工具各有门禁（src/tools/gate.ts），
 * MCP 工具在文件沙箱之外。判定是纯函数：路径 + 允许集 → 放行 / 申请；不认命令内容、不建
 * 危险命令名单（铁律三）。申请走既有选择卡（askUser），授权落成数据：会话树条目（本会话）
 * 与 卡.json（永久，跟卡走）。
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { cardAuthoringDirectory } from "./card-authoring.ts";
import { loadCardConfig, resolveCardSpace, saveCardConfig } from "./cardspace.ts";
import type { ConversationEntry } from "./conversation-mode.ts";
import { mountedLorebookPaths } from "./lorebook.ts";
import { CARDS_ROOT, CHATS_DIR, CHAT_HISTORY_DIR, CHAT_SESSIONS_DIR, SHARED_LIBRARY_DIRS, cardsRoot, insidePath } from "./paths.ts";

/** pi 原生工具 → 访问类别。键集＝工作模式开放的原生工具清单（stage/authoring.ts 从这里派生）。 */
export const NATIVE_TOOL_ACCESS = {
	read: "read",
	grep: "read",
	find: "read",
	ls: "read",
	edit: "write",
	write: "write",
	bash: "bash",
} as const;
export type NativeToolName = keyof typeof NATIVE_TOOL_ACCESS;

/** 会话树自定义条目：本会话授权（`{ dir }` 或 `{ bash: true }`），沿当前分支重放 */
export const SANDBOX_GRANT_TYPE = "liyuan-sandbox";

const TOOL_VERB: Record<NativeToolName, string> = {
	read: "读取", grep: "搜索", find: "查找", ls: "列出", edit: "修改", write: "写入", bash: "执行命令",
};

export interface SandboxScope {
	cwd: string;
	/** 卡在 `cards/` 里时的卡目录；不在卡库里的卡为 undefined ⇒ 没有 `卡.json` 可落永久授权 */
	cardDir?: string;
	/** 自由读写根（已取 realpath）：卡目录、创作目录 */
	roots: string[];
	/** 只读根（已取 realpath）：公共库、挂载的书文件 */
	readRoots: string[];
}

export interface SandboxGrants {
	/** 已授权的目录或文件（绝对路径，已取 realpath） */
	dirs: string[];
	bash: boolean;
}

export type SandboxGrant = { dir: string } | { bash: true };

export type SandboxVerdict =
	| { kind: "allow" }
	| { kind: "ask"; tool: NativeToolName; target: string; unit: string }
	| { kind: "ask-bash"; command: string }
	/** harness 管理的数据目录：原生写工具一律拒绝，不申请（reason 即回给模型的回执） */
	| { kind: "deny"; reason: string };

/** 与 pi 工具同一套输入规范化（core/utils/paths.ts normalizePath 的工具侧选项；包未导出，此处照抄） */
function normalizeLikePi(input: string): string {
	let p = input.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
	if (p.startsWith("@")) p = p.slice(1);
	if (process.platform === "win32" && p.startsWith("/") && !p.startsWith("//") && !p.includes("\\")) {
		const m = p.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
		if (m) p = `${m[1]!.toUpperCase()}:\\${(m[2] ?? "").replaceAll("/", "\\")}`;
	}
	if (p === "~") return homedir();
	if (p.startsWith("~/") || (process.platform === "win32" && p.startsWith("~\\"))) return join(homedir(), p.slice(2));
	if (/^file:\/\//.test(p)) return fileURLToPath(p);
	return p;
}

/** 最近存在的祖先取 realpath 再接回不存在的尾巴：写新文件也能识破符号链接 */
export function realExisting(p: string): string {
	let existing = resolve(p);
	const tail: string[] = [];
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) return resolve(p);
		tail.unshift(basename(existing));
		existing = parent;
	}
	try {
		return join(realpathSync(existing), ...tail);
	} catch {
		return resolve(p);
	}
}

const isDir = (p: string): boolean => {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
};

/** 路径类工具的目标（grep/find/ls 不带 path ＝ 工作目录）；bash 与非原生工具无目标 */
export function sandboxTarget(tool: string, input: Record<string, unknown>, cwd: string): string | undefined {
	const access = NATIVE_TOOL_ACCESS[tool as NativeToolName];
	if (!access || access === "bash") return undefined;
	const raw = typeof input.path === "string" && input.path.trim() ? input.path.trim() : ".";
	const normalized = normalizeLikePi(raw);
	return isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
}

/**
 * 授权单位：申请的不是单个文件而是一个范围。
 * 工程根内＝顶层目录；`cards/`、`assets/` 下到第二层（并列无关内容的口袋，不整袋批）；
 * 根下单个文件＝只批那个文件；工程根本身＝工程根；根外＝目标所在目录。
 */
export function grantUnit(cwd: string, target: string): string {
	const root = realExisting(cwd);
	const rel = relative(root, target);
	if (rel === "") return root;
	if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return isDir(target) ? target : dirname(target);
	const segs = rel.split(sep);
	const depth = segs[0] === CARDS_ROOT || segs[0] === "assets" ? 2 : 1;
	if (segs.length <= depth && !isDir(target)) return target;
	return join(root, ...segs.slice(0, depth));
}

export function sandboxScope(cwd: string, config: { card: string; lorebook?: string; lorebooks?: string[] }): SandboxScope {
	const cardAbs = resolve(cwd, config.card);
	const space = resolveCardSpace(cwd, relative(cwd, cardAbs));
	const roots = [space ? space.dir : dirname(cardAbs)];
	try {
		roots.push(cardAuthoringDirectory(cwd, cardAbs));
	} catch {
		// 创作目录不在工作区内：不进允许集
	}
	const readRoots = [
		...SHARED_LIBRARY_DIRS.map((d) => join(cwd, d)),
		...mountedLorebookPaths(config).map((p) => resolve(cwd, p)),
	];
	return { cwd, cardDir: space?.dir, roots: roots.map(realExisting), readRoots: readRoots.map(realExisting) };
}

/**
 * 卡目录里由 harness 持有的数据（docs/PLAN-AGENT-CODING.md §三）：`对话/<id>/历史/`（快照仓）与 `对话/<id>/会话/`（会话树）。
 * 原生写工具不碰这两处；`正文/` 就是稿子，完全开放读写。这是路径规则，不是识别器。
 */
export function harnessManagedPath(cardDir: string | undefined, target: string): boolean {
	if (!cardDir) return false;
	const rel = relative(realExisting(cardDir), target);
	if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return false;
	const segs = rel.split(sep);
	return segs[0] === CHATS_DIR && segs.length >= 3 && (segs[2] === CHAT_HISTORY_DIR || segs[2] === CHAT_SESSIONS_DIR);
}

export function sandboxVerdict(tool: string, input: Record<string, unknown>, scope: SandboxScope, grants: SandboxGrants): SandboxVerdict {
	const access = NATIVE_TOOL_ACCESS[tool as NativeToolName];
	if (!access) return { kind: "allow" };
	if (access === "bash") return grants.bash ? { kind: "allow" } : { kind: "ask-bash", command: String(input.command ?? "") };
	const target = realExisting(sandboxTarget(tool, input, scope.cwd)!);
	if (access === "write" && harnessManagedPath(scope.cardDir, target)) {
		return { kind: "deny", reason: `${display(scope.cwd, target)} 属于梨园管理的数据（快照仓 / 会话树），原生 ${tool} 不能写。` };
	}
	const within = (roots: string[]) => roots.some((r) => insidePath(r, target));
	if (within(scope.roots)) return { kind: "allow" };
	if (access === "read" && within(scope.readRoots)) return { kind: "allow" };
	if (within(grants.dirs)) return { kind: "allow" };
	return { kind: "ask", tool: tool as NativeToolName, target, unit: grantUnit(scope.cwd, target) };
}

// ---------- 授权数据 ----------

export function sandboxGrantsFromBranch(branch: ConversationEntry[]): SandboxGrants {
	const dirs: string[] = [];
	let bash = false;
	for (const e of branch) {
		if (e.type !== "custom" || e.customType !== SANDBOX_GRANT_TYPE) continue;
		const d = e.data as { dir?: unknown; bash?: unknown } | undefined;
		if (typeof d?.dir === "string") dirs.push(d.dir);
		if (d?.bash === true) bash = true;
	}
	return { dirs, bash };
}

/** 落盘形态：工程根内存相对路径（正斜杠，跨机可读），根外存绝对路径 */
function storedPath(cwd: string, abs: string): string {
	const root = realExisting(cwd);
	return insidePath(root, abs) ? relative(root, abs).split(sep).join("/") || "." : abs;
}

export function permanentGrants(cwd: string, cardDir: string | undefined): SandboxGrants {
	if (!cardDir) return { dirs: [], bash: false };
	const c = loadCardConfig(cardDir);
	return { dirs: (c.sandboxAllow ?? []).map((p) => realExisting(resolve(cwd, p))), bash: c.sandboxBash === true };
}

export function addPermanentGrant(cwd: string, cardDir: string, grant: SandboxGrant): void {
	if ("bash" in grant) {
		saveCardConfig(cardDir, { sandboxBash: true });
		return;
	}
	const list = loadCardConfig(cardDir).sandboxAllow ?? [];
	const stored = storedPath(cwd, grant.dir);
	if (!list.includes(stored)) saveCardConfig(cardDir, { sandboxAllow: [...list, stored] });
}

// ---------- 申请 ----------

type AskAction = "once" | "session" | "always" | "deny";
interface AskCard {
	question: string;
	options: Array<{ label: string; action: AskAction }>;
	/** 被拒时回给模型的回执 */
	denied: string;
	grant: SandboxGrant;
}

const display = (cwd: string, p: string): string => {
	const root = realExisting(cwd);
	return insidePath(root, p) ? relative(root, p) || "." : p;
};

export function describeAsk(v: Exclude<SandboxVerdict, { kind: "allow" } | { kind: "deny" }>, scope: SandboxScope): AskCard {
	const always = scope.cardDir !== undefined;
	if (v.kind === "ask-bash") {
		return {
			question: `请求执行命令（bash 不受卡目录限制）：\n${v.command}`,
			options: [
				{ label: "允许一次", action: "once" },
				{ label: "本会话允许 bash", action: "session" },
				...(always ? [{ label: "永久允许 bash（本卡）", action: "always" as const }] : []),
				{ label: "拒绝", action: "deny" },
			],
			denied: "用户拒绝执行该命令。",
			grant: { bash: true },
		};
	}
	const root = realExisting(scope.cwd);
	const unitText = v.unit === root ? "整个工程根（含其他卡）"
		: v.unit === realExisting(cardsRoot(scope.cwd)) ? "整个卡库（含其他卡）"
		: display(scope.cwd, v.unit);
	const verb = TOOL_VERB[v.tool];
	const target = display(scope.cwd, v.target);
	return {
		question: `请求${verb}：${target}\n范围：${unitText}`,
		options: [
			{ label: "允许一次", action: "once" },
			{ label: "本会话允许", action: "session" },
			...(always ? [{ label: "永久允许（本卡）", action: "always" as const }] : []),
			{ label: "拒绝", action: "deny" },
		],
		denied: `用户拒绝了本次${verb}：${target}。`,
		grant: { dir: v.unit },
	};
}

export interface SandboxGateDeps {
	cwd: string;
	config: { card: string; lorebook?: string; lorebooks?: string[] };
	sessionGrants: () => SandboxGrants;
	rememberSession: (grant: SandboxGrant) => void;
	/** 宿主的选择卡；缺省＝无法询问 ⇒ 卡外一律拒绝 */
	ask?: (question: string, options: string[]) => Promise<string | undefined>;
	/** 用户在选择卡上按了停止 */
	onStop: () => void;
	log?: (line: string) => void;
}

/**
 * 一拍一个门：允许集按当前卡算一次，授权每次现读（本会话的在树上、永久的在 卡.json）。
 * 返回拦截理由（作为工具回执回给模型）；undefined ＝ 放行。
 */
export function createSandboxGate(deps: SandboxGateDeps): (tool: string, input: Record<string, unknown>) => Promise<string | undefined> {
	let scope: SandboxScope | undefined;
	return async (tool, input) => {
		if (!(tool in NATIVE_TOOL_ACCESS)) return undefined;
		scope ??= sandboxScope(deps.cwd, deps.config);
		const session = deps.sessionGrants();
		const perm = permanentGrants(deps.cwd, scope.cardDir);
		const v = sandboxVerdict(tool, input, scope, { dirs: [...session.dirs, ...perm.dirs], bash: session.bash || perm.bash });
		if (v.kind === "allow") return undefined;
		if (v.kind === "deny") { deps.log?.(`${tool} ${display(scope.cwd, sandboxTarget(tool, input, scope.cwd) ?? "")} → deny`); return v.reason; }
		const card = describeAsk(v, scope);
		if (!deps.ask) return `${card.denied}卡目录之外的访问需要用户批准，当前环境无法询问。`;
		const answer = await deps.ask(card.question, card.options.map((o) => o.label));
		const action = card.options.find((o) => o.label === answer)?.action ?? (answer === undefined ? "stop" : "deny");
		deps.log?.(`${tool} ${v.kind === "ask-bash" ? v.command : display(scope.cwd, v.target)} → ${action}`);
		if (action === "stop") {
			deps.onStop();
			return "用户已停止。";
		}
		if (action === "deny") return card.denied;
		if (action === "session") deps.rememberSession(card.grant);
		if (action === "always" && scope.cardDir) addPermanentGrant(deps.cwd, scope.cardDir, card.grant);
		return undefined;
	};
}
