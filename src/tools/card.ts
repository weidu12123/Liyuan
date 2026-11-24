/**
 * 角色库族工具：card_read（读当前卡）、card_create（创建新卡，安全写）、card_list（卡库）、card_project（创作工程）。
 *
 * `card_create` 是**安全写**：创建新文件（同名拒写 + 写入后 loadCardFile 回读自检，
 * 解析失败 unlinkSync 回滚），不碰用户现有卡数据。
 */

import { getUiLocale, t } from "../i18n/index.ts";
import { errText, strArg, type ToolResult, type ToolSpec } from "./registry.ts";

/** 卡库一项（列举用；与 GET /api/cards 同源） */
interface CardLibItemLike {
	path: string;
	name: string;
	tags?: string[];
	fav?: boolean;
}

export interface CardDeps {
	/** 卡工程操作：agent 模式的资源服务。 */
	project?: (args: Record<string, unknown>) => Promise<unknown>;
	// ---- 读者 ----
	/** 读取当前装载的卡（字段级）；返回 null = 未装载卡 */
	readCard: () => { name: string; description?: string; personality?: string; scenario?: string;
		firstMes?: string; mesExample?: string; systemPrompt?: string; creatorNotes?: string;
		tags?: string[]; alternateGreetings?: string[] } | null;

	// ---- 创建者 ----
	/** 创建一张新角色卡（JSON CharaCard V3）；同名拒写。返回 (name, path) 或 null=同名已存在 */
	createCard?: (input: { name: string; description?: string; personality?: string; scenario?: string;
		firstMes: string; mesExample?: string; alternateGreetings?: string[] }) => { name: string; path: string } | null;

	// ---- 卡库 ----
	/** 卡库列表 + 当前卡路径 */
	listCards?: () => { cards: CardLibItemLike[]; current: string };
}

/**
 * 调用情境：诊断卡面内容——用户问「这张卡的描述是什么/有几个备选开场白」或
 * 需要根据卡面信息回答配置问题。类比 `lorebook_list`（给目录不给正文）。
 */
const cardRead: ToolSpec<CardDeps> = {
	name: "card_read",
	domain: "card",
	mode: "read",
	surfaces: ["stage", "authoring"],
	label: "读取角色卡",
	description: () =>
		getUiLocale() === "en"
			? "Read the fields of the currently loaded character card (description/personality/scenario/first_mes/mes_example/system_prompt/creator_notes/tags/alternate_greetings). Call when unsure about any field on the card."
			: "读取当前装载的角色卡字段（description/personality/scenario/first_mes/mes_example/system_prompt/creator_notes/tags/alternate_greetings）。" +
				"拿不准卡面某字段的内容时调用。",
	parameters: () => ({
		type: "object",
		properties: {},
		required: [],
	}),
	async run(_args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		let card: ReturnType<CardDeps["readCard"]>;
		try {
			card = deps.readCard();
		} catch (err) {
			return { text: en ? `Failed to read character card: ${errText(err)}` : `读取角色卡失败：${errText(err)}` };
		}
		if (!card) return { text: en ? "No character card is currently loaded." : "当前未装载角色卡。" };

		const text = en
			? [
					`Character Card "${card.name}":`,
					card.description ? `**Description**: ${card.description.slice(0, 2000)}` : "",
					card.personality ? `**Personality**: ${card.personality.slice(0, 1200)}` : "",
					card.scenario ? `**Scenario**: ${card.scenario.slice(0, 1200)}` : "",
					card.firstMes ? `**First Message**: ${card.firstMes.slice(0, 2000)}` : "",
					card.mesExample ? `**Dialogue Examples**: ${card.mesExample.slice(0, 2000)}` : "",
					card.systemPrompt ? `**System Prompt**: ${card.systemPrompt.slice(0, 800)}` : "",
					card.creatorNotes ? `**Creator Notes**: ${card.creatorNotes.slice(0, 1200)}` : "",
					card.tags?.length ? `**Tags**: ${card.tags.join(", ")}` : "",
					card.alternateGreetings?.length
						? `**Alternate Greetings (${card.alternateGreetings.length})**:\n${card.alternateGreetings.map((g, i) => `${i + 1}. ${g.slice(0, 200)}`).join("\n")}`
						: "",
				]
					.filter(Boolean)
					.join("\n\n")
			: [
					`角色卡「${card.name}」：`,
					card.description ? `**描述**：${card.description.slice(0, 2000)}` : "",
					card.personality ? `**性格**：${card.personality.slice(0, 1200)}` : "",
					card.scenario ? `**场景**：${card.scenario.slice(0, 1200)}` : "",
					card.firstMes ? `**开场白**：${card.firstMes.slice(0, 2000)}` : "",
					card.mesExample ? `**对话范例**：${card.mesExample.slice(0, 2000)}` : "",
					card.systemPrompt ? `**系统提示**：${card.systemPrompt.slice(0, 800)}` : "",
					card.creatorNotes ? `**作者注**：${card.creatorNotes.slice(0, 1200)}` : "",
					card.tags?.length ? `**标签**：${card.tags.join("、")}` : "",
					card.alternateGreetings?.length
						? `**备选开场白（${card.alternateGreetings.length} 条）**：\n${card.alternateGreetings.map((g, i) => `${i + 1}. ${g.slice(0, 200)}`).join("\n")}`
						: "",
				]
					.filter(Boolean)
					.join("\n\n");
		return { text, activity: t("读卡") };
	},
};

