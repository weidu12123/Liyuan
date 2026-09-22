# PLAN-PROJECT-AND-PI：两步走 —— 卡项目化 + 回归 pi 并 rp 化

> 2026-09-05 立。**本档是执行计划，问题底账在 `docs/FINDINGS-PI-RETURN.md`。**
>
> **2026-09-08 用户重新定序**：当前执行入口改为 [RP agent 下一阶段](PLAN-RP-AGENT-NEXT.md)。
> 下一步先优化无预设扮演体验，再补齐角色卡制作与配套代码能力，第三步前端优化。
> **预设处理降为低优先级，继续搁置**；小说模式继续延期。前三刀与上一拍修订已归档为 `1a3142d`。
> 工具与底座验收完成，不代表 RP agent 的整体体验和创作能力已经成熟。
>
> **2026-09-08 进度**：卡项目化与跨会话记忆已先行完成；第一刀使主模型与工具循环改走 AgentSession，
> 第二刀已完成 **0.80.3 → 0.84.4**。见 [第一刀记录](PI-RETURN-KNIFE1.md)、[第二刀记录](PI-RETURN-KNIFE2.md)。
> 本档以下保留早期方案；当前采用固定 cwd、显式 sessionDir，coding-agent 会话仍为 v3 JSONL。
> 第三刀已补齐本拍稿件、计划、原文取证、卡级技能与记忆纠错，见 [工具与验证记录](PI-RETURN-KNIFE3.md)。
> 无预设下的 [DeepSeek 自主验收](PI-RETURN-AUTONOMY-DEEPSEEK.md) 已证明拍内闭环。
> 随后按用户限定的**上一拍**范围，补齐定位、版本事务、历史投影与 ask 回答的跨拍归属；
> 官方 DeepSeek 三次回改复验通过，见 [上一拍修订记录](PI-RETURN-PREVIOUS-DRAFT.md)。
> 任意章节的修改另归 [小说创作模式](PLAN-NOVEL-MODE.md)，延期设计。
> 用户补充的复杂卡制作维度另记于 [角色卡制作与修改](PLAN-CARD-AUTHORING.md)，尚未开工。
>
> **前置定案（用户 2026-09-05；其中推进顺序已由上面的 2026-09-08 定案更新）**
> 1. 「现在的梨园不能再修修补补了」——它对比酒馆成熟自洽，但**不是 agent**；在现有框架里思考
>    得不到想要的结果。
> 2. **推进顺序**：**完全抛开预设、以无预设方式运行梨园** → 卡项目化 → 回归 pi → 加工具 →
>    **最后**才处理预设。
> 3. **回归 pi 与加工具是同一步**（用户原话）：目标＝排开预设这个最大污染后的梨园能成为
>    **合格的 rp agent**。
> 4. 病根定性：「我们的基底就不够丰富——当时在一个完完全全的纯净 pi 上改，然后囫囵吞枣地
>    加预设、加酒馆的各种东西。」

---

## 〇、这一版的三条纪律

**纪律一：每一步的问题不是「预设现在需不需要这个」，而是「预设回来之后这个还活不活」。**
1.4 在无预设前提下搭的东西，1.5 为兼容预设全拆掉了——用户称之为「很痛心的改动」。要建的三样
（工作目录 / 循环 / 工具）天生过关，因为**它们都不住在 system prompt 里**，预设回来占不到它们的
地方。但这要当纪律守，不是顺其自然。**不许建任何「要求预设更短 / 被拆过 / 不存在」才成立的机制。**

**纪律二：验收口径是结构性指标，不是文笔。**
无预设的正文一定平淡，那是条件不是回归。这一版只认四件事：会不会自己查、会不会问、
工作空间守不守得住、能不能改自己写过的句子。**拿文笔判会得出错误结论。**

**纪律三：repo `CLAUDE.md` 四条铁律照旧全程生效。**
本计划两步的形状天然合律（见每步末尾的铁律核查），但每一次具体改动仍要过铁律四的三问。

---

## 一、第零步：无预设基线（开工前的一次测量，不改代码）

**做法**：`liyuan.config.json` 的 `preset` 字段留空 ⇒ `src/stage/materials.ts:292` 装
`presets/默认.json`（梨园自有 `blocks[]` 格式，**7 块 / 303 字**文风兜底）。要更干净就清空那 7 块。
加上梨园自己在 system 的 676 字，**无预设态送模文案约一千字**。

