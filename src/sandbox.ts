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
import { type DenylistRule, matchDenylist, normalizeCommand, readDenylistRules } from "./bash-denylist.ts";
import type { ConversationEntry } from "./conversation-mode.ts";
import { mountedLorebookPaths } from "./lorebook.ts";
import { CARDS_ROOT, CHATS_DIR, CHAT_BTW_SESSIONS_DIR, CHAT_DOCS_MEMORY_DIR, CHAT_HISTORY_DIR, CHAT_SESSIONS_DIR, SHARED_LIBRARY_DIRS, cardsRoot, chatsRoot, insidePath } from "./paths.ts";

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
type NativeToolName = keyof typeof NATIVE_TOOL_ACCESS;

/** 会话树自定义条目：本会话授权（`{ dir }` 或 `{ bash: true }`），沿当前分支重放 */
export const SANDBOX_GRANT_TYPE = "liyuan-sandbox";

const TOOL_VERB: Record<NativeToolName, string> = {
	read: "读取", grep: "搜索", find: "查找", ls: "列出", edit: "修改", write: "写入", bash: "执行命令",
};

interface SandboxScope {
	cwd: string;
	/** 卡在 `cards/` 里时的卡目录；不在卡库里的卡为 undefined ⇒ 没有 `卡.json` 可落永久授权 */
	cardDir?: string;
	/** 当前会话所在的子项目绝对路径（如果存在） */
	chatDir?: string;
	/** 自由读写根（已取 realpath）：卡目录、创作目录 */
	roots: string[];
	/** 只读根（已取 realpath）：公共库、挂载的书文件 */
	readRoots: string[];
	/** 命令黑名单规则（`<agentDir>/BASH_DENYLIST.txt`，用户可见可改）；空表＝不拦 */
	denyRules: DenylistRule[];
}

export interface SandboxGrants {
	/** 已授权的目录或文件（绝对路径，已取 realpath） */
	dirs: string[];
	/** bash 免问前缀（归一化形态）：命令的每一段都要命中其一才不问；空表＝每条都问 */
	bashAllow: string[];
}

export type SandboxGrant = { dir: string } | { bashPrefix: string };

