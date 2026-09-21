/**
 * 领域层共享类型。
 * 本目录（src/）不允许 import pi 的任何东西（PLAN.md D3）。
 */

/** 归一化后的角色卡（兼容 V1 / V2 chara_card_v2 / V3 chara_card_v3 / ST 导出格式） */
export interface CharacterCard {
	name: string;
	description: string;
	personality: string;
	scenario: string;
	firstMes: string;
	mesExample: string;
	/** 卡作者自带的 system prompt（规范语义：非空时优先于应用默认主提示） */
	systemPrompt: string;
	/** 卡作者的 post-history instructions（注入上下文末端） */
	postHistoryInstructions: string;
	creatorNotes: string;
	alternateGreetings: string[];
	tags: string[];
	/** 卡内嵌世界书（character_book），已归一化 */
	book: LorebookEntry[];
}

/** 归一化后的世界书条目（兼容 ST world info 格式与卡内嵌 character_book 格式） */
export interface LorebookEntry {
	uid: number;
	keys: string[];
	secondaryKeys: string[];
	comment: string;
	content: string;
	constant: boolean;
	enabled: boolean;
	/** 是否要求次要关键词也命中（AND_ANY 语义，v0 仅实现该逻辑） */
	selective: boolean;
	order: number;
}

/**
 * 登场名录：人物/物品/事件三张**追加式索引表**（供 agent 索引，不是给正文全量注入的内容）。
 * 登场过就永远在案——活跃状态里删掉（离场/消耗/了结）后名录仍保留，
 * 配合 memory_search 可召回细节。值为登记时的一句话（可空）。
 */
export interface StateRoster {
	characters: Record<string, string>;
	items: Record<string, string>;
	events: Record<string, string>;
	/** 到过的地点（首次到达时间为值）；旧存档无此字段按空处理 */
	places?: Record<string, string>;
}

/** 结构化世界状态（v0 schema，可扩展） */
export interface WorldState {
	/** 剧情内时间，自由文本（如「第二天清晨」） */
	time: string;
	/** 当前地点 */
	location: string;
	/** 出场角色状态，键为角色名 */
	characters: Record<string, CharacterState>;
	/** {{user}} 的物品栏 */
	inventory: string[];
	/** 自由键值对（誓言、秘密、天气等） */
	flags: Record<string, string>;
	/** 未了结的剧情线/伏笔 */
	plot_threads: string[];
	/** 登场名录（applyPatch 咽喉点自动登记；旧存档无此字段按空处理） */
	roster?: StateRoster;
	/**
	 * MVU 变量树（卡自带 stat_data 前端的数据源；仅 MVU 卡有此字段，见 src/mvu.ts）。
	 *
	 * 与上面七个字段是**同一份剧情事实的两种展示形状**，不是第二套真相：上面是梨园自己的账本
	 * 视图，这里是「这张卡的状态栏前端要的字段名/结构」。开局由卡 [initvar] 建初始树，之后场记
	 * 旁路每拍连它一起更新（判断在模型、落值由 applyMvuPatch 执行）。存进 WorldState 即白嫖
	 * rp-state 快照/分支/叶守卫全套持久化——树自动成 f(分支)，swipe/rewind 自动回到对应树形。
	 * 前端把它 postMessage 进 iframe 的 window.__liyuanVariables，卡脚本的 setInterval 自行点亮面板。
	 */
	mvu?: Record<string, unknown>;
	/**
	 * agent 自建面板的**数据**（键为面板名，值为该面板的一棵树）。
	 *
	 * 与 `mvu` 同构、同一套推进方式（场记每拍出平铺 path→值，applyMvuPatch 落值），
	 * 区别只是主人不同：`mvu` 是卡的树，这里是梨园自己面板的树。**不合用一个字段**——
	 * `seedMvuIfNeeded` 靠「state.mvu 有没有」判幂等，把梨园的数据塞进去会让卡的树永远种不上。
	 *
	 * 面板因此被拆成两层：**外观**（HTML/SVG/markdown，agent 写一次）留在 `.rp-artifacts`，
	 * **数据**在这里。好处有两个——数据白嫖 rp-state 的快照/分支/叶守卫（rewind 后面板数据
	 * 跟着回退，外观是模板不必回退），以及**注入侧从此喂数据不喂标签**：一张 HTML 面板的
	 * 外观动辄四千字，每拍原样喂给模型纯属白烧 token，模型要的只是里面那几十个字的事实。
	 */
	panelData?: Record<string, Record<string, unknown>>;
}

export interface CharacterState {
	/** 对 {{user}} 的好感/态度，-100..100 */
	affinity: number;
	/** 当前身体/处境状态 */
	status: string;
	/** 备注（承诺、得知的秘密等） */
	notes: string;
	/**
	 * 此刻所在地（与 `WorldState.location` 同一命名口径）。
	 *
	 * 「在场」＝ `at === location`，「离场」＝ 二者不同。此前 characters 是纯累积表、
	 * 无任何位置维度，「谁在这儿」在数据层根本无法表达——离场/回到旧地这类判定无从成立，
	 * 而预设只能每拍在思考里从头推导感知边界（狐神抚那份 3342 字模板里最长的一段
	 * 【部分零·角色感知边界｜防全知】就是干这个的，且推导结果不落盘、下拍重来）。
	 */
	at?: string;
}