**量四件事**（每件都要有数，n≥3 拍）：

| 指标 | 怎么量 | 为什么要它 |
|---|---|---|
| 工具调用次数与工具名 | 会话 jsonl 的 `rpTimeline[]` | 回答「没有预设压着，模型会不会自己查」——这是我此前只能推断、从未测量的一条 |
| 思考量（字） | `_analyze-thinking.mjs` | 拿到梨园自己的思考基线（历史上所有思考量测量都被预设混淆） |
| 正文是否直出 | `text` 事件 vs 工具落笔 | 今天必然是直出；这是「正文不是工件」的基线 |
| 有没有主动 `ask` | 同上 | 岔口行为基线 |

**这一步的产物是一张表，不是一个结论。** 后面每一步都拿它当对照。

---

## 二、第一步：卡项目化（卡＝目录＝工作空间）

### 2.1 判据（用户 2026-09-05 原话大意）

> 一切都要回归于后端来看。我们平时用 Claude Code 是怎么样的？在项目的那个文件夹里面打开终端，
> 输入 `claude`，启动 CLI，**此时这个文件夹就变成了我们的工作空间**。梨园也应该如此——
> **每一张角色卡在梨园的后端里面就应该代表着一个文件夹，代表着一个工作空间。**

这是**架构判据**不是功能诉求：agent 的一切分层（身份、项目约定、技能、资料、可写工件、
会话历史）在 coding agent 里都锚在「cwd ＝工作空间」这一个事实上。**没有这个锚，分层无处可挂。**

### 2.2 现状（读码坐实）

- `server/main.ts:166` —— `const cwd = process.cwd()`，**全服务端一个 cwd**，下游一切吃它。
- `src/paths.ts` 的 `DIRS` ＝ 11 个兄弟目录（state / artifacts / assistant / cache / lore /
  media / audio / skills / uploads / worldline / memory），全部相对项目根。
- **卡是文件不是目录**（`src/card.ts` `loadCardFile(path)`）；`RpConfig.card` 是**全局单值**
  「当前哪张卡」（`src/types.ts:114`）。
- 卡与会话的关联靠**路径字符串比对** `sameCardPath(a, b, projectCwd)`（`src/paths.ts:33`）事后过滤。
- 预设全局单份 `liyuan-preset.json` 在项目根。

⇒ 全部卡共用同一个状态池 / 世界书池 / 技能池 / 预设 / 记忆库；「属于哪张卡」是**事后筛出来的**，
不是**结构上分开的**。

### 2.3 白送的只有「分家」，**「随卡拷走」不白送**（2026-09-05 更正）

**pi 的会话存储本来就按 cwd 编码**（`packages/coding-agent/src/core/session-manager.ts:439`
`getDefaultSessionDirPath(cwd, agentDir)`：`<agentDir>/sessions/--<cwd 转义>--/`）。本机实测目录名形如
`--C--Users-jsw_0-AppData-Local-Temp-lynew-Liyuan--`。

⇒ **卡一旦成为独立 cwd，会话按卡分家是白送的**，`sameCardPath` 那套事后过滤**整体消失**，不是"重写"。

⚠ **但本节原先写的「这是这一步最大的一块省力」说过头了，此处更正**：`agentDir` 缺省是
`~/.liyuan/agent`（`src/paths.ts:175`）⇒ **默认落点永远在 home，卡目录里没有会话**；换 cwd 只换目录名。
要做到「一张卡＝一个能整体拷走的文件夹」，必须**显式**把 sessionDir 指进卡目录：

- `create(cwd, sessionDir?)`（`:1411`）、`open(path, sessionDir?, cwdOverride?)`（`:1422`）、
  `continueRecent(cwd, sessionDir?)`（`:1438`）、`list(cwd, sessionDir?)`（`:1519`）、
  `forkFrom(sourcePath, targetCwd, sessionDir?)`（`:1460`）**全部接受显式 sessionDir**——
  **能力 pi 早就给了，梨园只在助手会话上用了**（`server/assistant.ts:945`、`:1230-1233` 是现成写法）。