type SandboxVerdict =
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
function sandboxTarget(tool: string, input: Record<string, unknown>, cwd: string): string | undefined {
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

export function sandboxScope(
	cwd: string,
	config: { card: string; lorebook?: string; lorebooks?: string[] },
	chatDir?: string,
): SandboxScope {
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
	return {
		cwd,
		cardDir: space?.dir,
		chatDir: chatDir ? realExisting(chatDir) : undefined,
		roots: roots.map(realExisting),
		readRoots: readRoots.map(realExisting),
		denyRules: readDenylistRules(),
	};
}

/**
 * 目标路径是否落在同一张卡下的其他独立子项目中（或者试图探测整个对话库根）。
 * 一张卡下每个子项目是独立的叙事/正文工程，绝对禁止跨项目访问（读写/列出均禁止）。
 */
function isOtherChatPath(cardDir: string | undefined, currentChatDir: string | undefined, target: string): boolean {
	if (!cardDir || !currentChatDir) return false;
	const cardRoot = realExisting(cardDir);
	const currentRoot = realExisting(currentChatDir);
	const rel = relative(cardRoot, target);
	if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return false;
	const segs = rel.split(sep);
	if (segs[0] !== CHATS_DIR) return false;
	// 目标就在 "对话" 目录本身（例如 ls 对话，列出所有子项目）
	if (segs.length === 1) return true;
	const targetChatDir = join(cardRoot, segs[0], segs[1]);
	// 目标属于其他子项目
	return targetChatDir !== currentRoot && !insidePath(currentRoot, target);
}

/**
 * 目标路径是否落在已废除的卡根目录 `cards/<卡>/记忆` 下。
 * 记忆、大纲与设定文档现统一归属当前子项目的项目资产（`对话/<chatId>/记忆/`），
 * 拦截卡根 `记忆/` 的读写以防跨项目串味或写错位置。
 */
function isLegacyCardMemoryPath(cardDir: string | undefined, target: string): boolean {
	if (!cardDir) return false;
	const cardRoot = realExisting(cardDir);
	const rel = relative(cardRoot, target);
	if (!rel || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return false;
	const segs = rel.split(sep);
	return segs[0] === CHAT_DOCS_MEMORY_DIR;
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
	return (
		segs[0] === CHATS_DIR &&
		segs.length >= 3 &&
		(segs[2] === CHAT_HISTORY_DIR || segs[2] === CHAT_SESSIONS_DIR || segs[2] === CHAT_BTW_SESSIONS_DIR)
	);
}

/** 命令的免问前缀：默认取首词（`git status` 这种多词前缀由用户在 卡.json 里自己改窄） */
function commandPrefix(command: string): string {
	const first = command.split(/[;&|\n\r]+/).map((s) => normalizeCommand(s)).find(Boolean) ?? "";
	return first.split(" ")[0] ?? "";
}

/**
 * 免问判定：命令按段切、逐段归一化，**每一段**都要命中某个前缀。
 * 逐段（而不是整串前缀）是为了不让 `cd x && 任意命令` 被 `cd` 一把带走。
 */
function allowedByPrefix(command: string, prefixes: string[]): boolean {
	if (prefixes.length === 0) return false;
	const segments = command.split(/[;&|\n\r]+/).map((s) => normalizeCommand(s)).filter(Boolean);
	if (segments.length === 0) return false;
	return segments.every((segment) => prefixes.some((p) => segment === p || segment.startsWith(`${p} `)));
}

export function sandboxVerdict(tool: string, input: Record<string, unknown>, scope: SandboxScope, grants: SandboxGrants): SandboxVerdict {
	const access = NATIVE_TOOL_ACCESS[tool as NativeToolName];
	if (!access) return { kind: "allow" };
	if (access === "bash") {
		const command = String(input.command ?? "");
		const hit = matchDenylist(command, scope.denyRules);
		if (hit) return { kind: "deny", reason: `已拦截：命中命令黑名单「${hit.raw}」，梨园不允许执行。如确有需要，请向用户说明。` };
		return allowedByPrefix(command, grants.bashAllow) ? { kind: "allow" } : { kind: "ask-bash", command };
	}
	const target = realExisting(sandboxTarget(tool, input, scope.cwd)!);
	if (isOtherChatPath(scope.cardDir, scope.chatDir, target)) {
		return { kind: "deny", reason: `${display(scope.cwd, target)} 属于其他独立项目，当前项目无权访问。` };
	}
	if (isLegacyCardMemoryPath(scope.cardDir, target)) {
		const hint = scope.chatDir ? display(scope.cwd, join(scope.chatDir, CHAT_DOCS_MEMORY_DIR)) : "当前项目的 记忆/ 目录";
		return { kind: "deny", reason: `${display(scope.cwd, target)} 是已废除的旧版卡级记忆目录；当前项目的记忆与大纲资产请访问 ${hint}。` };
	}
	if (access === "write" && harnessManagedPath(scope.cardDir, target)) {
		return { kind: "deny", reason: `${display(scope.cwd, target)} 属于梨园管理的数据（快照仓 / 会话树），原生 ${tool} 不能写。` };
	}
	const within = (roots: string[]) => roots.some((r) => insidePath(r, target));
	if (within(scope.roots)) return { kind: "allow" };
	if (access === "read" && within(scope.readRoots)) return { kind: "allow" };
	if (within(grants.dirs)) return { kind: "allow" };
	return { kind: "ask", tool: tool as NativeToolName, target, unit: grantUnit(scope.cwd, target) };
}

const requestedLimitOf = new WeakMap<Record<string, unknown>, number>();

/**
 * 若 find / grep 的搜索根覆盖了卡级 `对话/` 目录，预先放宽底层 fd/rg 的截断上限，
 * 避免被同卡其他子项目的大量命中提前占满配额，再由结果过滤器按原定上限截断。
 */
function boostRecursiveLimitIfNeeded(tool: string, input: Record<string, unknown>, scope: SandboxScope): void {
	if ((tool !== "find" && tool !== "grep") || !scope.cardDir) return;
	const target = sandboxTarget(tool, input, scope.cwd);
	if (!target) return;
	const targetAbs = realExisting(target);
	if (!insidePath(targetAbs, realExisting(chatsRoot(scope.cardDir)))) return;
	const defaultLimit = tool === "find" ? 1000 : 100;
	const orig = typeof input.limit === "number" && input.limit > 0 ? input.limit : defaultLimit;
	requestedLimitOf.set(input, orig);
	if (orig < 5000) input.limit = 5000;
}

/**
 * 过滤 ls / find / grep 工具输出中落在其他独立子项目（`对话/<其他项目>`）、`对话/` 根入口
 * 或已废除的卡根 `记忆/` 下的结果行，防止从卡根目录递归搜索穿透项目隔离。
 */
export function filterSandboxResultText(
	tool: string,
	input: Record<string, unknown>,
	text: string,
	scope: SandboxScope,
): string {
	if (tool !== "ls" && tool !== "find" && tool !== "grep") return text;
	if (!scope.cardDir) return text;
	const searchBase = sandboxTarget(tool, input, scope.cwd);
	if (!searchBase) return text;
	const baseAbs = realExisting(searchBase);
	const isForbidden = (relPath: string): boolean => {
		const cleaned = relPath.trim().replace(/[\\/]+$/, "");
		if (!cleaned) return false;
		const candidate = realExisting(resolve(baseAbs, cleaned));
		if (isOtherChatPath(scope.cardDir, scope.chatDir, candidate) || isLegacyCardMemoryPath(scope.cardDir, candidate)) {
			return true;
		}
		if ((tool === "find" || tool === "grep") && harnessManagedPath(scope.cardDir, candidate)) {
			return true;
		}
		return false;
	};

	const cap = requestedLimitOf.get(input) ?? (typeof input.limit === "number" && input.limit > 0 ? input.limit : tool === "find" ? 1000 : 100);
	const lines = text.split("\n");
	const kept: string[] = [];
	let keptItems = 0;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
			continue;
		}
		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			continue;
		}
		if (tool === "ls" || tool === "find") {
			if (trimmed === "(empty directory)" || trimmed === "No files found matching pattern") continue;
			if (isForbidden(trimmed)) continue;
			if (keptItems >= cap) continue;
			kept.push(line);
			keptItems += 1;
		} else if (tool === "grep") {
			if (trimmed === "No matches found") continue;
			if (trimmed === "--") {
				if (kept.length > 0 && kept[kept.length - 1] !== "--") kept.push(line);
				continue;
			}
			const m = /^(.+?)(?::\d+:|-\d+-)\s/.exec(line);
			if (m && isForbidden(m[1]!)) continue;
			const isMatchLine = /^.+?:\d+:\s/.test(line);
			if (isMatchLine && keptItems >= cap) continue;
			kept.push(line);
			if (isMatchLine) keptItems += 1;
		}
	}

	while (kept.length > 0 && (kept[kept.length - 1] === "" || kept[kept.length - 1] === "--")) {
		kept.pop();
	}
	if (keptItems === 0) {
		if (tool === "ls") return "(empty directory)";
		if (tool === "find") return "No files found matching pattern";
		if (tool === "grep") return "No matches found";
	}
	return kept.join("\n");
}

