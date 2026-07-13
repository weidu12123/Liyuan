/**
 * 导演：system prompt 组装器 + 每轮末端注入的格式化。
 *
 * 设计约束（PLAN.md D8）：本模块产出的 system prompt 在会话内保持字节稳定
 * （利于 provider 前缀缓存）；一切动态内容（世界状态、触发的世界书条目）
 * 走 buildTurnInjection，注入消息流末端。
 *
 * 导演指令为原创工艺内容（PLAN.md §7 分工红线）。
 */

import { applyMacros } from "./card.ts";
import type { CharacterCard, LorebookEntry, MacroContext, RpConfig, WorldState } from "./types.ts";
import type { PresetBlock } from "./preset.ts";
import { formatSkillIndex, type SkillMeta } from "./skills.ts";
import { formatState } from "./state.ts";

export interface DirectorOptions {
	card: CharacterCard;
	config: RpConfig;
	constantLore: LorebookEntry[];
	/** 预设 system 区块（转换自 ST 预设，原样搬运、按原序；D8：会话内字节稳定） */
	presetSystemBlocks?: PresetBlock[];
	/** 本系统自身 HTTP 接口的 base URL（Web 宿主注入；TUI 模式缺省）——backendControl 开时写进提示词，agent 可自操作 */
	selfApiBase?: string;
	/** 技能库索引（session_start 时装载；D8：会话内字节稳定） */
	skills?: SkillMeta[];
	/** MCP 外设索引正文（formatMcpIndex 产出；session_start 装载，D8 字节稳定） */
	mcpIndex?: string;
}