- 给了自定义 sessionDir 时，`:1440`/`:1521` 的 `filterCwd` 会按 `header.cwd` 过滤（`sessionCwdMatches` `:534`）。
- **唯一的迁移障碍**：`SessionHeader`（`:32-39`）里 `cwd` 与 `parentSession` 是**绝对路径**，换机后
  匹配不上会被 `filterCwd` 滤掉。`open()` 已有 `cwdOverride`（`:1427`
  `cwdOverride ?? header?.cwd ?? process.cwd()`）⇒ 要么按新 cwd 重写 header，要么打开时一律传 cwdOverride。
  **这是一处明确、可测的工程点，不是未知。**

### 2.4 要决定的核心问题：`RpConfig` 哪些字段跟卡走、哪些留全局

`src/types.ts:112` 的 `RpConfig` 约 20 个字段，混着两种性质：

| 性质 | 字段 | 说明 |
|---|---|---|
| **跟卡走**（每卡一份） | `card`、`lorebooks`、`userName`、`userPersona`、`displayName`、`greeting`/`greetingIndex`、`disabledLore`、`cardSkinOff`、`preset` | 「这张卡里我是谁、挂哪些书、用哪份预设」 |
| **留全局**（跨卡一份） | `language`、`scanDepth`、`maxLoreInjections`、`backendControl`、`compactEveryNTurns`、`assistantModel`、`sideModel`、`creationMode`、`importStripTags` | 模型/系统级设置 |

**这一格一格的归属必须逐条过用户，我不自行拍板。** 归错的后果是「换卡丢设置」或「一张卡的偏好
污染全部卡」。

**pi 的对照（三格规则各不相同，实证 0.80.3 与 0.84.4 一致）**：

| 格子 | 作用域规则 |
|---|---|
| `SYSTEM.md`（替换基座） | **赢者独占**：项目盖全局，只有一份进提示词 |
| `APPEND_SYSTEM.md`（追加） | **赢者独占**：同上；且 `--append-system-prompt` 一给，文件根本不读 |
| `AGENTS.md`（项目上下文） | **唯一真叠加**：全局 → 文件系统根 → 一路走到 cwd，每层有就收一份 |

`AGENTS.override.md` 只切断自己那一层（0.84.0 新增，vendored 的 0.80.3 还没有）。
skills 是累加（全局 + 项目 + 从 cwd 到 git 根逐层 `.agents/skills/`）。

⇒ **梨园缺的正是「继承 + 切断」这套语义**：今天没有「这张卡不继承那条全局偏好」的表达方式。

### 2.5 改动面（本窗口只读普查，逐项有 文件:行号）

**本节数据来自本窗口的只读普查，逐项有 文件:行号。**

#### A. 目录访问：一半走 `dir()`，一半硬编码

`dir(cwd, key)` 共 **18 处**调用（media 6 / artifacts 3 / state 2 / cache 2 / uploads 2 /
assistant 1 / audio 1 / skills 1）。但 **lore / worldline / memory / audio 四个 key 有绕过 `dir()`
的硬编码路径**：`src/lorebook.ts:415`、`src/worldline.ts:90`、`src/memory/config.ts:20`、
`src/tts.ts:72`；`server/rest.ts` 另有十余处目录字面量（`:613` card-favs、`:1489-1494` uploads/media
前缀分发、`:1708`/`:1740` skills、`:3864-3921` backup/imports）。

⇒ **第一件事是把目录访问收成一个口子**（全部走 `dir()`），否则后面每一处硬编码都是一个漏点。
这一件本身就是纯机械替换、可独立验证、不改任何行为。

> **✅ 刀1「收口子」已落地（2026-09-05 深夜）。** 8 个文件、30 处字面量收完，代码里已无
> `.liyuan-*` 目录名字面量（只剩注释）。落点：
> `src/lorebook.ts` overlay 走 `dir(cwd,"lore")`、`src/worldline.ts` 走 `dir(cwd,"worldline")`、
> `src/tts.ts` 走 `dir(cwd,"audio")`、`src/update.ts` `UPDATE_DIR` 由 `DIRS.cache` 派生、
> `src/paths.ts` 新收 `MCP_CONFIG_FILE` 与 `SKILLS_PREFIX`（`src/mcp.ts` 同名再导出，调用方不动）、
> `src/backup.ts` 的 10 条平行清单改为**从 `DIRS` 派生 + 只声明排除 key**（`cache` 排除，理由写在注释里）、
> `server/rest.ts` 13 处改走 `DIRS`/`BACKUP_ROOT`/`SKILLS_PREFIX`/`normalizeDataPath`。
> **核实**：13 条路径逐字等价 + 备份清单集合相等（`_baseline0/verify-dao1.mjs`）；
> 测试 645 项 **643 通过 / 2 失败，与改动前逐项相同**（那 2 个是本地卡库形状引起的既有红，
> 把新卡移走照旧红）；实起 `node server/main.ts` 探活 12 个受影响端点，含真跑一次
> `POST /api/backup/create`（524 文件 / 112MB，zip 内无 `.liyuan-cache` ⇒ 排除生效，事后已删）
> 与 `DELETE /api/uploads` 四例（合法删除 / `..` 越权拦下 / 错前缀拦下 / 旧前缀仍认）。
> `src/memory/config.ts` 那处**本来就已经走 `DIRS.memory`**，本节原文所列该项已过期。

