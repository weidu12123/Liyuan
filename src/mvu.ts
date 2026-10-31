/**
 * MVU 变量树兼容层（2026-08-25，用户定案「梨园彻底兼容 MVU 卡」）。
 *
 * ## 这是什么
 * 生态里大量卡把状态栏做成「MVU 前端」：一段 `<script>` 每隔 1.5s 调 `getAllVariables()`
 * 读一棵 `stat_data` 变量树、按值重画面板（装备/背包/地图/好感度…）。在酒馆里，那棵树由
 * MVU 插件维护：插件读卡的 `[initvar]` 建初始树、每拍解析模型输出的 `<UpdateVariable>` 改树。
 * 梨园没有这个插件 ⇒ 树永远空 ⇒ 面板外壳在、值全空（8/16—8/25 的「MVU 死器官」）。
 *
 * ## 梨园的解法（与酒馆不同，不复活协议）
 * 梨园**不**让主模型输出 `<UpdateVariable>`（那套协议在 protocol-detect 里对主模型剥除，保留）。
 * 而是把这棵树当成**账本事实的一种展示形状**：既然场记旁路本来就在「读剧情→判断持久变化→
 * 出 patch」（见 scribe.ts），MVU 卡只是同一件事换一套字段名——场记读完本拍，连这棵树该改哪些
 * 值也一并判断。**判断在模型**（它读得懂卡的 `[initvar]` 形状与更新规则），**落值由本模块死板执行**。
 *
 * 于是不需要「一卡一份映射表」，也不需要 schema：普查过的三张实卡（115 键/深 4、50 键/深 3、
 * 46 键/深 3）零共用结构，正因如此规则不能写死进代码——写死就是给每张卡加分支（铁律三禁的）。
 * 本模块只提供**通道**：读初值、把模型给的平铺 patch 套进树。填什么永远是模型的判断。
 *
 * ## 铁律对照
 * - 不堆提示词/注入：初值与更新规则走场记既有旁路通道（scribe.ts 内改写），不新增送模文案、不新增注入点。
 * - 不堆架构：本模块不枚举任何卡作者发明的字段名；`[initvar]` / `stat_data` 是 **MVU 插件自己发行的
 *   命名约定**（全生态统一），认它等于认一份公开协议，不是追卡作者措辞——与 protocol-detect 认
 *   `<UpdateVariable>` 同性质。
 *
 * 纯函数、零 `node:fs`、零 typebox（src/ 红线）——可离线单测。
 */

/** MVU 变量树：`stat_data` 下作者自定义的任意深结构（键名/深度每卡不同，本模块不认字段名） */
export type MvuTree = Record<string, unknown>;

/**
 * 从世界书条目里找出 `[initvar]` 初始数据条目并解析成树。
 *
 * 两种方言（普查实测）：
 *  - 包裹式：`content` 首行 `[initvar]`、末行 `[/initvar]`；条目名不含 initvar 字样。
 *  - 裸 YAML 式：`content` 直接是 YAML，标记 `[initvar]` 只写在条目名（comment）里。
 * 两种都认：正文里有 `[initvar]...[/initvar]` 就取包裹内容；否则若**条目名**含 `[initvar]` 就取整段正文。
 *
 * 返回 null＝这张卡没有可解的初始树（不是 MVU 卡，或初值只写在散文里——不硬解）。
 */
export function findInitVar(entries: Array<{ comment?: string; content?: string }>): MvuTree | null {
	for (const e of entries) {
		const content = e.content ?? "";
		const name = e.comment ?? "";
		const wrapped = /\[initvar\]([\s\S]*?)\[\/initvar\]/i.exec(content);
		let body: string | null = null;
		if (wrapped) body = wrapped[1] ?? "";
		else if (/\[\s*initvar\s*\]/i.test(name) && content.trim()) body = content;
		if (body == null) continue;
		const tree = parseInitVarYaml(body);
		if (tree && Object.keys(tree).length > 0) return tree;
	}
	return null;
}

/**
 * 找出卡的「变量更新规则」正文（可选，喂给场记当参考）。
 *
 * 判据是 MVU 插件自己的规则声明约定：条目正文里带 `check:` 列表（MVU 用它声明「某字段何时该
 * 更新」）。这与 protocol-detect 认 `<UpdateVariable>`/`[mvu_update]` 同性质——认的是**插件发行
 * 的格式**、不是卡作者的措辞（那个模块的头注已论证这类识别正当）。**不硬依赖**：找不到返回
 * undefined，场记仅凭树的字段名 + 剧情也能判断（字段名本身自解释）。返回首个命中，多条时取最长
 * （最全的那份）。上限截断防旁路 prompt 爆量。
 */