export function filterSandboxToolContent<T extends { type: string; text?: string }>(
	tool: string,
	input: Record<string, unknown>,
	content: T[],
	scope: SandboxScope,
): T[] | undefined {
	if (tool !== "ls" && tool !== "find" && tool !== "grep") return undefined;
	let changed = false;
	const next = content.map((part) => {
		if (part?.type !== "text" || typeof part.text !== "string") return part;
		const filtered = filterSandboxResultText(tool, input, part.text, scope);
		if (filtered !== part.text) {
			changed = true;
			return { ...part, text: filtered };
		}
		return part;
	});
	return changed ? next : undefined;
}

// ---------- 授权数据 ----------

export function sandboxGrantsFromBranch(branch: ConversationEntry[]): SandboxGrants {
	const dirs: string[] = [];
	for (const e of branch) {
		if (e.type !== "custom" || e.customType !== SANDBOX_GRANT_TYPE) continue;
		const d = e.data as { dir?: unknown } | undefined;
		if (typeof d?.dir === "string") dirs.push(d.dir);
	}
	// 旧条目的 `{ bash: true }` 读时忽略（收缩，不迁移）：一个布尔＝整机永久放行，正是要撤掉的那档
	return { dirs, bashAllow: [] };
}

/** 落盘形态：工程根内存相对路径（正斜杠，跨机可读），根外存绝对路径 */
function storedPath(cwd: string, abs: string): string {
	const root = realExisting(cwd);
	return insidePath(root, abs) ? relative(root, abs).split(sep).join("/") || "." : abs;
}

export function permanentGrants(cwd: string, cardDir: string | undefined): SandboxGrants {
	if (!cardDir) return { dirs: [], bashAllow: [] };
	const c = loadCardConfig(cardDir);
	return {
		dirs: (c.sandboxAllow ?? []).map((p) => realExisting(resolve(cwd, p))),
		bashAllow: (c.sandboxBashAllow ?? []).map(normalizeCommand).filter(Boolean),
	};
}

export function addPermanentGrant(cwd: string, cardDir: string, grant: SandboxGrant): void {
	if ("bashPrefix" in grant) {
		const prefix = normalizeCommand(grant.bashPrefix);
		if (!prefix) return;
		const list = loadCardConfig(cardDir).sandboxBashAllow ?? [];
		if (!list.includes(prefix)) saveCardConfig(cardDir, { sandboxBashAllow: [...list, prefix] });
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
		const prefix = commandPrefix(v.command);
		return {
			question: `请求执行命令（bash 不受卡目录限制）：\n${v.command}`,
			options: [
				{ label: "允许一次", action: "once" },
				...(always && prefix ? [{ label: `以后不再问「${prefix}」（本卡）`, action: "always" as const }] : []),
				{ label: "拒绝", action: "deny" },
			],
			denied: "用户拒绝执行该命令。",
			grant: { bashPrefix: prefix },
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

interface SandboxGateDeps {
	cwd: string;
	config: { card: string; lorebook?: string; lorebooks?: string[] };
	chatDir?: string;
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
		scope ??= sandboxScope(deps.cwd, deps.config, deps.chatDir);
		const session = deps.sessionGrants();
		const perm = permanentGrants(deps.cwd, scope.cardDir);
		const v = sandboxVerdict(tool, input, scope, { dirs: [...session.dirs, ...perm.dirs], bashAllow: [...session.bashAllow, ...perm.bashAllow] });
		if (v.kind === "allow") {
			boostRecursiveLimitIfNeeded(tool, input, scope);
			return undefined;
		}
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
		boostRecursiveLimitIfNeeded(tool, input, scope);
		return undefined;
	};
}
