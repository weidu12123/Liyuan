/**
 * 作者运行时脚本（酒馆助手「脚本库」）——梨园从未消费过的第三条作者前端通道。
 *
 * 前两条已经在跑：`extensions.regex_scripts`（显示正则 → cardfront）、MVU 的
 * `[initvar]`/`<UpdateVariable>`（数据 → src/mvu.ts）。这一条是**运行时**：
 * 卡与预设可以在 `extensions.{TavernHelper,tavern_helper}.scripts[]` 里带 JS，
 * 酒馆助手把它们跑在一个子 iframe 里，脚本再往**父页** body 挂自己的 UI。
 * 那就是「悬浮球」的由来——它不是消息里的一段 HTML，而是页面级常驻 DOM。
 *
 * 为什么必须是独立通道而不是复用消息帧：消息帧的 iframe 在气泡里，`position:fixed`
 * 锚的是那个气泡盒子——球会随消息滚走、被盒子裁掉。作者写的坐标（`right:20px`
 * `bottom:20px` 之类）只有在**页面级**才有意义。
 *
 * 判据只认生态发行的协议形状（一个声明数组 + `enabled` 标志），**不认任何作者措辞**：
 * 不问脚本叫什么名字、不猜它是不是悬浮球、不列卡名。声明了就跑，没声明就没有——
 * 与 protocol-detect 认 `<UpdateVariable>`、mvu 认 `[initvar]`、frameDoc 认 HTML
 * 规范根元素同一路子（铁律三给的替代：声明落成数据，harness 死板执行）。
 *
 * 本地语料实测（14 卡 / 12 预设）：15 条唯一声明全部 `enabled`，其中 4 条是页面级 UI
 * （2 个悬浮球、1 个悬浮窗、1 组全屏面板），11 条是幕后逻辑（注册变量结构、状态约束、
 * 阶段路由、正则操作等）。字段形状统一为
 * `{id,name,type,content,enabled,button,data,info,export_with}`。
 *
 * ⚠ **消费面只剩卡（8/29 用户定案）**：预设自带的这类脚本不再交给宿主帧跑。
 * 解析器仍认两种来源（预设侧写 `tavern_helper`、卡侧写 `TavernHelper`，同一份数据两种历史拼写），
 * 但 `buildAuthorScripts` 只收卡——见那里的注释。
 */

/** 脚本快捷按钮声明（对齐酒馆助手 ScriptButton） */
export interface AuthorScriptButton {
	name: string;
	visible: boolean;
}

/** 一条作者脚本（保留 id/name/content/source 及可选 info/data/button 元数据） */
export interface AuthorScript {
	/** 作者给的稳定 id（用于宿主端去重与日志；缺失时由 source+序号兜底） */
	id: string;
	/** 作者给的名字（只进日志与调试面，不作任何判据） */
	name: string;
	/** JS 源码，原样交给宿主帧执行 */
	content: string;
	/** 来源：预设自带还是卡自带（顺序与冲突排查用） */
	source: "preset" | "card";
	/** 作者脚本说明文本 */
	info?: string;
	/** 脚本私有初始变量（供 getVariables({ type: 'script' }) 读取） */
	data?: Record<string, unknown>;
	/** 脚本按钮配置 */
	button?: {
		enabled: boolean;
		buttons: AuthorScriptButton[];
	};
}

/** ST 的 extensions 位置有两处：卡是 `data.extensions`，预设是顶层 `extensions`（与 regex_scripts 同例） */
function extensionsOf(raw: Record<string, unknown>): Record<string, unknown> {
	const data = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : raw;
	const ext = data.extensions && typeof data.extensions === "object" ? (data.extensions as Record<string, unknown>) : {};
	return ext;
}

/** 兼容二维键值对数组或普通对象的命名空间读取（酒馆助手 character.ts:36 支持 Object.fromEntries） */
function normalizeNamespaceObj(ns: unknown): Record<string, unknown> | null {
	if (!ns || typeof ns !== "object") return null;
	if (Array.isArray(ns)) {
		try {
			const entries = ns.filter((e): e is [string, unknown] => Array.isArray(e) && typeof e[0] === "string");
			return entries.length > 0 ? Object.fromEntries(entries) : null;
		} catch {
			return null;
		}
	}
	return ns as Record<string, unknown>;
}