export function findMvuRules(
	entries: Array<{ comment?: string; content?: string }>,
	maxChars = 2000,
): string | undefined {
	let best: string | undefined;
	for (const e of entries) {
		if (!isMvuRulesEntry(e)) continue;
		const content = (e.content ?? "").trim();
		if (!best || content.length > best.length) best = content;
	}
	if (best && best.length > maxChars) return `${best.slice(0, maxChars)}\n…（规则较长，已截断）`;
	return best;
}

/**
 * 这条世界书条目是不是「MVU 变量更新规则」声明。
 *
 * 判据是 MVU 插件自己的规则声明约定：正文里带 `check:` 列表（MVU 用它声明「某字段何时该更新」），
 * 且不是 initvar 数据条目。**不问条目名**（不追作者措辞）。
 *
 * 两个用途共用这一份判据，故意不写两遍——「同一个问题四处平行判据」正是 8/25 那三刀的病根：
 *  1. findMvuRules：把规则喂给场记（它是这份料的**读者**）；
 *  2. 归属：既然读者是场记，主模型就不该再收到同一份（见 stripMvuRuleEntries）。
 */
export function isMvuRulesEntry(e: { comment?: string; content?: string }): boolean {
	const content = (e.content ?? "").trim();
	if (!content) return false;
	// initvar 数据条目排除（它没有 check:，但双保险）
	if (/\[initvar\]/i.test(content) || /\[\s*initvar\s*\]/i.test(e.comment ?? "")) return false;
	// MVU 规则声明约定：check: 列表
	return /(^|\n)\s*check\s*:/i.test(content);
}

/**
 * 归属：把「MVU 变量更新规则」条目对**主模型**关掉。
 *
 * 8/26 查出的矛盾：架构定案是「主模型永不见 MVU 协议」，`protocol-detect` 也正是为此存在，但它
 * 按**签名**判（`<UpdateVariable>`/`[mvu_update]`/`{{format_message_variable::}}`），而规则条目里
 * 一个插件标签都没有——实测某本书那条 748 字全是 `获得时 add，消耗时 replace，归零时 remove` 这类
 * 操作词，于是逐字常驻注入进了主模型的「世界设定（常驻事实）」。后果两层：白烧 token；更糟的是
 * 它**读起来像指令**，模型当真就会往正文里吐补丁——正是 protocol-detect 头注要防的正文污染。
 * 同时这 748 字有正当读者：场记（findMvuRules 拿的就是它，长度逐字对上）。一份料两个读者，
 * 场记该读、主模型不该读。
 *
 * 判据不是新签名，是**归属**：这份料已被本模块认领，认领者不是主模型。这正是铁律三给的替代路子
 * （声明落成数据、harness 死板执行数据），且不随卡增长——换一张没见过的 MVU 卡，判据一字不改。
 *
 * **前提：本书里有梨园能接管的树**（findInitVar 非空）。没有树就没有认领，一律不动——否则
 * 会去掐一份没人接手的内容。普查 10 本实书：命中 3 本各 1 条，其中两本的那条 protocol-detect
 * 早已判死（作者按 `[mvu_update]` 命名），故本步实际只多摘一本——但判据是通用的，不是特判。
 *
 * 退场＝置 `enabled: false`（同 stripProtocolEntries）：constant 注入、关键词激活、lorebook_search
 * 三条通道都尊重 enabled，一处置死全线生效。不改入参数组。
 */
export function stripMvuRuleEntries<T extends { comment?: string; content?: string; enabled: boolean }>(
	entries: T[],
): { entries: T[]; dropped: Array<{ title: string; chars: number }> } {
	if (findInitVar(entries) === null) return { entries, dropped: [] };
	const kept: T[] = [];
	const dropped: Array<{ title: string; chars: number }> = [];
	for (const e of entries) {
		if (!e.enabled || !isMvuRulesEntry(e)) {
			kept.push(e);
			continue;
		}
		dropped.push({ title: e.comment || "(无名条目)", chars: (e.content ?? "").length });
		kept.push({ ...e, enabled: false });
	}
	return { entries: kept, dropped };
}