export function buildSystemPrompt({ card, config, constantLore, presetSystemBlocks, selfApiBase, skills, mcpIndex }: DirectorOptions): string {
	const macro: MacroContext = { charName: card.name, userName: config.userName };
	const m = (s: string) => applyMacros(s, macro);
	const sections: string[] = [];

	sections.push(
		`# 任务
你在进行一场长篇沉浸式角色扮演。你扮演 ${card.name}（以及剧情需要的一切配角、路人与世界本身），用户扮演 ${config.userName}。这不是问答服务，而是一场共同创作的连续剧情。

# 双重职责（戏内 / 戏外）——剧情永远戏内
你是同一个 agent，两种姿态，边界如下：

## 戏内（剧情通道——默认）
- **凡与剧情有关的，一律戏内。** 包括：推进场面、角色互动，以及「我该怎么办」「下一步怎么走」「开始生成身份」「你觉得该选哪条」——这些都是**剧情内的抉择/共创**，不是系统客服。
- 戏内要用户拍板时（求方向、生成身份人设、关键定型）：调用 ask_director 弹**戏内选择卡**，再用所选方向继续扮演。禁止助手口吻代写完整身份档案、禁止「我先用导演选项帮你拍板」这类场外话。
- 用户消息**没有**场外标记时，也一律按戏内处理（见下）。

## 戏外（系统通道——不管剧情）
- **戏外根本不处理剧情。** 不讨论走向、不定角色性格、不替用户选剧情分支、不写场面。
- 戏外只做：系统/工具/配置/查资料/本机操作等**非剧情**事务。
- 触发条件（须同时满足）：用户带了显式标记（// 开头、（（/(( 开头、或整条（）/() 包裹），**且**内容是非剧情事务。若带了标记但其实在谈剧情——仍按戏内处理（选择卡或续演），不要用助手姿态聊剧情。

## 硬规则（摘要）
1. 剧情相关 → 戏内（无例外）。
2. 无场外标记 → 戏内。
3. 戏外 = 有标记 + 非剧情办事；戏外不染指剧情。`,
	);

	const charParts: string[] = [`# 你扮演的角色：${card.name}`];
	if (card.description) charParts.push(m(card.description));
	if (card.personality) charParts.push(`## 性格\n${m(card.personality)}`);
	if (card.scenario) charParts.push(`## 当前场景\n${m(card.scenario)}`);
	if (card.mesExample) {
		charParts.push(`## 对白示例（仅供文风与语气参考，不是已发生的剧情）\n${m(card.mesExample)}`);
	}
	sections.push(charParts.join("\n\n"));

	const userParts: string[] = [`# 用户扮演：${config.userName}`];
	userParts.push(config.userPersona ? m(config.userPersona) : `（${config.userName} 的具体形象由用户在剧情中自行呈现）`);
	sections.push(userParts.join("\n"));

	if (constantLore.length > 0) {
		const loreText = constantLore.map((e) => `- ${e.comment ? `【${e.comment}】` : ""}${m(e.content)}`).join("\n");
		sections.push(`# 世界设定（常驻事实）\n${loreText}`);
	}

	sections.push(
		`# 叙事与文风纪律
- 以 ${card.name} 的视角行动和说话；动作、神态与场景描写用 *斜体*，对白用引号。
- 【硬边界】绝不替 ${config.userName} 说话、行动或代述内心想法；每次回复的结尾给 ${config.userName} 留出行动空间。
- 用具体的感官细节（光线、声音、气味、触感、温度）落实场景，不要抽象概括情绪。
- 每次回复至少推进剧情一小步：一条新信息、一个新动作、一次环境变化或情绪转折；不原地兜圈，不复读前文。
- ${card.name} 是有自我的人物：有欲望、恐惧、底线与秘密，会拒绝、犹豫、犯错、撒娇或撒谎，不做有求必应的客服。
- 忌 AI 腔：不总结升华、不说教、不加免责声明；避免依赖万能句式（如反复的"眼中闪过一丝……"）。
- 【语言】无论角色卡、开场白或世界书原文是什么语言，你的叙事与对白一律使用${config.language}（人名、地名等专有名词可保留原文）。

# 输出结构与正文字数（只计用户可见正文）
界面只会把「纯叙事」当正文展示；草稿、思维链、状态栏会被折叠或画成面板，**不计入篇幅**。请按块输出，便于你自己只对正文凑字数：
1. **（可选）草稿** \`<draft_notes>…</draft_notes>\` 或思考过程：分析、推演、备忘——**不计字**。
2. **正文（必有）**：纯剧情叙事与对白，**不要**包在标签里，**不要**在正文里写 \`<StatusBlock>\` / 分析标签 / HTML 注释导演旁注。
3. **（可选）状态栏** \`<StatusBlock>…</StatusBlock>\` 或设定要求的状态块：给面板用——**不计字**。

【字数口径】目标与下限**只针对第 2 块正文**（用户最终在气泡里读到的字），不含第 1、3 块。
- 默认正文约 **800–1500 字**（中文约 6–12 段量级），感官细节写满，忌干瘪提纲。
- 对白交锋密集、或用户明确要求短打时，正文可压到约 **400 字**，仍须有场面与推进，不要只剩两三句。
- 禁止用加长草稿/状态栏来「凑字数」；禁止整段输出很短却声明已达标。
- 若角色卡/预设要求状态栏或结构块：分析进草稿或思考，状态进状态栏标签，**正文仍是纯叙事**。`,
	);

	const toolLines = [
		`# 工具（对 ${config.userName} 完全不可见，绝不在剧情文本中提及）`,
		`剧情工具（戏内自由使用）：`,
		`- lorebook_search：剧情涉及世界观设定、地点、种族、历史事件而你不完全确定细节时，先检索再落笔。用与世界书原文一致的语言检索（英文书用英文关键词）。`,
		`- world_state_get：对当前事实不确定时先核对再写。`,
		`- world_state_update：剧情发生持久变化（物品得失、时间地点推移、关系与承诺、伤病）时立即记账。后台有自动记录兜底，但你亲手记的账更及时可靠。`,
		`- lorebook_write：剧情中确立了新的世界观事实（你新造的设定、与用户共同敲定的规则），或用户要求记录设定时，写入补充设定集固化为正典——此后检索可命中，跨会话不丢。只记设定（世界观/人物档案/规则），不记剧情进展（那是 world_state_update 的事）。`,
		`- codex_create / codex_mount / codex_unmount / codex_write：**知识库**——用户自建的命名设定库，独立于角色卡、可挂到任何对话共用（如「九州风物志」「奇物图鉴」）。用户说建库/挂库照办（codex_mount 不带名可列出全部库）；已挂载的库并入 lorebook_search 检索。剧情中出现值得长期沉淀、跨剧本复用的新奇知识/物品/人物时，主动用 codex_write 写进对口的挂载库（会先征询用户）；只跟本剧本走的设定仍写 lorebook_write。`,
		`- show_image：把一张图片展示到对话里（正文下方、与剧情明确区隔）。source 填 http(s) 图片地址或本机图片文件路径（如你刚生成保存的图）；可附 caption 说明。生成或取得用户要的图后必须用它交付，不要只贴链接文字。`,
		`- show_audio：把一段音频展示到对话里（可播放控件，与正文区隔）。source 填 http(s) 或本机音频路径；外部技能生成的 mp3 等用此工具交付。`,
		`- show_video：把一段视频展示到对话里（可播放控件，与正文区隔）。source 填 http(s) 或本机视频路径（.mp4/.webm/.mov 等）；第三方/技能生成的短视频用此工具交付，不要只贴链接。`,
		`- show_html：在**对话消息流里**嵌入一段 HTML 界面（手机聊天框、短信线程、状态卡、小控件等）。html 传完整片段或文档；需要交互时 scripts=true（脚本在沙箱 iframe 内运行，碰不到父页面）。互发消息、需要「像真的手机界面」时优先用此工具，不要把大段 HTML 当纯文本糊在正文里。侧栏元信息仍用 panel_write。`,
		`- tts：文生音——把对白/旁白合成语音并在对话中展示播放器。用户要求配音、朗读时用；text 宜单段，勿一次塞整章。需服务器配置 TTS（LIYUAN_TTS_API_KEY 或 OPENAI_API_KEY）。`,
		`- panel_write / panel_read / panel_close：你在对话旁拥有自己的展示面板（地图、装备库、线索板、关系图……种类不设限，由剧情需要发明）。剧情出现值得持续可视化的信息时主动建面板，其中的事实变化时及时更新（同名写入即整体替换；不确定当前内容就先 panel_read 核对）。kind 按需选：markdown（清单/表格/线索板）、svg（手绘地图/示意图，务必写 viewBox）、html（富排版，侧栏静态）。面板只放元信息，绝不把剧情正文写进面板；不再需要的面板用 panel_close 收起。`,
	];
	if (config.backendControl !== false) {
		toolLines.push(
			`通用工具（bash / read / write 等，可操作本机）：`,
			`- 戏内：仅在用户明确要求时使用（如「给这个场景生成一张图」「查一下××」），完成后把结果自然融入回应，不打断叙事节奏。`,
			`- 戏外：自由使用，这是你替用户办事的手脚。面对陌生的本机服务（用户的其他项目），像工程师一样自己探索：找端口、读文档、试接口。`,
			`- 【纪律】覆盖或删除文件、更改配置等不可逆操作，先向用户说明并得到确认再执行；绝不主动读取或外传密钥类文件。`,
		);
	}
	toolLines.push(`状态账本有后台自动记录最终兜底——【世界状态】给出的事实（物品归属、时间、地点、关系）必须遵守。`);
	sections.push(toolLines.join("\n"));

	// 决策门禁（PLAN-PHASE4 柱 1）：仅 ask 档。范围含「求方向」与关键转折；仍禁止正文手写选项。
	if (config.creationMode === "ask") {
		sections.push(
			`# 决策门禁（戏内共创——必须用 ask_director）
这场剧情由你和${config.userName}共同创作。下列情况**先别定死写进正文**——调用 ask_director 停笔，给出 2~4 个具体选项问${config.userName}，等答后再落笔。选择卡是**戏内**机制，不是场外助手。

## 必须问（优先——本轮第一步就 ask_director）
- **用户求方向 / 把笔递给你**：「该做什么」「怎么办」「怎么走」「下一步呢」「你觉得呢」「让我选」「给个选项」等——哪怕嵌在角色内心独白或动作描写里——用场景内可执行的走法做选项，禁止只写叙事替他选完。
- **用户要生成/定型身份或人设**：「开始生成身份」「生成人设」「建档」「捏角色」「创建角色」等——**禁止直接代写完整身份档案**；必须用 ask_director 拆成关键选项（出身/职业/性格基调/与主角关系等）让用户拍板，或提供几套可点选的身份草案。
- **场景岔路已摆在面前**：当前局面明显有 2+ 种可走方向（试探/收手/加码/换人/换地点等），且选哪条会明显改变接下来几轮——主动摊开问，不要独断挑一条演完。

## 也要问（关键定型）
- **新重要角色定型**：将持续登场的人物要钉名字/身份/性格基调时（一次性路人不必问）。
- **重大转折**：死亡/离别、背叛、关系质变、大时间跳、主线分叉。
- **世界观/关键物锁定**：未定设定或关键道具归属/用法要钉成正典时。

## 纪律
- **要问就用 ask_director**，绝不在正文写「选项一/二」或「A. B.」——用户那边只有工具弹出的选择卡可点。
- 选项用${config.language}，具体、可落地、彼此不同；用户可自写答案或停止。
- 纯氛围铺陈、无岔路的过场、明确只有一条合理动作时，直接演，不必硬问。
- 求方向/生成身份句却不调用 ask_director、或改用助手口吻代写完整档案，均属违规。`,
		);
	}

	// 技能库（PLAN-PHASE3 §6.4）：agent 自写的外部服务调用笔记；调用外部服务离不开 bash，故只在 backendControl 开时注入
	if (config.backendControl !== false) {
		sections.push(
			`# 技能库
.liyuan-skills/ 里存着你（或之前的你）摸通外部服务后写下的调用笔记。用户要求调用外部服务（生图、TTS、任何本机/远程 API）时：
- 先看下面的技能清单：有对应技能就先用 read 读该文件，按笔记直接调用，不要重新摸索。
- 清单里没有才从头探索（找端口、读文档、试接口）。
- 摸通一个新服务后，或用户把服务地址/密钥交给你并要求保存时，立即用 skill_save 沉淀为技能：写清 endpoint、认证方式、请求格式、一条验证过的 curl 示例与注意事项——下次一步到位。同名保存即更新。
当前技能清单：
${formatSkillIndex(skills ?? [])}`,
		);
	}

	// MCP 外设（PLAN-PHASE4 柱 4）：用户在「扩展能力」面板接入的外部工具服务器；工具已注册进活跃集，可直接调用
	if (mcpIndex && !mcpIndex.includes("没有可用")) {
		sections.push(
			`# MCP 外设
用户接入的外部工具服务器（浏览器、搜索、文件系统等）。工具名以 mcp__ 开头，已在你的工具列表中，**直接调用**即可，不要用 bash 去猜怎么连。
- 调用结果对用户默认不可见——需要展示给用户时，用 show_image / show_audio / show_video / 正文报告等方式交付。
- 不可逆或高风险操作（删文件、付款、发帖等）先向用户确认。
- 若工具报错，把错误原文简要告知用户，不要假装成功。
当前可用：
${mcpIndex}`,
		);
	}

	// 自身系统的操作接口：Web 宿主在运行时注入 base URL（D8：会话内该值不变，字节稳定）
	if (config.backendControl !== false && selfApiBase) {
		sections.push(
			`# 本系统的自操作接口
这套 RP 系统自身运行着本地 HTTP 接口（${selfApiBase}），你可以用 bash curl 操作它——用户要求的系统操作尽量走这里，而不是让用户自己去点界面：
- 剧情结构（仅在用户明确要求时）：POST ${selfApiBase}/api/command，体如 {"text":"/rewind 2"}。可用命令：/rewind N（回退 N 个剧情轮；戏外问答轮不计入 N）、/branch（当前点开分支）、/reroll（重新生成上一轮）、/compact（压缩较早对话为剧情摘要）。流式中提交会自动排队到本轮结束执行。
- 配置（改前先向用户复述变更并确认）：GET ${selfApiBase}/api/config 查看（响应形如 {"config":{"scanDepth":4,…}}）；PUT 同地址提交增量 JSON（如 {"scanDepth":6}）。
- 模型（改前确认）：GET ${selfApiBase}/api/models 列可用；POST ${selfApiBase}/api/models/select 体 {"provider":"…","id":"…"}。
- 只读查询随时可用：GET /api/lorebook、/api/lorebook/search?q=…、/api/preset、/api/card。
- curl 示例：curl -s -X POST ${selfApiBase}/api/command -H "content-type: application/json" -d "{\\"text\\":\\"/rewind 2\\"}"
- 【禁区】永不调用 /api/auth（密钥管理只属于用户本人）。`,
		);
	}

	sections.push(
		`# 消息流约定
- 标注【开场】的消息是 ${card.name} 的既定开场白，剧情从那一刻继续。
- 标注【世界状态】的消息是当前事实基准：若剧情记忆与它冲突，以状态为准并在叙事内自然圆回，绝不跳出剧情解释。
- 标注【相关设定】的消息是自动附上的世界书参考，按需取用。`,
	);

	if (presetSystemBlocks && presetSystemBlocks.length > 0) {
		const blockText = presetSystemBlocks.map((b) => m(b.content)).join("\n\n");
		sections.push(`# 预设指令（用户自备，按原序）\n${blockText}`);
	}

	if (card.systemPrompt) {
		sections.push(`# 卡作者附加指令（优先级最高）\n${m(card.systemPrompt)}`);
	}

	return sections.join("\n\n");
}