#### B. `cwd` 是模块级单例，不是参数

`server/main.ts:166` `const cwd = process.cwd()`，`:244` 用它 `SessionManager.create(cwd)`，
`:388`/`:474` 用它建 `.liyuan-state` / `.liyuan-artifacts` 并挂两个 `fs.watch`。
**换卡不换 cwd。** 而 `src/` 下有 **78 个 `export function` 首参是 `cwd`**（rest.ts 内 45 处
`cwd: string`）——**管道早就铺好了，源头是常量**。

⇒ 这是这一步的技术核心：**把 cwd 从模块常量变成「当前卡目录」**，下游 78 个函数一行不用改。

#### C. 卡的归属今天靠三套并行口径（必须收敛）

| 口径 | 位置 | 形态 |
|---|---|---|
| 会话内自描述条目 | `.liyuan/extensions/roleplay.ts:1161`（写）、`server/main.ts:2659`（读） | `customType === "rp-card"`，`data.card` 存卡相对路径；读侧整份扫、取最后一条（2026-09-23 issue #11 起，此前头尾各 64KB 会漏掉漂到中部的重绑定行） |
| 路径字符串比对 | `src/paths.ts:33` `sameCardPath` | **7 处生产调用**：会话列表 `main.ts:2728`、换卡选会话 `:1285`、删卡删会话 `:1460`、助手四处 `assistant.ts:1439/1479/1503/1544`（含两道越权门） |
| 内容哈希 / 卡名 | `src/memory/config.ts:29`（卡路径 sha1 前 10 位）、`src/lorebook.ts:415`（**按卡名**不是路径） | 两者口径互不一致 |

⇒ 卡＝目录之后，**这三套全部退役**（铁律三：名单只许删）。

#### D. 分家白送，但「随卡拷走」要显式 sessionDir（助手会话已经这么做了）

剧情会话在 `~/.liyuan/agent/sessions/--<cwd 编码>--/`（`session-manager.ts:850`），**跟卡没有
目录关系**，靠内存里 `sameCardPath` 筛。cwd 一换即天然分家——**但仍在 home 下，卡目录里没有会话；
要真进卡目录必须显式传 sessionDir，见 §2.3 的更正。**
**助手会话已经是那个做法**：`server/assistant.ts:945` 用 `dir(cwd, "assistant")` 当 sessionDir。
另有三类按 sessionId 落盘的：`.liyuan-state/<sid>.json`、`.liyuan-artifacts/<sid>.json`、
`.liyuan-worldline/<sid>.json` —— 这些跟着卡目录走即可。

#### E. `src/backup.ts` 是手抄的平行清单

`:48-65` `PROJECT_DIR_SCOPES` 是 10 个 `.liyuan-*` **字面量**，**不 import `DIRS`**；
`:68-75` 六个根级单文件；`:78-82` `.liyuan/` 白名单三个。
`:94` `projectSessionDir` **自己复刻了一遍 SessionManager 的 cwd 编码规则**。
恢复时 `:356` 对每个 scope **先 `clearDirContents` 再整目录铺**。

⇒ 必改四处：(a) 清单改成「枚举卡目录」；(b) 清空语义（卡目录清空会删掉备份里没有的新卡）；
(c) 那份复刻的编码规则；(d) 文件头 `:3-4` 明确否掉的「按卡拆包」——**卡＝目录后这条设计前提消失**。

#### F. 必动文件清单（按改动量，12 项）