/**
 * 解析 `[initvar]` 的 YAML 子集 → 对象树。
 *
 * 覆盖三张实卡用到的全部形态（普查实测）：缩进映射、标量（字符串/数字/布尔）、
 * 行内空对象 `{}`、行内空数组 `[]`、`"引号包裹"`（含带 `{{user}}` 宏的值）。
 * **不覆盖**多行数组项（`- foo`）与锚点/多文档等 YAML 高级特性——三张实卡都不用（唯一出现的
 * 数组是个行内空数组，键名还带 `$`）；遇到不认得的行跳过，不抛（宁可漏一字段，不可毁整棵树）。
 *
 * 缩进敏感：靠前导空格数定父子。制表符按 1 空格计（实卡未见 tab，防御性）。
 */
/** 递归剥除 MVU JSON 的 `$meta` 元数据节点 */
function stripMvuMeta(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(stripMvuMeta);
	if (node && typeof node === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			if (k === "$meta") continue;
			out[k] = stripMvuMeta(v);
		}
		return out;
	}
	return node;
}

export function parseInitVarYaml(src: string): MvuTree {
	const rawTrim = src.trim();
	if (rawTrim.startsWith("{")) {
		try {
			const parsed = JSON.parse(rawTrim);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return stripMvuMeta(parsed) as MvuTree;
			}
		} catch {
			// 非合法 JSON 则继续尝试缩进 YAML
		}
	}
	const root: MvuTree = {};
	const stack: Array<{ indent: number; obj: MvuTree }> = [{ indent: -1, obj: root }];
	for (const rawLine of src.split(/\r?\n/)) {
		const line = rawLine.replace(/\t/g, " ");
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const m = /^([^:]+):\s*(.*)$/.exec(trimmed);
		if (!m) continue; // 不是 key: value 行（如多行数组项）——跳过，不毁树
		const indent = line.length - line.trimStart().length;
		const key = m[1]!.trim();
		const rawVal = m[2]!.trim();
		// 回退到正确的父层：弹出所有 indent >= 本行的祖先
		while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
		const parent = stack[stack.length - 1]!.obj;
		if (rawVal === "") {
			// 无行内值 ⇒ 开一个子映射，后续更深缩进的行挂进来
			const child: MvuTree = {};
			parent[key] = child;
			stack.push({ indent, obj: child });
		} else {
			parent[key] = parseScalar(rawVal);
		}
	}
	return root;
}

/** 标量求值：`{}`/`[]`/布尔/数字/去引号字符串 */
function parseScalar(raw: string): unknown {
	if (raw === "{}") return {};
	if (raw === "[]") return [];
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw === "null" || raw === "~") return null;
	// 引号包裹：去引号（值里可能含 {{user}} 宏，原样留着由上游 applyMacros 处理）
	if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
		return raw.slice(1, -1);
	}
	// 纯数字（含负号/小数）→ number；否则原样字符串
	if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
	return raw;
}

// ————————————————— 初值的第二种声明形式：Zod schema 的 prefault —————————————————

/**
 * MVU 的初值有**两种声明形式**，`[initvar]` 只是其一。
 *
 * 另一种是卡的运行时脚本里注册一份 Zod schema，初值写成字段的 `prefault(…)`：
 * ```
 * export const Schema = z.object({ 根: z.object({
 *   世界: z.object({ 当前时间: z.string().prefault('清晨') }).prefault({}),
 * }).prefault({}) });
 * $(() => { registerMvuSchema(Schema); });
 * ```
 * MVU 拿空对象过一遍 schema，prefault 就把整棵初始树填出来。
 *
 * 普查（14 卡）：3 张卡带 Zod schema，其中 2 张**同时**有 `[initvar]`（schema 只当校验层），
 * 1 张把初值**只**写在 prefault 里 —— 那张卡在梨园里整个悬浮球面板都是 `--`，
 * 因为 `findInitVar` 找不到东西。这就是本节补的缺口。
 *
 * ## 为什么解析声明、而不是把作者的 schema 真跑起来
 * 跑起来需要 Zod 与 MVU 插件 bundle，而那份 bundle 实测要求宿主页面提供 `Vue` 与 `z` 全局
 * （真浏览器把两条 CDN 模块拉下来后分别报 `ReferenceError: Vue is not defined` /
 * `z is not defined`）——那等于把梨园伪装成酒馆，还要为一种声明形式引进两个重量级运行时。
 * 而 prefault 声明本身就是**纯文本里的静态数据**，与 `[initvar]` 的 YAML 同性质，解析它才对等。
 *
 * 判据是 **`registerMvuSchema`——MVU 自己发行的 API 名**（同 `[initvar]` /
 * `<StatusPlaceHolderImpl/>`，全生态逐字相同），不是任何卡作者的措辞：换卡不增行。
 * 容错纪律同 parseInitVarYaml：认不出的表达式跳过该键，**宁可漏一个字段，不可毁整棵树**。
 */