/** 项目配置（app/liyuan.config.json；旧名 rp.config.json 启动时迁移） */
export interface RpConfig {
	/** 角色卡路径（.png 或 .json），相对项目根 */
	card: string;
	/**
	 * 已挂载的独立世界书路径列表（可 0..N 本同时启用；与角色卡无关，换卡不清除）。
	 * 装配顺序即数组合序；条目按内容指纹去重。
	 */
	lorebooks?: string[];
	/**
	 * @deprecated 旧版单本挂载；读时迁入 lorebooks，写盘时只保留 lorebooks。
	 */
	lorebook?: string;
	/** {{user}} 的名字 */
	userName: string;
	/** Web 顶栏的角色显示名覆盖（可选；不影响 {{char}} 宏与提示词，仅显示层。适用于卡 name 是剧本标题的场景卡） */
	displayName?: string;
	/** {{user}} 的人设描述（可选） */
	userPersona: string;
	/** 回复语言 */
	language: string;
	/** 关键词扫描回溯的消息条数 */
	scanDepth: number;
	/** 每轮关键词自动注入的条目上限 */
	maxLoreInjections: number;
	/** 是否在新会话注入开场白 */
	greeting: boolean;
	/** 开场白选择：0=卡的 first_mes（默认），1..n=alternate_greetings 第 n 条；越界回落 first_mes */
	greetingIndex?: number;
	/** 被用户停用的世界书条目（内容指纹列表，见 lorebook.ts loreFingerprint；跨 uid 冲突稳定） */
	disabledLore?: string[];
	/** /import 清洗时额外剥离的标签（叠加在默认思维链/状态栏列表之上，按预设约定配置） */
	importStripTags?: string[];
	/** 转换后的预设文件路径（liyuan-preset.json，可选；由 scripts/convert-preset.mjs 生成） */
	preset?: string;
	/** 本机工具总开关：开则 bash/读写等回到工具底座；本机开发默认开，分发默认关 */
	backendControl?: boolean;
	/** 决策门禁档位（PLAN-PHASE4 柱 1）：ask=关键剧情决策点停笔询问用户；silent=不问，等同旧行为。默认 silent */
	creationMode?: "ask" | "silent";
	/**
	 * 固定楼层压缩：每 N 个叙事轮主动压缩一次早期正文（被裁正文先完整归档进剧情库供召回）。
	 * 0 = 关闭主动压缩，仅保留上下文吃紧时的被动压缩。缺省 30。
	 */
	compactEveryNTurns?: number;
	/**
	 * agent 模式项目状态块里带的「稿子尾部」字数（docs/PLAN-AGENT-MODE.md §5.4）：当前分支最后这么多字的
	 * 原文随每轮送模，相当于「打开的文件」；其余章靠 story_read / story_grep。缺省见 stage/story.ts。
	 */
	agentStoryTailChars?: number;
	/**
	 * 旁路模型（场记记账 / 长局压缩）：指向连接配置里的一条**模型条目**——
	 * `entry` 是条目名（`AgentModelEntry.label`，没起名就是它的 id），不是模型 id：
	 * 同一个模型可以有多条条目、各带各的思考档，光有 id 分不出是哪条。
	 * 缺省 = 跟随剧情模型。思考档跟着条目走，这里不另存一份。
	 */
	sideModel?: { provider: string; entry: string };
	/** 一档卡皮肤:显示向美化正则被用户关闭的卡路径列表(默认开;spec 2026-07-22 §7 P1) */
	cardSkinOff?: string[];
	/**
	 * 采样参数（temperature/top_p 等）：预设转译时从 presetDoc.samplers 迁来
	 * （docs/PLAN-AGENT-SLOTS.md D1——采样是数据不是文案，不进任何提示词槽位）。
	 * 优先于遗留预设文件里的 samplers（转译后 config.preset 已清空）。
	 */
	samplers?: Record<string, number>;
	/**
	 * 工作模式沙箱的永久授权（跟卡走，见 docs/PLAN-SANDBOX.md）：卡目录之外允许原生文件工具
	 * 触碰的目录/文件（工程根内存相对路径，根外存绝对路径）。会话级授权不在这里，在会话树条目里。
	 */
	sandboxAllow?: string[];
	/** 工作模式沙箱：本卡永久允许 bash（bash 无法限制在卡目录内，批了就是批了整台机器的 shell） */
	sandboxBash?: boolean;
}

export const DEFAULT_CONFIG: RpConfig = {
	card: "assets/cards/default_Qingwu.json",
	// 默认不挂书：角色卡与世界书解耦，用户按需多选挂载
	lorebooks: [],
	userName: "旅人",
	userPersona: "",
	language: "中文",
	scanDepth: 4,
	maxLoreInjections: 3,
	greeting: true,
	backendControl: true,
	compactEveryNTurns: 30,
};

/** 宏替换上下文 */
export interface MacroContext {
	charName: string;
	userName: string;
}