| # | 文件 | 性质 |
|---|---|---|
| 1 | `server/rest.ts` | 协议为主：卡库枚举 `:555-611`、换卡主流程 `:1315`、预设四件套 `:866-1020`、世界书写入目标 `:1090`、备份/导入端点 `:3864-3921` |
| 2 | `server/main.ts` | 协议 + 迁移：模块级 cwd/两个 `fs.watch`、`sessionInfos` 过滤 `:2708`、`switchToCard` `:1278`、`deleteCardSessions` `:1453` |
| 3 | `src/paths.ts` | **手术核心**：`DIRS` `:50`、`dir()` `:83`、`sameCardPath` `:33` 作废、`migrateLegacyLayout` `:106` 加一档 |
| 4 | `.liyuan/extensions/roleplay.ts` | 6 处 `dir()` + `rp-card` 写侧 `:1161` |
| 5 | `server/assistant.ts` | assistant sessionDir `:945` + 4 处 `sameCardPath` |
| 6 | `src/backup.ts` | 数据迁移，见 E |
| 7 | `src/stage/materials.ts` | `loadStageConfig` `:92`、`loadStageMaterials` `:216`、单槽缓存 `:194`（键是 cwd）、`inputStamp` 硬拼预设路径 `:207` |
| 8 | `src/memory/config.ts` + store/service | 迁移：`<cardHash10>__<sid>` 目录名与目录结构二选一 |
| 9 | `src/lorebook.ts:414` | 迁移：overlay 按**卡名**分文件，口径与别处不一致 |
| 10 | `src/types.ts:112` | 协议：`RpConfig` 字段语义重定义（见 2.4） |
| 11 | `worldline.ts:90`、`tts.ts:72`、`uploads.ts:20/62`、`skills.ts:32`、`media-stage.ts:63`、`engine.ts:656` | **纯机械替换**，各一两行 |
| 12 | `server/wire.ts:122/814` + `web/src/attachments.ts:23` | 协议：WS 帧的 `card`/`cardName` 字段与前端常量 |