/** 从 pos 起跳过空白与 JS 注释 */
function skipTrivia(src: string, pos: number): number {
	let i = pos;
	for (;;) {
		while (i < src.length && /\s/.test(src[i]!)) i++;
		if (src.startsWith("//", i)) {
			const nl = src.indexOf("\n", i);
			i = nl < 0 ? src.length : nl + 1;
			continue;
		}
		if (src.startsWith("/*", i)) {
			const end = src.indexOf("*/", i + 2);
			i = end < 0 ? src.length : end + 2;
			continue;
		}
		return i;
	}
}

/** 跳过从 pos 起的一整段字符串/模板串（pos 必须指着引号），返回收尾引号之后的位置 */
function skipString(src: string, pos: number): number {
	const quote = src[pos]!;
	let i = pos + 1;
	while (i < src.length) {
		if (src[i] === "\\") {
			i += 2;
			continue;
		}
		if (src[i] === quote) return i + 1;
		i++;
	}
	return i;
}

/**
 * 从 `open`（必须是 `(`/`[`/`{`）起找配平的闭括号下标；找不到返回 -1。
 * 字符串与注释里的括号不计数。
 */
function matchBracket(src: string, open: number): number {
	if (!"([{".includes(src[open] ?? "")) return -1;
	let depth = 0;
	let i = open;
	while (i < src.length) {
		const c = src[i]!;
		if (c === '"' || c === "'" || c === "`") {
			i = skipString(src, i);
			continue;
		}
		if (src.startsWith("//", i) || src.startsWith("/*", i)) {
			i = skipTrivia(src, i);
			continue;
		}
		if (c === "(" || c === "[" || c === "{") depth++;
		else if (c === ")" || c === "]" || c === "}") {
			depth--;
			if (depth === 0) return i;
		}
		i++;
	}
	return -1;
}

/** 从 pos 起读到**顶层**的分隔符（`stop` 里任一字符），返回该位置；括号/字符串内的不算 */
function scanToTopLevel(src: string, pos: number, stop: string): number {
	let i = pos;
	let depth = 0;
	while (i < src.length) {
		const c = src[i]!;
		if (c === '"' || c === "'" || c === "`") {
			i = skipString(src, i);
			continue;
		}
		if (src.startsWith("//", i) || src.startsWith("/*", i)) {
			i = skipTrivia(src, i);
			continue;
		}
		if (c === "(" || c === "[" || c === "{") depth++;
		else if (c === ")" || c === "]" || c === "}") depth--;
		else if (depth === 0 && stop.includes(c)) return i;
		i++;
	}
	return i;
}

/**
 * 解析 prefault 的实参（一个 JS 字面量）：字符串 / 数字 / 布尔 / null / 数组 / 对象。
 * 认不出返回 `undefined`（调用方据此跳过该键——含函数、表达式等）。
 */