const cardCreate: ToolSpec<CardDeps> = {
	name: "card_create",
	domain: "card",
	mode: "write",
	surfaces: ["authoring"],
	label: "创建角色卡",
	description: () =>
		getUiLocale() === "en"
			? "Create a new character card (CharaCard V3 JSON). Refuses to overwrite an existing card with the same name. Fill all fields in the story's language. Does **not** automatically switch to the new card — the user opens it from the card library."
			: "创建一张新角色卡（CharaCard V3 JSON）。同名卡已存在时拒写。用于用户要求做新卡时。" +
				"参数全部用剧情原语言填写。" +
				"写完后**不会自动切换到新卡**——请用户自行在卡库中打开。",
	parameters: () => {
		const en = getUiLocale() === "en";
		return {
			type: "object",
			properties: {
				name: { type: "string", description: en ? "Card name (also the filename; any language)" : "卡名（也是文件名；不限语言）" },
				description: { type: "string", description: en ? "Appearance / background description" : "外貌/背景描述" },
				personality: { type: "string", description: en ? "Personality traits" : "性格特征" },
				scenario: { type: "string", description: en ? "Current scenario / setting" : "当前场景/处境" },
				first_mes: { type: "string", description: en ? "Opening greeting (required, first message of a new session)" : "开场白（必填，新会话的首条消息）" },
				mes_example: { type: "string", description: en ? "Dialogue examples demonstrating speech style" : "对话范例（展示说话风格）" },
				alternate_greetings: {
					type: "array",
					items: { type: "string" },
					description: en ? "Alternate greetings (first_mes does not need to be repeated here)" : "备选开场白（多条，第一条即 first_mes 可不重复填）",
				},
			},
			required: ["name", "first_mes"],
		};
	},
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.createCard) return { text: en ? "Creating character cards is not supported in this environment." : "本环境不支持创建角色卡。" };

		const name = strArg(args, "name");
		if (!name) return { text: en ? "Missing required parameter: name." : "缺少 name 参数（卡名 / 文件名）。" };

		const firstMes = strArg(args, "first_mes");
		if (!firstMes) return { text: en ? "Missing required parameter: first_mes (opening greeting)." : "缺少 first_mes 参数（开场白，新会话首条消息）。" };

		const alternates = Array.isArray(args.alternate_greetings)
			? args.alternate_greetings.filter((g): g is string => typeof g === "string" && g.trim().length > 0).map((g) => g.trim())
			: [];

		let r: { name: string; path: string } | null;
		try {
			r = deps.createCard({
				name,
				...(strArg(args, "description") ? { description: strArg(args, "description") } : {}),
				...(strArg(args, "personality") ? { personality: strArg(args, "personality") } : {}),
				...(strArg(args, "scenario") ? { scenario: strArg(args, "scenario") } : {}),
				firstMes,
				...(strArg(args, "mes_example") ? { mesExample: strArg(args, "mes_example") } : {}),
				...(alternates.length ? { alternateGreetings: alternates } : {}),
			});
		} catch (err) {
			return { text: en ? `Failed to create character card: ${errText(err)}` : `创建角色卡失败：${errText(err)}` };
		}
		if (!r) {
			return {
				text: en
					? `Character card "${name}" already exists (overwrite refused); please choose another name.`
					: `角色卡「${name}」已存在（同名卡拒写），请换一个名字。`,
			};
		}

		return {
			text: en
				? `Created character card "${r.name}" (${r.path}). Did not switch to it automatically — open it from the card library.`
				: `已创建角色卡「${r.name}」（${r.path}）。不会自动切换到此卡——请在卡库中手动打开。`,
			activity: t("创建角色卡「{name}」", { name: r.name }),
			details: { name: r.name, path: r.path },
		};
	},
};