**还会波及**：`test/{card-path,backup,update,media-stage,skills,uploads}.test.ts` 都硬编码了扁平
目录名；`start.bat:45/66/112` 直接引用 `.liyuan-cache\`。

#### G. 建议的落刀顺序（每刀可独立验证、可独立回退）

1. **收口子**：所有目录访问改走 `dir()`，删掉全部硬编码字面量。**零行为变化**，测试应全绿。
2. **拆 config**：`RpConfig` 按 2.4 的表拆成「卡级 / 全局」两份，先只做**读**的分流，写侧不动。
3. **换源头**：`server/main.ts:166` 的 cwd 从常量改成「当前卡目录」，含启动迁移。
4. **退名单**：三套卡归属口径退役（`sameCardPath` 7 处 + `rp-card` + 两个哈希/卡名口径）。
5. **补备份**：`src/backup.ts` 四处按 E 改，加一档格式版本。

### 2.6 这一步的完成判据

1. 两张卡各有自己的目录，互不可见对方的状态 / 世界书 / 技能 / 记忆。
2. 会话列表不再需要 `sameCardPath` 过滤（结构上就分开了）。
3. 已有数据能迁移过去，且备份 / 导出 / 导入三条路径仍然通。
4. **第零步那张表在项目化后重测一遍，四个指标不劣化。**

### 2.7 铁律核查

- 铁律一：**不新增任何送模文案**（这一步全在磁盘布局与配置作用域，一个字都不进提示词）。
- 铁律二：不新增注入点。
- 铁律三：**删名单**（`sameCardPath` 那套字符串比对整体退役），不加名单。
- 铁律四三问：全集＝所有卡；负责人＝cwd 本身；没见过的卡＝进自己的目录，行为与今天一致。

---

## 三、第二步：回归 pi 与 pi 的 rp 化

### 3.1 判据（用户 2026-09-05 原话大意）

> 为什么我想回归 pi？因为我发现**我们的基底就不够丰富**。我们当时是在一个完完全全的纯净 pi
> 的基础上来改，然后囫囵吞枣地加预设、加酒馆的各种东西。
> **回归 pi 和加工具其实是同一步**，目标就是让排开预设这个最大污染后的梨园能够成为
> **合格的 rp agent**。

### 3.2 本机 pi 的调研结论：合格 coding agent ＝ 循环有纪律，不是工具多

十八个扩展逐个查过（清单与细节见记忆 `liyuan-pi-extension-survey`），按**补的缺陷**归六类：

| 类 | 扩展 | 补什么 | 给模型加工具吗 |
|---|---|---|---|
| **循环纪律** | `pi-until-done`、`pi-codex-goal` | 目标契约 + 进度 + 预算 + **完成宣称要过独立模型裁判** | 加（8 / 3 个，全是「管自己」的工具） |
| **写前只读** | `pi-plan-mode` | 探索、问清、批准了才准动手；**拦截在 `tool_call` 层，不动全局工具集** | 加 2 个（提问 / 交计划） |
| **可逆** | `pi-rewind` | 每轮一个 git 检查点，工作树没变就删掉；diff 预览 + redo 栈 | **零工具** |
| **上下文** | `pi-nano-context`、`pi-dynamic-context-pruning` | 看得见占用；**只改副本、只换占位符、从不删消息**，三条确定性策略 + 三层保护 + 缓存收支闸门 | 零工具 |
| **外部取证** | `pi-search`、`pi-ace-tool`、`pi-mcp-adapter` | 联网 / 语义检索 / 协议桥（用网关工具省 system token） | 加（这一类才是加能力的） |
| **卸载与提问** | `pi-btw`、`rpiv-ask-user-question` + 五个界面类 | 侧问不污染主线（`context` 钩子过滤）；歧义处结构化提问 | 加 1 个 |

**核心结论：十八个里只有三个在加领域能力，其余全在管循环本身。`pi-rewind` 一个模型工具都不注册。**

**最像答案的是 `planning-with-files` 这个 skill**：把计划 / 发现 / 进度落成项目根下三个 markdown，
用 PreToolUse 钩子**在每次工具调用前把计划前 30 行强制读回上下文**，写完文件提示更新状态，
停止时校验阶段完成，还有 `/clear` 后的恢复脚本。**状态不在模型脑子里，在磁盘上，靠机制反复读回来。**
它甚至自带一条安全边界：网页内容只准进 `findings.md`，不准进 `task_plan.md`（因为后者会被反复注入）。

### 3.3 梨园与 pi 的差距：**不是缺钩子，是钩子被搬进了循环里**

**决定性事实（本窗口读码坐实）**：`.liyuan/extensions/roleplay.ts:1233-1239` 有一段明写的注释：

> harness 生成流程已整体移除（2026-08-02 重做）：`before_agent_start` / `context` /
> `before_provider_request` / `agent_end`×2（场记记账·固定楼层压缩）/ `session_before_compact`。
> **新的固定流水线将在此处重建。**

⇒ **这六个钩子曾经真的挂在 pi 的扩展上**，8/02 重做时被摘掉、搬进 `StageEngine`。
**第二步不是"移植到一个陌生架构"，是回到这个注释指的位置。**

**vendored pi 的扩展机制完好无损**（本窗口核实）：
- `packages/coding-agent/src/core/extensions/` 四个文件全在（loader 21.9KB / types 58KB / runner 36KB / wrapper）。
- `ExtensionAPI` 提供 **40 个 `on()` 重载**（2026-09-05 逐条数过，原写 28 偏少；`types.ts:1141-1180`）：`project_trust`、`resources_discover`、`session_*`（start / before_fork /
  before_tree / tree / compact / info_changed / shutdown）、`before_agent_start`、`agent_start`、
  `turn_start`、`context`、`before_provider_request`、`after_provider_response`、
  `tool_call`、`tool_execution_start/update/end`、`tool_result`、`message_start/update/end`、
  `turn_end`、`agent_end`、`model_select`、`thinking_level_select`、`user_bash`、`input`。
  （**缺 `agent_settled`**——那是 0.84 才有的，vendored 的 0.80.3 没有。）
- **扩展今天真的在加载**：`server/main.ts:232` → `createAgentSessionServices({cwd})` →
  `resourceLoader.getExtensions()`；`server/main.ts:987` `session.bindExtensions(...)`。
  实际加载的是 `.liyuan/extensions/roleplay.ts`（81KB），**里面还挂着 3 个真钩子**
  （`session_start:1069`、`tool_call:1264`、`session_tree:1285`）与 **16 个 `registerTool`**。

### 3.4 一拍的手搓点位对照表（第二步的工作清单）

`StageEngine` 一拍跨 `#run` → `#turn` → `#agentLoop` 三层，共 **45 个固定时机点位**。逐个对照：