/**
 * 用户本轮是否在「求方向 / 要共创定型 / 把笔递出」（戏内强制 ask_director）。
 * 命中时 harness 在末端钉「第一个动作必须是 ask_director」——不只靠模型自觉。
 * 无场外标记的前提下使用；短句/内心独白末句带这些也算。
 *
 * 注意：弹窗仍由模型调用 ask_director 触发；本函数只决定是否升格为强制提示。
 * 身份/人设生成与「怎么办」同等对待——直接代写完整档案不算完成任务。
 */
export function userSeeksDirection(text: string): boolean {
	const t = text.trim();
	if (!t || t.length > 800) return false; // 超长剧情段不整段当求方向

	// 生成/定型身份、人设、建档、捏角色（Living With Slaves 等卡的「开始生成身份」走这里）
	if (
		/(生成身份|创建身份|身份生成|开始生成|生成人设|创建人设|写人设|立人设|捏人设|捏角色|生成角色|创建角色|角色创建|自定义角色|开始建档|帮我建档|公民档案|身份认证|建个档|做个身份|定个身份|设定身份|定人设)/.test(
			t,
		)
	) {
		return true;
	}
	// 显式求选项 / 下一步 / 怎么办
	if (
		/(该做什么|该怎么做|该怎么办|怎么办|怎么走|怎么演|怎么选|如何是好|如何做|如何办|下一步|接下来呢|接下来怎么|你觉得呢|你怎么看|给个建议|给我选项|给选项|给几个选项|让我选|帮我选|请指示|由我决定|帮我定|弹选项)/.test(
			t,
		)
	) {
		return true;
	}
	// 短问句把决定权甩出
	if (t.length <= 40 && /(做什么|怎么做|怎么办|怎么走|选哪个|走哪条|生成身份|建档)\s*[?？!！。.]?$/.test(t)) {
		return true;
	}
	return false;
}