function parseJsLiteral(raw: string): unknown {
	const s = raw.trim();
	if (!s) return undefined;
	if (s === "true") return true;
	if (s === "false") return false;
	if (s === "null") return null;
	if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
	if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return s.slice(1, -1);
	if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
		try {
			return JSON.parse(s);
		} catch {
			// 单引号数组（`['甲']`）：只换引号位置的单引号，不碰字符串内部
			try {
				return JSON.parse(s.replace(/'([^'\\]*)'/g, '"$1"'));
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

/**
 * 在表达式**顶层**链上找 `.prefault(X)` / `.default(X)` 的实参原文（取最后一个）。
 * 嵌在括号里的（如 `z.array(z.object({a: z.string().prefault('x')}))` 内层那个）不算。
 */
function trailingDefaultArg(expr: string): string | undefined {
	let found: string | undefined;
	let i = 0;
	while (i < expr.length) {
		const c = expr[i]!;
		if (c === '"' || c === "'" || c === "`") {
			i = skipString(expr, i);
			continue;
		}
		if (c === "(" || c === "[" || c === "{") {
			const close = matchBracket(expr, i);
			// 顶层的 `.prefault(` / `.default(` 才收
			const before = expr.slice(0, i);
			const m = /\.(prefault|default)\s*$/.exec(before);
			if (m && close > i) found = expr.slice(i + 1, close);
			i = close < 0 ? expr.length : close + 1;
			continue;
		}
		i++;
	}
	return found;
}

/**
 * 把一个 schema 表达式求成「它的默认值」：
 * - `z.object({…})` → 由**子字段默认值**组成的对象（子字段自带 prefault，故对象自己那个
 *   `.prefault({})` 只是「缺失时先当空对象再往里填」，被子字段覆盖）
 * - 其它（`z.string()` / `z.enum()` / `z.array()` / `z.coerce.number().transform(…)`）→ 取顶层链的 prefault
 * - 裸标识符（命名子 schema，如同一份脚本里 `const CharacterKnowledge = z.object(…)`）→ 查符号表
 * 认不出 ⇒ `undefined`。
 */
function evalSchemaExpr(expr: string, symbols: Map<string, string>, depth = 0): unknown {
	if (depth > 24) return undefined; // 循环引用防线
	const s = expr.trim();
	if (/^[A-Za-z_$][\w$]*$/.test(s)) {
		const ref = symbols.get(s);
		return ref === undefined ? undefined : evalSchemaExpr(ref, symbols, depth + 1);
	}
	/**
	 * `z.object(` 必须在表达式**开头**才算对象 schema。
	 * 不能在整段里乱找：`z.array(z.object({…})).prefault([])` 里面也有一个 `z.object(`，
	 * 认了它就把「数组的元素形状」当成了字段的值——实测那张卡的 `帖子流` 本该是 `[]`，
	 * 却被填成一条空帖子对象，球拿它当数组遍历就是错的。
	 */
	if (/^z\s*\.\s*object\s*\(/.test(s)) {
		const callOpen = s.indexOf("(");
		const callClose = matchBracket(s, callOpen);
		if (callClose > 0) {
			const inner = s.slice(callOpen + 1, callClose).trim();
			if (inner.startsWith("{")) {
				const objClose = matchBracket(inner, 0);
				if (objClose > 0) {
					const fields = parseSchemaFields(inner.slice(1, objClose), symbols, depth + 1);
					if (Object.keys(fields).length > 0) return fields;
				}
			}
		}
	}
	const arg = trailingDefaultArg(s);
	return arg === undefined ? undefined : parseJsLiteral(arg);
}

/** 解析 `z.object({ … })` 花括号内的 `键: 表达式,` 列表 */
function parseSchemaFields(body: string, symbols: Map<string, string>, depth: number): MvuTree {
	const out: MvuTree = {};
	let i = 0;
	while (i < body.length) {
		i = skipTrivia(body, i);
		if (i >= body.length) break;
		// 键：'引号包裹'（中文键必然如此）或裸标识符
		let key: string;
		const c = body[i]!;
		if (c === "'" || c === '"') {
			const end = body.indexOf(c, i + 1);
			if (end < 0) break;
			key = body.slice(i + 1, end);
			i = end + 1;
		} else {
			const m = /^[^\s:,}]+/.exec(body.slice(i));
			if (!m) {
				i++;
				continue;
			}
			key = m[0];
			i += m[0].length;
		}
		i = skipTrivia(body, i);
		if (body[i] !== ":") {
			// 不是 `键:` 形状（展开运算符、方法调用等）→ 跳到下一个顶层逗号
			i = scanToTopLevel(body, i, ",") + 1;
			continue;
		}
		i++;
		const valStart = i;
		i = scanToTopLevel(body, i, ",");
		const value = evalSchemaExpr(body.slice(valStart, i), symbols, depth);
		if (value !== undefined) out[key] = value;
		i++; // 越过逗号
	}
	return out;
}

/** 收集 `const X = …;` / `export const X = …;`，供裸标识符引用时查表 */
function collectSymbols(src: string): Map<string, string> {
	const out = new Map<string, string>();
	const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(src)) !== null) {
		const start = m.index + m[0].length;
		const end = scanToTopLevel(src, start, ";");
		out.set(m[1]!, src.slice(start, end));
		re.lastIndex = end;
	}
	return out;
}

/**
 * 一段作者脚本 → Zod schema 声明出的初始树；不是 schema 脚本返回 null。
 *
 * 入口判据＝脚本里调了 `registerMvuSchema(X)`（MVU 发行的 API 名），树取自实参 `X`
 * 指向的声明。**不按导出名字找**（不认 `Schema` 这类作者措辞）。
 */
export function parseMvuSchemaDefaults(src: string): MvuTree | null {
	if (!src || !src.includes("registerMvuSchema")) return null;
	const call = /registerMvuSchema\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(src);
	if (!call) return null;
	const tree = evalSchemaExpr(call[1]!, collectSymbols(src));
	if (!tree || typeof tree !== "object" || Array.isArray(tree)) return null;
	return Object.keys(tree).length > 0 ? (tree as MvuTree) : null;
}

/** 一组作者脚本里第一份可解的 schema 初始树（顺序即声明序） */
export function findSchemaDefaults(scripts: Array<{ content?: string }>): MvuTree | null {
	for (const s of scripts) {
		const tree = parseMvuSchemaDefaults(s?.content ?? "");
		if (tree) return tree;
	}
	return null;
}

/** 一次 MVU 记账的结果 */
export interface MvuPatchResult {
	tree: MvuTree;
	/** 人类可读的变更摘要（过程条/日志用） */
	applied: string[];
	/** 无法落地的项（路径非法等）；不抛，进日志 */
	warnings: string[];
}

/**
 * 把场记给出的**平铺 patch**（`{ "路径.用点分隔": 新值 }`）套进树。
 *
 * 为什么是平铺 path→值、而不是 RFC6902 / lodash `_.set` 命令：那两种是**卡方言**（不同卡用不同
 * 套，普查见两种并存：JSON Patch 与 lodash `_.set`）。让场记模型手写卡方言正是 8/04 实测「首拍
 * 31% 思考、正文污染」的来源。梨园自定一套最简形状，模型只填「哪条路径→什么新值」，方言差异
 * 由本模块吸收——模型永不碰 op/from/JSONPatch 那些语法负担。
 *
 * 路径按 `.` 分段，逐层下钻；中途缺失的对象层自动补建（新出场角色/新地点即新键）。
 * 数组下标不支持（三张实卡无此需求；真遇到写整段替换即可）——段名即对象键。
 */
export function applyMvuPatch(tree: MvuTree, patch: Record<string, unknown>): MvuPatchResult {
	const next = structuredClone(tree);
	const applied: string[] = [];
	const warnings: string[] = [];
	for (const [path, value] of Object.entries(patch)) {
		const segs = path.split(".").map((s) => s.trim()).filter(Boolean);
		if (segs.length === 0) {
			warnings.push(`空路径已跳过`);
			continue;
		}
		let cursor: Record<string, unknown> = next;
		let ok = true;
		for (let i = 0; i < segs.length - 1; i++) {
			const seg = segs[i]!;
			const cur = cursor[seg];
			if (cur == null || typeof cur !== "object" || Array.isArray(cur)) {
				// 缺失/非对象层：补建空对象（新键场景）。原为标量则视为路径冲突，记警告后覆盖成对象
				if (cur != null && (typeof cur !== "object" || Array.isArray(cur))) {
					warnings.push(`${segs.slice(0, i + 1).join(".")} 原为标量，已被下钻覆盖`);
				}
				cursor[seg] = {};
			}
			cursor = cursor[seg] as Record<string, unknown>;
			if (cursor == null) {
				ok = false;
				break;
			}
		}
		if (!ok) {
			warnings.push(`${path} 下钻失败已跳过`);
			continue;
		}
		const leafKey = segs[segs.length - 1]!;
		const prevLeaf = cursor[leafKey];
		if (
			Array.isArray(prevLeaf) &&
			prevLeaf.length === 2 &&
			typeof prevLeaf[1] === "string" &&
			!Array.isArray(value) &&
			(value === null || typeof value !== "object")
		) {
			cursor[leafKey] = [value, prevLeaf[1]];
		} else {
			cursor[leafKey] = value;
		}
		applied.push(`${path} = ${summarizeValue(value)}`);
	}
	return { tree: next, applied, warnings };
}

/** 值摘要（过程条用，长值截断） */
function summarizeValue(v: unknown): string {
	if (v == null) return String(v);
	if (typeof v === "object") {
		const s = JSON.stringify(v);
		return s.length > 40 ? `${s.slice(0, 37)}…` : s;
	}
	const s = String(v);
	return s.length > 40 ? `${s.slice(0, 37)}…` : s;
}

/**
 * 把 MVU 树摘成给**场记模型**看的紧凑文本（当前值一览）。
 * 场记据此判断哪些值该随本拍剧情变。深对象递归成 `路径: 值` 平铺行，空对象/空数组标注为占位。
 * 上限保护：极大树（满树可能上千键）截断到 maxLines 行，尾部提示已省略——防旁路 prompt 爆量。
 */
export function formatMvuTree(tree: MvuTree, maxLines = 200): string {
	const lines: string[] = [];
	let truncated = false;
	const walk = (obj: unknown, prefix: string): void => {
		if (lines.length >= maxLines) {
			truncated = true;
			return;
		}
		if (obj == null || typeof obj !== "object") {
			lines.push(`${prefix}: ${obj == null ? "" : String(obj)}`);
			return;
		}
		if (Array.isArray(obj)) {
			lines.push(`${prefix}: ${obj.length === 0 ? "[]" : JSON.stringify(obj)}`);
			return;
		}
		const keys = Object.keys(obj as Record<string, unknown>);
		if (keys.length === 0) {
			lines.push(`${prefix}: {}`);
			return;
		}
		for (const k of keys) {
			if (lines.length >= maxLines) {
				truncated = true;
				break;
			}
			walk((obj as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k);
		}
	};
	for (const k of Object.keys(tree)) walk(tree[k], k);
	if (truncated) lines.push(`…（树较大，仅列前 ${maxLines} 项）`);
	return lines.join("\n");
}

/** 递归把树里所有字符串值的 {{user}}/{{char}} 宏换成实名（[initvar] 里 `姓名: "{{user}}"` 很常见） */
function substituteMacros(node: unknown, userName: string, charName: string): unknown {
	if (typeof node === "string") {
		return node.replace(/(?:\{\{\s*(user|char)\s*\}\}|<\s*(user|char)\s*>)/gi, (_m, a?: string, b?: string) =>
			(a ?? b ?? "").toLowerCase() === "user" ? userName : charName,
		);
	}
	if (Array.isArray(node)) return node.map((v) => substituteMacros(v, userName, charName));
	if (node && typeof node === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = substituteMacros(v, userName, charName);
		return out;
	}
	return node;
}

/** 检测旧版把 JSON 按单行冒号误拆出的损坏树（如 `"\"世界\"": "{"`） */
function isCorruptedJsonMvu(mvu: Record<string, unknown>): boolean {
	const keys = Object.keys(mvu);
	return keys.length > 0 && keys.every((k) => k.startsWith('"')) && keys.some((k) => mvu[k] === "{" || mvu[k] === "[");
}

/**
 * 懒建初始树：MVU 卡且 state 还没有 `.mvu` 时，从卡的初值声明建一棵初始树填进去。
 *
 * **初值有两种声明形式，按优先级试**：
 * 1. 世界书 `[initvar]`（老形式，findInitVar）——那是作者写下的**实际初始数据**
 * 2. 运行时脚本里注册的 Zod schema 的 `prefault`（findSchemaDefaults）——那是**字段默认值**
 * 顺序不能反：两张卡同时有两者，`[initvar]` 才是它们的真初值，schema 只当校验层。
 * 只有第三张（初值只写在 prefault 里）会落到第 2 条——它此前整个面板都是 `--`。
 *
 * **懒建而非会话创建时一次性建**：因为 (1) 老会话/导入的会话没有建树步骤也要能显示；(2) 读点
 * （前端 currentState / 场记开演前）调用即补，不依赖任何特定生命周期钩子。幂等：已有 `.mvu`
 * 直接返回原对象（不覆盖剧情已推进的树——那才是 f(分支) 的权威）。非 MVU 卡返回原 state。
 *
 * 这次建初始树**不是「给尸体化妆」**（8/16 的顾虑）：因为树后续真被场记每拍推动，不停在开局撒谎。
 *
 * 纯函数：不读盘、不改入参（有变化时返回浅拷贝）。宏替换就地做，避免依赖 card.ts（它 import node:fs）。
 */
export function seedMvuIfNeeded(
	state: { mvu?: Record<string, unknown> },
	bookEntries: Array<{ comment?: string; content?: string }>,
	userName: string,
	charName: string,
	authorScripts: Array<{ content?: string }> = [],
): typeof state {
	if (state.mvu && typeof state.mvu === "object" && !isCorruptedJsonMvu(state.mvu)) return state; // 已有树（含空树 {}）→ 不覆盖
	const tree = findInitVar(bookEntries) ?? findSchemaDefaults(authorScripts);
	if (!tree) return state; // 非 MVU 卡 / 无可解初值
	const seeded = substituteMacros(tree, userName, charName) as Record<string, unknown>;
	return { ...state, mvu: seeded };
}

// ————————————————— 面板挂载点（显示侧） —————————————————

/**
 * MVU 插件用来给状态栏「占位」的挂载点。**模型从不输出它，也看不见它。**
 *
 * 8/26 读 MVU 源码（`artifact/bundle.js`）定案的机制，五步：
 *  1. 卡的蓝灯世界书要求模型每拍结尾出 `<UpdateVariable>` + JSON Patch（**只有变量，没有状态栏**）；
 *  2. 模型照做，正文里一个字状态栏都不写；
 *  3. **插件**解析补丁改完树后，自己往消息末尾追加这个挂载点并回写消息：
 *     `'user'!==t.role&&(n.includes('<StatusPlaceHolderImpl/>')||(n+='\n\n<StatusPlaceHolderImpl/>'))`
 *     紧接 `setChatMessages(…,{refresh:'affected'})`；工具调用那条路同样由代码拼；
 *  4. 卡的显示正则把挂载点换成整份面板 HTML；
 *  5. 面板脚本 `setInterval` 读 `getAllVariables().stat_data` 画。
 * 送模侧插件自带 `ir({messages})` 会把它删掉，卡另有 `promptOnly` 规则做同一件事
 * （实卡里那条规则的名字就直接叫「对AI隐藏状态栏」）⇒ 模型无从模仿、也不该模仿。
 *
 * 梨园接管了第 1—3 步（树归 state、判断归场记），第 3 步的**追加动作没有主人**，于是
 * 显示正则永不触发、面板压根不上屏——这就是「数据活着、面板黑着」的全部原因。本模块补上它。
 *
 * ## 为什么这个常量不是铁律三禁的名单
 * 它不是卡作者/预设作者的措辞，而是 **MVU 插件自己发行的协议常量**——全生态每张 MVU 卡逐字相同，
 * 换一张没见过的 MVU 卡不需要往这里加任何一行（铁律四第三问的答案）。性质同
 * `HTML_NON_PROSE_TAGS` 认 HTML 规范元素名、同 protocol-detect 认 `<UpdateVariable>`：
 * 梨园既然实现了这份协议，就必须知道它的常量。名单病是「随作者增长」，这个常量不增长。
 */
export const MVU_STATUS_PLACEHOLDER = "<StatusPlaceHolderImpl/>";

/**
 * 正则整体是不是一个固定字面量；是则返回该字面量，否则 null。
 * 只认「一个元字符都没有」的正则（允许 `\/` 这类纯转义）——差一点就不是挂载点，宁缺毋滥。
 */
function fixedLiteralOf(source: string): string | null {
	let out = "";
	for (let i = 0; i < source.length; i++) {
		const c = source[i]!;
		if (c === "\\") {
			const n = source[i + 1];
			// \d \s \w \b \n … 是类/断言/序列，不是字面量
			if (!n || /[dDsSwWbBnrtvfkpPxu0-9]/.test(n)) return null;
			out += n;
			i += 1;
			continue;
		}
		if (".^$*+?()[]{}|".includes(c)) return null;
		out += c;
	}
	return out.length > 0 ? out : null;
}

/**
 * 这条显示规则是不是 MVU 的面板挂载点——判据：**整条正则恰好就是那个协议常量**。
 *
 * 故意收得这么紧。实测 13 张卡里另有四条「固定字面量 + 整份界面」的显示规则不是挂载点：
 * 45155 字的开局身份认证屏、207135 字的开局建卡屏、2649242 字的整页皮肤（触发字是作者署名），
 * 以及两张卡各自的成对开闭状态栏标签。它们的触发字由剧情/开场白产出，harness 替它们补挂
 * 就是把开局屏糊到每一拍上。只认协议常量，这四条自动全部落空。
 */
export function isMvuPanelMount(rule: { source: string }): boolean {
	return fixedLiteralOf(rule.source) === MVU_STATUS_PLACEHOLDER;
}

/**
 * 补挂面板：卡声明了挂载点、正文里又没有它 ⇒ 在末尾补一个，交给显示正则去换成面板。
 *
 * 三个不动的前提（缺一条就原样返回，＝改动前逐字同路）：
 *  - 卡真的声明了消费这个挂载点的显示规则（没声明＝这张卡没有 MVU 面板）；
 *  - 正文里还没有它（开场白里作者常手写一个在 `first_mes` 末行，那时不补）；
 *  - 调用方已确认「梨园接管了本卡的树、且这是最新一条」（见 DisplaySkin.mvu）。
 *
 * **只补最新一条**由调用方保证（skinAtDepth）。理由不是性能而是诚实：梨园只持有**当前**一棵树
 * （酒馆的 MVU 是每条消息各存一份快照），拿当前值去画历史消息的面板＝对历史撒谎。
 */
export function mountMvuPanel(text: string, rules: Array<{ source: string }>): string {
	if (!text || !rules.some(isMvuPanelMount)) return text;
	if (text.includes(MVU_STATUS_PLACEHOLDER)) return text;
	return `${text.replace(/\s+$/, "")}\n\n${MVU_STATUS_PLACEHOLDER}`;
}