| pi 钩子 | 梨园今天的点位 | 可直接映射？ |
|---|---|---|
| `resources_discover` | `engine.ts:613` 每拍现读素材 | 语义吻合；**pi 是会话级、梨园是每拍级** |
| `before_agent_start` | `engine.ts:719-730` `buildStageSystemPrompt` | ✅ 直接 |
| `context` | `engine.ts:636`、`645-649`、`654-661`、`667`、`717`、`731-744`、`746-810` | ⚠ **一个钩子碎成 7 处**，无单一切面 |
| `before_provider_headers` | `engine.ts:812` | 只取不改，无改写口 |
| `before_provider_request` | `engine.ts:822-833` `onPayload`（+ 请求点 `:835`、`:1328`） | 部分：`onPayload` 是 `streamSimple` 的参数，不是钩子 |
| `after_provider_response` | `engine.ts:840-855`（首轮）+ `1332-1348`（循环内） | ⚠ **两处重复实现** |
| `tool_call`（可 block） | 台上 `engine.ts:1433` → `src/tools/gate.ts`；幕后 `roleplay.ts:1264` 真钩子 | ⚠ **双份实现，一份纯函数一份钩子** |
| `tool_execution_start/update/end` | `engine.ts:1214`/`1256`/`1286-1288` | 位置吻合，无返回值、无 block |
| `tool_result` | `engine.ts:1289-1297` | 位置吻合，无改写口 |
| `turn_start` / `turn_end` | `engine.ts:574` / `:585` | ✅ 直接 |
| `agent_end` | `engine.ts:898-917` 落树 + `958-1018` **场记** + `943-952` 错误 | ⚠ **一个钩子摊成 3 处**；场记原本就是 `agent_end` |
| `session_before_compact`/`session_compact` | `engine.ts:1045-1047`/`1057-1070`/`1073-1113` | 时机吻合但权归引擎（`main.ts:2614` 已显式让位） |
| `session_start` / `session_tree` | `roleplay.ts:1069` / `:1285` | ✅ **今天就是真钩子** |
| `agent_settled` | `engine.ts:582-586` finally + `562-567` 排队 | 0.80.3 无此钩子 |
| **pi 无对应** | `MAX_ROUNDS` 撤工具 `1323-1326`；宽进严出代收 `1192-1209`；定稿合并 `:891`；`ask` 等用户 `1218-1254`；世界线存档 `1024-1040`；媒体落树 `929-941`；beatLog 留档 `595-610`/`:923`；旁白清屏 `1304-1321` | 这 8 项是**梨园独有的 rp 语义**，是「pi 的 rp 化」要新增的那一部分 |

**AgentSession 今天退化成什么**：叙事回合完全不经它的 agent 循环（`main.ts:2438` 把 `streamFn`
绑成 `streamSimple`，引擎 `:835`/`:1328` 直呼模型层）。它现在只做会话树存储（21 次）、
模型层（18 次）、会话标识（27 次）、树导航（5 次）；只有斜杠命令 `main.ts:2639` 还走 `session.prompt`。
另有 **3 处 `session.agent.state.messages = ...` 直写**（`main.ts:799`、`:2464`）——
引擎写树后手动把 pi 的内存副本对齐，这是「两套真相」的具体形态。

### 3.5 第二步的两件事

**件一：把 45 个手搓点位搬回钩子（vendored 0.80.3 上 40 个 `on()` 重载）。**
不是重写引擎，是**把固定时机交还给 pi**。收益是铁律二三从自觉变成架构强制：通道集由 pi 定义，
每个通道有唯一主人、语义写死，**想堆也堆不了**。优先级按「碎得最厉害的先收」：

1. `context`（7 处 → 1 处）——收益最大，今天注入散在七个地方正是历史上反复出事的地方。
2. `agent_end`（3 处 → 1 处）——场记本来就是它。
3. `after_provider_response`（2 处重复 → 1 处）。
4. `tool_call`（双份 → 一份）——台上的 `gate.ts` 与幕后的真钩子合并。

**件二：pi 的 rp 化 —— 按六类补，不按扩展名补。**