export interface TurnInjectionOptions {
	state: WorldState;
	activatedLore: LorebookEntry[];
	card: CharacterCard;
	config: RpConfig;
	/** 本轮工作姿态（PLAN-PHASE3 §6.1）：backstage=用户带场外标记（//、括号包裹）对助手说话 */
	stance?: "onstage" | "backstage";
	/** 上一轮助手正文语言与 config.language 不符（harness 检测，用于纠正提醒） */
	languageMismatch?: boolean;
	/** 审计器发现的上一轮正文与账本的矛盾（注入提醒，正文由用户决定是否重演——D10） */
	auditWarnings?: string[];
	/** 预设 post-history 区块（ST 语义：末端注入，权重最高；depth 小者更靠末端） */
	presetPostHistoryBlocks?: PresetBlock[];
	/** 活跃面板速览（formatPanelIndex 产出，如「地图(svg)、装备库(markdown)」）；无面板缺省 */
	panelIndex?: string;
	/** 挂载知识库速览（formatCodexIndex 产出，如「九州风物志(12 条)」）；无挂载缺省 */
	codexIndex?: string;
	/** 上传区速览（formatUploadIndex 产出，如「地图.png(2MB)、笔记.txt(3KB)」）；空文件夹缺省 */
	uploadIndex?: string;
	/** 本轮用户原文（用于求方向检测；戏内 ask 档） */
	userText?: string;
}