/**
 * 取出声明数组。命名空间认 `TavernHelper`、`tavern_helper` 及旧版 `TavernHelper_scripts`：
 * 这是同一个插件的新旧存储结构（酒馆助手 character.ts:16-35），非作者措辞名单。
 */
function scriptsArrayOf(raw: Record<string, unknown>): unknown[] {
	const ext = extensionsOf(raw);
	for (const key of ["TavernHelper", "tavern_helper"]) {
		const ns = normalizeNamespaceObj(ext[key]);
		if (!ns) continue;
		if (Array.isArray(ns.scripts)) return ns.scripts;
		const scriptBlock = ns.script && typeof ns.script === "object" ? (ns.script as Record<string, unknown>) : null;
		if (scriptBlock) {
			if (Array.isArray(scriptBlock.scripts)) return scriptBlock.scripts;
			if (Array.isArray(scriptBlock.scriptsRepository)) return scriptBlock.scriptsRepository;
		}
	}
	if (Array.isArray(ext.TavernHelper_scripts)) {
		return ext.TavernHelper_scripts;
	}
	return [];
}

/** 提取角色卡或预设内预置的 character/preset 级变量（供 getVariables({ type: 'character' | 'preset' }) 作为初始值） */
export function extractAuthorScriptVariables(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
	if (!raw || typeof raw !== "object") return {};
	const ext = extensionsOf(raw);
	for (const key of ["TavernHelper", "tavern_helper"]) {
		const ns = normalizeNamespaceObj(ext[key]);
		if (!ns) continue;
		if (ns.variables && typeof ns.variables === "object" && !Array.isArray(ns.variables)) {
			return { ...(ns.variables as Record<string, unknown>) };
		}
	}
	if (
		ext.TavernHelper_characterScriptVariables &&
		typeof ext.TavernHelper_characterScriptVariables === "object" &&
		!Array.isArray(ext.TavernHelper_characterScriptVariables)
	) {
		return { ...(ext.TavernHelper_characterScriptVariables as Record<string, unknown>) };
	}
	return {};
}