const cardList: ToolSpec<CardDeps> = {
	name: "card_list",
	domain: "card",
	mode: "read",
	surfaces: ["authoring"],
	label: "列出卡库",
	description: () =>
		getUiLocale() === "en"
			? "List all character cards in the library (name/tags/path) and mark which one is currently loaded."
			: "列出卡库里的全部角色卡（卡名/标签/路径）并标出当前装载的是哪张。用于换卡前取路径、或答「我有哪些卡」。",
	parameters: () => ({
		type: "object",
		properties: {
			keyword: {
				type: "string",
				description: getUiLocale() === "en"
					? "Only list cards whose name or tags contain this string (omit for all)"
					: "只列卡名或标签含此字样的（缺省列全部）",
			},
		},
		required: [],
	}),
	async run(args, deps): Promise<ToolResult> {
		const en = getUiLocale() === "en";
		if (!deps.listCards) return { text: en ? "Listing the card library is not supported in this environment." : "本环境不支持列举卡库。" };

		let lib: { cards: CardLibItemLike[]; current: string };
		try {
			lib = deps.listCards();
		} catch (err) {
			return { text: en ? `Failed to list cards: ${errText(err)}` : `列举卡库失败：${errText(err)}` };
		}
		const kw = strArg(args, "keyword").toLowerCase();
		const list = kw
			? lib.cards.filter(
					(c) => c.name.toLowerCase().includes(kw) || (c.tags ?? []).some((t) => t.toLowerCase().includes(kw)),
				)
			: lib.cards;
		if (list.length === 0) {
			return {
				text: en
					? kw
						? `${lib.cards.length} card(s) in library; none matched "${kw}".`
						: "The card library is empty."
					: kw
						? `卡库共 ${lib.cards.length} 张，无匹配「${kw}」的卡。`
						: "卡库是空的。",
				activity: t("列卡库 · {n} 张", { n: 0 }),
			};
		}
		const lines = list.map((c) => {
			const marks = [
				c.path === lib.current ? (en ? "**current**" : "**当前**") : "",
				c.fav ? (en ? "favorite" : "收藏") : "",
			].filter(Boolean).join("·");
			const tags = c.tags?.length ? `｜${c.tags.slice(0, 6).join(en ? ", " : "、")}` : "";
			return `- ${c.name}${marks ? `｜${marks}` : ""}${tags}｜${c.path}`;
		});
		return {
			text: en
				? `Card library${kw ? ` matching "${kw}"` : ""} (${list.length}/${lib.cards.length}):\n${lines.join("\n")}`
				: `卡库${kw ? `含「${kw}」的` : ""} ${list.length}/${lib.cards.length} 张：\n${lines.join("\n")}`,
			activity: t("列卡库 · {n} 张", { n: list.length }),
		};
	},
};