| pi 的类 | rp 里对应什么 | 梨园今天有没有 |
|---|---|---|
| 循环纪律（目标 + 裁判） | 一拍的目标是什么？谁判"这拍演完了"？ | **无**。只有 `MAX_ROUNDS` 安全阀 |
| 写前只读 | 演之前先探索、先问（三步大方向的第三步「探索触发」） | **从未建成** |
| 可逆 | 改错能退到上一稿 | **无**（会话树回退是消息级，不是稿件级） |
| 上下文 | 看得见 / 剪得掉 | 有 compact（攒够拍数），**无可观测、无确定性剪枝** |
| 外部取证 | 世界书 / 向量库 / MCP | **有**（22 个工具） |
| 卸载与提问 | 场记 / assistant_run / ask | **有** |

⇒ **梨园缺的正是前三类，而这三类恰好都不加领域工具，全是循环纪律。**

**最要紧的一条（本窗口实测）**：pi 的 8 个内置工具**全部指向同一个名词＝工作目录里的文件**；
梨园的 22 个指向七种互不相干的抽象名词（世界书 / 向量库 / 卡 / 世界线 / 面板 / 状态 / 用户），
**没有一个指向正文**。模型写的那一拍戏，它读不到、改不了、搜不了——正文从消息流里流过，
不是躺在某处的东西。这解释 8/21「工具全在、一个不碰」，也是
`feedback-ai-writing-iterative-not-oneshot` 那条「正文没有代码的地位」的结构形态。

**另一条实证**：`src/paths.ts:52` 定义了 `.liyuan-artifacts` 目录，**全仓零消费者**
（`DIRS.artifacts` 除定义处外 grep 0 命中）。**工件目录只有名字。**

⇒ 第一步把卡变成工作目录之后，「正文＝工作目录里的文件」才第一次成为可能。
**这就是两步必须按这个顺序的原因。**

### 3.6 这一步的完成判据

1. 一拍的固定时机全部走 pi 钩子，`StageEngine` 不再自持循环。
2. 前三类（循环纪律 / 写前只读 / 可逆）各有一个能跑的最小实现。
3. **正文成为工作目录里的文件**，模型能读、能改、能搜自己写的东西。
4. 第零步那张表重测：工具调用、思考量、正文是否经工具落笔、主动 ask——**四项都要变**。

### 3.7 铁律核查

- **铁律一**：pi 的第 5 格 `promptGuidelines` **唯一来源是工具定义自己声明的**，按活跃工具收集、
  工具下场自动消失——**这是「先问删掉哪句能解决」的架构答案，句子不再靠人删**。
- **铁律二**：回到 pi 的钩子图上，通道集由 pi 定义（40 个 `on()` 重载，闭合），**想堆也堆不了**。
- **铁律三**：不新增任何识别别人措辞的名单；工具与钩子都是自己发行的协议。
- **铁律四三问**：全集＝所有卡所有预设；负责人＝pi 的钩子图；没见过的卡＝走同一套钩子，
  行为由数据决定不由分支决定。

### 3.8 两个必须先答的未决

1. **vendored 0.80.3 要不要跟上 0.84.4？** 已知 0.84.0 的破坏性改动 `message_update` 只发 delta
   （去掉累积 message 与 partial）**正打在梨园流式上屏路径**；0.84.1 `tool_call` 可 terminate；
   0.84.2 defaultTools 可配；0.83 `ctx.scopedModels`；`agent_settled` 也是 0.84 才有。
   **仓库内的 CHANGELOG 停在 0.80.3，0.81–0.84.4 的完整破坏性清单要另查。**
2. **梨园独有的 8 项 rp 语义放哪一层？**（撤工具安全阀 / 直出代收 / 定稿合并 / ask 等用户 /
   世界线 / 媒体 / beatLog / 旁白清屏）它们 pi 没有对应钩子，是"pi 的 rp 化"要新增的那部分。
   **是写成扩展，还是提议给 pi 加钩子，未定。**

---

## 四、执行纪律（本档自身）

- 本档是计划，**每一条动手前仍要过 repo `CLAUDE.md` 铁律四的三问**。
- 当前顺序：已完成底座之后，**无预设扮演体验 → 角色卡制作与配套代码能力 → 前端优化**；详见 [新计划](PLAN-RP-AGENT-NEXT.md)。预设低优先级后置。
- 预设的两条路（[[liyuan-preset-as-function]] 的「函数化」与「窄拆法」）**留到最后**，
  用同一个双配置实验判定，不在本档展开。
- 判断权在用户；我不自行升格、不自行扩权。