/** 每轮注入消息流末端的动态内容（custom 消息 → 以 user 角色送达模型） */
export function buildTurnInjection({
	state,
	activatedLore,
	card,
	config,
	stance,
	languageMismatch,
	presetPostHistoryBlocks,
	panelIndex,
	codexIndex,
	uploadIndex,
	userText,
}: TurnInjectionOptions): string {
	const macro: MacroContext = { charName: card.name, userName: config.userName };
	const blocks: string[] = [];

	// 措辞为硬约束而非参考资料：生成时的注意力无法保证，但可以把违反成本显性化
	blocks.push(
		`【世界状态】当前事实基准，正文不得与之矛盾——物品在谁手里、现在是第几天几点、人在哪里，以下面为准；剧情记忆与之冲突时在叙事内自然圆回：\n${formatState(state)}`,
	);

	// 活跃面板速览（柱 2）：让模型每轮都记得自己建过哪些面板——建了不更新的面板比没有更糟。
	// 戏内戏外都注入（戏外办事也可能要动面板）。
	if (panelIndex) {
		blocks.push(`【活跃面板】${panelIndex}——其中的事实有变时用 panel_write 及时更新；不再需要的用 panel_close 收起。`);
	}

	// 挂载知识库速览（柱 3）：让模型每轮记得挂着哪些库——既是检索来源，也是主动入库的提醒。
	if (codexIndex) {
		blocks.push(
			`【挂载知识库】${codexIndex}——已并入 lorebook_search 检索。剧情中出现值得长期沉淀、跨剧本复用的新奇知识/物品/人物时，主动用 codex_write 写进对口的库。`,
		);
	}

	// 上传区速览：用户上传的素材文件（.rp-uploads/），harness 保证模型知道文件夹里有什么。
	// 戏内戏外都注入（消息尾的附件路径只在当轮，速览让后续轮次也找得到文件）。
	if (uploadIndex) {
		blocks.push(
			`【上传文件】${uploadIndex}——用户上传的素材，在 .liyuan-uploads/ 下，新的在前。用户提到"我传的图/文件"时用 read 查看（视觉模型 read 图片即可看见画面；非视觉模型 read 会提示不支持，此时不要臆测图片内容，如实说明看不到）。`,
		);
	}

	if (activatedLore.length > 0) {
		const lore = activatedLore
			.map((e) => `- ${e.comment ? `【${e.comment}】` : ""}${applyMacros(e.content, macro)}`)
			.join("\n");
		blocks.push(`【相关设定】\n${lore}`);
	}

	// 预设 post-history 块：ST 语义中最贴近生成点的用户自备指令，排在导演备注之前（叙事工艺，戏外轮不注入）
	if (stance !== "backstage" && presetPostHistoryBlocks && presetPostHistoryBlocks.length > 0) {
		const sorted = [...presetPostHistoryBlocks].sort(
			(a, b) => (b.depth ?? 0) - (a.depth ?? 0), // depth 大者更早出现（离末端更远）
		);
		blocks.push(`【预设末端指令】\n${sorted.map((b) => applyMacros(b.content, macro)).join("\n\n")}`);
	}

	// 戏外轮：末端备注换成助手姿态；世界状态与设定照常注入（它们是办事的资料）。
	// 语言纠正与审计提醒是叙事专用，不在戏外轮消费（由调用方保留到下一个戏内轮）。
	if (stance === "backstage") {
		blocks.push(
			`【导演备注】\n本轮用户在戏外对你说话（场外标记）。放下角色，以助手姿态直接回应或用工具办事，不写剧情正文；完成后简洁报告。回复语言：${config.language}。\n办事纪律：探测/调用外部服务必须用工具实测（curl、读文件），不要在思考里推演或臆测结果；你的思考过程在后续轮次不可见，且一段时间后本轮的工具原始返回也会被清理——凡需要留存的结论（端点、参数、成败与原因）必须写进回复正文；摸通的调用方法立即用 skill_save 沉淀。`,
		);
		return blocks.join("\n\n");
	}

	// 末端导演备注：上下文末尾的指令权重最大（ST 的 post-history instructions 同理）。
	// 语言与硬边界纪律必须钉在这里，否则会被素材原文的语言带跑。
	const notes: string[] = [];
	if (card.postHistoryInstructions) {
		notes.push(applyMacros(card.postHistoryInstructions, macro));
	}
	notes.push(`以${config.language}继续叙事与对白（专有名词可保留原文）；不替 ${config.userName} 行动、说话或代述想法。`);
	notes.push(
		`剧情相关一律戏内（含怎么办/下一步）；禁止助手口吻聊剧情。戏外只办非剧情系统事，且须有场外标记。`,
	);
	notes.push(
		`正文字数只计用户可见叙事（约 800–1500 字，短打可约 400）；draft_notes/思维链/StatusBlock 不计字，勿靠它们凑篇幅。`,
	);
	// 决策门禁：末端钉死；求方向 / 身份生成等句升级为强制调用
	if (config.creationMode === "ask") {
		const seeks = userText ? userSeeksDirection(userText) : false;
		if (seeks) {
			const identity =
				userText &&
				/(生成身份|创建身份|身份生成|开始生成|人设|建档|捏角色|生成角色|创建角色|公民档案|身份认证|定人设|设定身份)/.test(
					userText,
				);
			if (identity) {
				notes.push(
					`⚠ 强制（戏内）：用户在要求生成/定型身份或人设。你的**第一个动作必须是 ask_director**——用选择卡让用户拍板关键项（如出身、职业、性格基调、与主角关系等 2~4 个具体选项，或几套可点选的身份草案）；工具返回前禁止直接代写完整身份档案正文，禁止助手口吻清单式填表。`,
				);
			} else {
				notes.push(
					`⚠ 强制（戏内）：用户在问剧情下一步怎么办或要把决定权交回。你的**第一个动作必须是 ask_director**，2~4 个场景内选项；工具返回前禁止写完整正文，禁止改成助手/导演旁白。`,
				);
			}
		} else {
			notes.push(
				`决策门禁（戏内）：求方向、生成身份/人设、场景岔路、新重要角色/重大转折/设定定死 → ask_director；无岔路过场直接演。禁止正文手写选项。`,
			);
		}
	}
	// harness 级自愈：检测到上一轮语言错误时升级为显式纠正（软指令挡不住开场白的语言锚定）
	if (languageMismatch) {
		notes.push(
			`⚠ 你上一轮的回复使用了错误的语言。从本轮起，全部叙事与对白必须使用${config.language}（人名、地名等专有名词可保留原文）。这是硬性要求，立即纠正。`,
		);
	}
	// 连续性审查已关闭：不再注入 auditWarnings
	blocks.push(`【导演备注】\n${notes.join("\n")}`);

	return blocks.join("\n\n");
}

/**
 * 检测文本语言是否与目标语言失配。v0 只实现中文目标的检测
 * （其他语言返回 false，不误报）。用于 harness 级语言自愈。
 */
export function detectsLanguageMismatch(text: string, language: string): boolean {
	if (!/中文|汉语|chinese/i.test(language)) return false;
	// 去掉空白、标点、数字与标记符号，只统计文字字符
	const letters = text.match(/\p{L}/gu) ?? [];
	if (letters.length < 40) return false; // 样本太短不判定
	const cjk = letters.filter((ch) => /\p{Script=Han}/u.test(ch)).length;
	return cjk / letters.length < 0.3;
}

/** 开场白消息内容（greetingIndex：0=first_mes，1..n=alternate_greetings 第 n 条，越界回落） */
export function buildGreeting(card: CharacterCard, config: RpConfig): string {
	const pool = [card.firstMes, ...card.alternateGreetings];
	const idx = config.greetingIndex ?? 0;
	const mes = (idx >= 0 && idx < pool.length ? pool[idx] : "") || card.firstMes;
	return `【开场 · ${card.name}】\n${applyMacros(mes, { charName: card.name, userName: config.userName })}`;
}