export const cardProject: ToolSpec<CardDeps> = {
	name: "card_project",
	domain: "card",
	mode: "write",
	surfaces: ["authoring"],
	label: "卡创作工程",
	description: () =>
		getUiLocale() === "en"
			? "The sole editing channel for the current character card: authoring project. `guide` reads the authoring handbook (`file` reads references/: worldbook / greetings / mvu / ui-regex / scripts / preview / liyuan-runtime / export); `outline` lists sections (default overview, pass `section` for one or `full` for all, each item has key/path/facts); `inspect` lists resources; `prepare` unpacks to the draft dir; `read` reads resource text by ID (`raw` baseline / `draft` working copy); `write` saves text content; `add` creates an item (`kind`: lore / greeting / regex / script, `fields` metadata, lore/script may include content); `remove` / `restore` marks/unmarks deletion by key; `meta` updates metadata by key (entries: comment/keys/secondary_keys/constant/enabled/selective/insertion_order/position/depth/role/probability; regex: scriptName/placement/disabled/markdownOnly/promptOnly/minDepth/maxDepth; scripts: name/enabled; settings-meta: tags; book: name/description/scan_depth/token_budget/recursive_scanning); `assign` assigns a section; `check` validates and builds; `preview` renders in the user's browser and returns errors + DOM summary; `apply` applies by buildHash and reloads; `undo` reverts the last apply; `discard` drops all unapplied changes; `rebase` syncs after external edits and lists conflicts. All edits to card fields, greetings, embedded lorebook, regexes, and scripts must go through this tool — never modify card files directly with native file tools."
			: "当前卡的唯一修改通道：创作工程。guide 读写卡手册（卡的构成、各操作的用法；file 读 references/ 分册：worldbook / greetings / mvu / ui-regex / scripts / preview / liyuan-runtime / export，动到哪个板块读哪份）；outline 按板块列目录（默认概览，传 section 读一个板块，full 读全部；每项有 key、path、facts）；inspect 列资源清单；" +
				"prepare 展开到创作目录；read 按资源 ID 读原文（raw 读基线原包，draft 读含未应用改动的草稿）；write 保存正文稿；" +
				"add 新增一项（kind：lore / greeting / regex / script，fields 给元数据，lore 与 script 可带 content）；remove / restore 按目录项 key 标记删除或撤销；" +
				"meta 按 key 改元数据（条目：comment / keys / secondary_keys / constant / enabled / selective / insertion_order / position / depth / role / probability；" +
				"正则：scriptName / placement / disabled / markdownOnly / promptOnly / minDepth / maxDepth；脚本：name / enabled；settings-meta：tags；book：name / description / scan_depth / token_budget / recursive_scanning）；" +
				"assign 把目录项归入板块；check 校验并组装；preview 在用户页面里渲染当前稿并回报错误与 DOM 摘要；apply 按 buildHash 应用且重载；undo 撤回最后一次应用；" +
				"discard 放弃全部未应用改动；rebase 在原卡被其他入口改动后重新同步并列出冲突。所有卡字段、开场白、卡内世界书、正则与脚本均通过本工具修改，禁止用原生文件工具直接修改卡目录文件。",
	parameters: () => {
		const en = getUiLocale() === "en";
		return {
			type: "object",
			properties: {
				action: { type: "string", enum: ["guide", "outline", "inspect", "prepare", "read", "write", "add", "remove", "restore", "meta", "assign", "check", "preview", "apply", "undo", "discard", "rebase"] },
				file: { type: "string", description: en ? "Optional for guide: relative path inside handbook pack (e.g. references/mvu.md); omit for main guide" : "guide 可选：手册包内相对路径（如 references/mvu.md），省略读总册" },
				resource: { type: "string", description: en ? "Resource ID from inspect; read supports raw / draft" : "清单中的资源 ID；read 可用 raw / draft" },
				section: { type: "string", description: en ? "Section ID: settings / greetings / lore-knowledge / lore-constant / rules / mvu / ui / prompt-regex / scripts / ejs / deps / other" : "板块 ID：settings / greetings / lore-knowledge / lore-constant / rules / mvu / ui / prompt-regex / scripts / ejs / deps / other" },
				full: { type: "boolean", description: en ? "For outline: return every item across all sections" : "outline 时返回全部板块的全部项" },
				key: { type: "string", description: en ? "Required for remove / restore / meta / assign: outline item key" : "remove / restore / meta / assign 必填：目录项的 key" },
				kind: { type: "string", enum: ["lore", "greeting", "regex", "script"], description: en ? "Required for add" : "add 必填" },
				fields: { type: "object", description: en ? "Fields for add / meta" : "add / meta 的字段" },
				text: { type: "string", description: en ? "Full replacement content for write, saved verbatim" : "write 的完整新内容，原样保存" },
				version: { type: "string", description: en ? "Required for write: hash returned by the latest read" : "write 必填：最近读取资源返回的 hash" },
				buildHash: { type: "string", description: en ? "Required for apply: hash returned by the latest check" : "apply 必填：最近 check 返回的 hash" },
				offset: { type: "number", description: en ? "Optional start line for read (1-based)" : "read 可选起始行，1 起" },
				limit: { type: "number", description: en ? "Optional line count for read (continue via nextOffset)" : "read 可选行数，返回 nextOffset 时可续读" },
				message: { type: "string", description: en ? "Optional for preview: message text to render (defaults to first greeting)" : "preview 可选：要渲染的消息正文，默认第一条开场" },
				greeting: { type: "number", description: en ? "Optional for preview: greeting index to render (0 = default)" : "preview 可选：渲染第几条开场（0 = 默认开场）" },
				variables: { type: "object", description: en ? "Optional for preview: test variables (defaults to card initial values)" : "preview 可选：测试变量，默认卡内初值" },
				wait: { type: "number", description: en ? "Optional for preview: ms to observe after page ready (default 3000)" : "preview 可选：页面就绪后再观察多少毫秒，默认 3000" },
			},
			required: ["action"],
		};
	},
	async run(args, deps) {
		if (!deps.project) return { text: getUiLocale() === "en" ? "Card authoring project is not supported in this environment." : "本环境不支持卡创作工程", isError: true };
		try {
			const result = await deps.project(args);
			const act = typeof args.action === "string" && args.action.trim() ? t("卡创作工程 · {action}", { action: args.action.trim() }) : t("卡创作工程");
			return { text: JSON.stringify(result, null, 2), details: result, activity: act };
		} catch (error) {
			return { text: errText(error), isError: true };
		}
	},
};

/** 角色库族全部工具。 */
export const cardTools: ToolSpec<CardDeps>[] = [cardRead, cardCreate, cardList, cardProject];