/** 剥去整段包裹的 Markdown 代码围栏（对齐酒馆助手 panel/script/iframe.ts:10） */
function stripOuterCodeFence(code: string): string {
	const trimmed = code.trim();
	const m = /^```(?:js|javascript|ts|typescript)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
	return m ? m[1] : code;
}

/** 提取单条脚本的按钮配置（兼容新版 button.buttons 与旧版顶层 buttons） */
function extractScriptButton(s: Record<string, unknown>): AuthorScript["button"] | undefined {
	const rawBtn = s.button && typeof s.button === "object" && !Array.isArray(s.button)
		? (s.button as Record<string, unknown>)
		: null;
	const rawList = rawBtn && Array.isArray(rawBtn.buttons)
		? rawBtn.buttons
		: Array.isArray(s.buttons)
			? s.buttons
			: null;
	if (!rawBtn && !rawList) return undefined;
	const enabled = rawBtn && typeof rawBtn.enabled === "boolean" ? rawBtn.enabled : true;
	const buttons: AuthorScriptButton[] = [];
	if (rawList) {
		for (const b of rawList) {
			if (!b || typeof b !== "object") continue;
			const item = b as Record<string, unknown>;
			const name = typeof item.name === "string" ? item.name : String(item.name ?? "");
			if (!name) continue;
			buttons.push({
				name,
				visible: item.visible !== false,
			});
		}
	}
	return { enabled, buttons };
}

/** 展平 ScriptTree（支持单条 script、folder 文件夹及旧版 value 包装） */
function flattenRawScriptItems(list: unknown[]): Array<Record<string, unknown>> {
	const flat: Array<Record<string, unknown>> = [];
	for (const rawItem of list) {
		if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
		const item = rawItem as Record<string, unknown>;
		if (item.type === "folder") {
			if (item.enabled === false) continue;
			const children = Array.isArray(item.scripts)
				? item.scripts
				: Array.isArray(item.value)
					? item.value
					: [];
			for (const child of children) {
				if (!child || typeof child !== "object" || Array.isArray(child)) continue;
				const c = child as Record<string, unknown>;
				const unwrapped =
					c.type === "script" && c.value && typeof c.value === "object" && !Array.isArray(c.value)
						? (c.value as Record<string, unknown>)
						: c;
				flat.push(unwrapped);
			}
			continue;
		}
		const unwrapped =
			item.value && typeof item.value === "object" && !Array.isArray(item.value) && typeof item.content !== "string"
				? (item.value as Record<string, unknown>)
				: item;
		flat.push(unwrapped);
	}
	return flat;
}

/**
 * 一份原文 → 该来源的脚本清单。
 * `enabled === false` 一律跳过（作者停用就是对用户停用，与世界书条目同义）；
 * 空 content 跳过（占位条目）。解析永不抛：坏声明只是少一条脚本，不许拖垮整张卡。
 */
export function extractAuthorScripts(
	raw: Record<string, unknown> | null | undefined,
	source: AuthorScript["source"],
): AuthorScript[] {
	if (!raw || typeof raw !== "object") return [];
	const out: AuthorScript[] = [];
	const list = flattenRawScriptItems(scriptsArrayOf(raw));
	for (const [i, s] of list.entries()) {
		if (s.enabled === false) continue;
		const rawContent = typeof s.content === "string" ? s.content : "";
		const content = stripOuterCodeFence(rawContent);
		if (!content.trim()) continue;
		const id = typeof s.id === "string" && s.id.trim() ? s.id : `${source}-${i}`;
		const entry: AuthorScript = {
			id,
			name: typeof s.name === "string" ? s.name : "",
			content,
			source,
		};
		if (typeof s.info === "string" && s.info) {
			entry.info = s.info;
		}
		if (s.data && typeof s.data === "object" && !Array.isArray(s.data) && Object.keys(s.data).length > 0) {
			entry.data = { ...(s.data as Record<string, unknown>) };
		}
		const btn = extractScriptButton(s);
		if (btn && (btn.buttons.length > 0 || !btn.enabled)) {
			entry.button = btn;
		}
		out.push(entry);
	}
	return out;
}

/**
 * 卡自带的运行时脚本清单（去重后）。
 *
 * **只认卡，不认预设**（8/29 用户定案）。`extractAuthorScripts` 仍能解析预设那种写法——
 * 它是通用解析器，两种命名空间拼写都得认；被撤掉的是「把预设脚本喂给宿主帧」这条**消费**链。
 * 实测原因：预设侧的声明是为酒馆助手宿主写的，换到梨园的宿主帧里
 * 既无处依附（悬浮球占着屏幕却点不动）又会误报（每次切预设弹「正则未正确更新」）。
 * 预设的 `regex_scripts`（显示正则）不受影响，那条一直在正常工作。
 */
export function buildAuthorScripts(cardRaw: Record<string, unknown> | null | undefined): AuthorScript[] {
	const seen = new Set<string>();
	const out: AuthorScript[] = [];
	for (const s of extractAuthorScripts(cardRaw, "card")) {
		const key = `${s.source}:${s.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
	}
	return out;
}

/**
 * 清单指纹：够前端判断「这批脚本变没变」，又不带正文（正文可达数 MB）。
 * 与 ScriptHost 里那个 generation 同一形状同一算法——**必须共用一份**：
 * 两处各算一遍，迟早出现「服务端说变了、前端算出没变」的对不上。
 */
export function authorScriptSig(
	scripts: Array<{ id: string; source: string; content?: string; len?: number; hash?: string }>,
): string {
	return scripts.map((s) => JSON.stringify([
		s.source, s.id, s.hash ?? (s.content !== undefined ? authorScriptHash(s.content) : `len:${s.len ?? 0}`),
	])).join("|");
}

/** 浏览器与服务端共用的内容摘要（仅作刷新标识，不作安全校验）。 */
export function authorScriptHash(content: string): string {
	let a = 0x811c9dc5;
	let b = 0x9e3779b9;
	for (let i = 0; i < content.length; i++) {
		const c = content.charCodeAt(i);
		a = Math.imul(a ^ c, 0x01000193);
		b = Math.imul(b ^ c, 0x85ebca6b);
	}
	return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** hello 帧用的轻清单（无正文，只够算指纹） */
export function authorScriptManifest(
	scripts: AuthorScript[],
): Array<{ id: string; source: AuthorScript["source"]; len: number; hash: string }> {
	return scripts.map((s) => ({ id: s.id, source: s.source, len: s.content.length, hash: authorScriptHash(s.content) }));
}
