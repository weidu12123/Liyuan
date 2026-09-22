# 界面国际化（中 / 英切换）

2026-09-23。PR #10（社区的英文翻译）被否决时定下的形状是本文的前提：**只有界面外壳走 `t()`；正文、状态栏、卡皮肤 iframe、过程记录里的模型输出永远不进翻译器。** 那份 PR 反着做——`MutationObserver` 扫 `document.body`、1300 条子串目录、含 开/关/出/话 这类单字键——会把稿子里的词改掉。本文按正确方向落地，PR 的目录只当清单参考。

## 一、范围

翻译的（外壳）：

| 层 | 在哪 | 规模（中文字面量） |
|---|---|---|
| Web 前端 | `web/src/**`（除内容面文件） | ≈ 1800 条，40 文件；`CardStudio` 298、`App` 158、`LorebookPanel` 129、`ConnectPanel` 128、`CardPanel` 124、`PresetPanel` 121、`SettingsPanel` 121、`Messages` 112 … |
| 服务端送到界面的话 | `server/rest.ts`（错误 138 处）、`server/main.ts`（错误 21、`notify` 44）、`src/activity-format.ts`（过程条摘要 39）、运行时生成的缺省名（`cardspace.ts` 等） | ≈ 500 条 |
| 桌面壳 | `desktop/main.mjs`（菜单、对话框、欢迎流程） | ≈ 100 行 |

**不翻译的**：

- 提示词与种子（`assets/*.md`、`SYSTEM.md`、`AGENT_APPEND_SYSTEM.md`……）——那是给模型的，模型写什么语言由既有的 `config.language` 定，与界面语言是两件事。
- 数据布局里的目录名与文件名（`cards/`、`对话/`、`会话/`、`正文/`、`历史/`、`对话.json`、`记忆.md`……）——是协议，改名＝迁移，不在本次。
- 卡、预设、世界书、用户自己的内容；已经落盘的会话名、子项目名、过程条历史。
- 内容面文件：`tavernShim.ts`、`frameDoc.ts`、`scriptHostDoc.ts`、`cardAuthoringPreview.ts`、`markdown.ts`、`richContentParts.ts`、`htmlEmbed.ts`（它们里的中文是给 iframe / 卡脚本的兼容层或内容处理，不是外壳）。
- 文档站与 README（另起）。

## 二、机制

### 2.1 键＝中文原文

```ts
t("保存")                          // → "Save"
t("已建立配置仓库：{ids}", { ids })   // 占位符 {name}
t("{n} 章", { n })                 // 英文目录里写 "{n} chapter|{n} chapters"，按 n 选
```

- 源码里照旧写中文——作者的工作语言，diff 可读；中文目录不存在，`zh` 就是源码。
- `en` 目录是一张 `Record<中文, 英文>`；缺条目回落中文（界面不会空）。
- 同一中文在不同处要不同英文时，改中文原文让它不歧义（那是作者自己的文案），不加 context 参数。
- 不引第三方库。

### 2.2 两份目录，同一格式

- `web/src/i18n/`：`index.ts`（`t`、`useLocale`、`setLocale`、复数与占位符）＋ `en.ts`。
- `src/i18n/`：`index.ts`（进程级 locale，`t` 同签名）＋ `en.ts`。`server/*`、`src/activity-format.ts`、`src/cardspace.ts` 用它。

两棵构建树（vite / node）各持一份，键有重叠时各自维护；不做跨树 import。

### 2.3 语言在哪定

- `liyuan.config.json` 新增 `uiLanguage?: "zh" | "en"`（进 `CONFIG_EDITABLE` 白名单）。**一个实例一种界面语言**——服务端的错误、通知、过程条摘要都按它出，多设备同一账号看到的一致。
- 前端：`config.uiLanguage` 为准；配置还没到（登录页）或配置里没写时，按 `navigator.language`（`zh*` → zh，否则 en）先显示，不落盘。
- 切换入口：设置面板「界面语言」；登录页右上角小切换（英文用户第一眼就能找到）。切换＝`PUT /api/config { uiLanguage }`，前端立即重渲染，服务端从下一条消息起生效。
- 桌面壳读同一份 `liyuan.config.json`。
- `<html lang>` 与 `document.title` 跟 locale。

### 2.4 服务端字符串的形状

- 错误：`throw new Error(t("非法预设路径"))`——抛出点翻译，前端原样显示。
- `notify`：`text: t("…")`。
- 过程条摘要（`activity-format.ts`）：生成时按当时 locale；**已经写进 `rpTimeline` 的历史不重译**（已知限制，写进本文）。
- 运行时生成、会落盘的名字（新子项目缺省名「新对话」、预设「主提示词」等）：按当时 locale 生成一次，落盘后就是数据。

### 2.5 术语表（英文目录统一用法）

| 中文 | English | 中文 | English |
|---|---|---|---|
| 梨园 | Liyuan | 角色卡 / 卡 | character card / card |
| 世界书 / 条目 | lorebook / entry | 预设 | preset |
| 会话 | session | 子项目 / 项目 | project |
| 对话 | chat | 扮演（模式） | roleplay (mode) |
| 工作（模式） | work (mode) | agent 模式 | agent mode |
| 稿子 / 正文 | manuscript / story text | 稿纸 | draft |
| 开场白 | greeting | 状态栏 | status bar |
| 前情提要 | recap | 账本 / 世界状态 | ledger / world state |
| 登场名录 | roster | 世界线 | worldline |
| 场记 | scribe | 旁路模型 | side model |
| 楼层 | floor | 拍 / 轮 | beat / turn |
| 悬浮球 | orb | 面板 | panel |
| 过程条 | process strip | 检查点 | checkpoint |
| 记忆（向量） | memory | 剧情库 / 额外库 | story store / extra store |
| 人设 / 用户人设 | persona / user persona | 名录 | roster |
| 技能 / 技能包 | skill / skill pack | 连接（模型） | connection |
| 重 roll | reroll | 回退 | rewind |
| 压缩 | compaction | 沙箱 | sandbox |
| 卡空间 / 卡文件夹 | card space / card folder | 工坊 | studio |

语气：按钮用动词原形（Save / Delete / Import），提示句完整句、不用感叹号，不出现「you」的说教腔。

## 三、完整性检查（铁律三：不靠人记）

`scripts/i18n-check.mjs`：TypeScript AST 扫描 `web/src`、`server`、`src/activity-format.ts` 等外壳文件，列出**不在 `t(...)` 第一参数位置**的中文字符串字面量 / JSX 文本；内容面文件在允许名单里（第一节列的那几份）。作为 `test/i18n-check.test.ts` 进 `npm test`——扫出零条才绿。`en.ts` 里的键必须都在源码里出现（反向检查，防死条目）。

## 四、实施切分

- **刀 1 机制**：两份 `i18n/`、`uiLanguage` 配置与白名单、设置面板与登录页的切换、`<html lang>`、检查脚本（先只对已迁移文件生效，允许名单逐刀收缩）。迁 `LoginGate` / `HomePage` / `SettingsPanel` / `AboutPanel` 做样板。
- **刀 2 前端主体**：`App`、`Messages`、`SessionsPanel`、`StatusStrip`、`StoryPane`、`PanelDock`、`FloatWindow`、`kit`、`UpdateFlow`。
- **刀 3 前端面板**：`CardStudio`、`CardPanel`、`CardAuthoring`、`LorebookPanel`、`PresetPanel`、`ConnectPanel`、`PowersPanel`、`SkillLibrary`、`PersonaPanel`、`UploadsPanel`、`RosterPanel`、`RolesPanel`、`StatusPanel`、`WorldlinePanel`、`DraftPanel`、`ArtifactPanel`、`AvatarCropModal`、`PreviewRunner`、`PanelOrb`。
- **刀 4 服务端**：`rest.ts`、`main.ts`、`activity-format.ts`、`cardspace.ts` 缺省名。
- **刀 5 桌面壳**：`desktop/main.mjs`。
- 每刀：`npm test`（含检查脚本）、`web` typecheck；刀 2 起用隔离实例真浏览器切换看一遍。发版前 `web/dist` 重建一次（不逐刀构建）。

## 五、铁律自检

- 铁律一：不碰任何送模文案。
- 铁律二：不新增注入。
- 铁律三：目录是数据（`en.ts`），harness 只做查表；检查脚本是对源码的静态约束，不是对内容的识别器。
- 铁律四：全集＝外壳上一切给人看的字；负责人＝`t()` 与两份目录；没见过的卡不受影响——卡的内容根本不经过它。

## 六、状态

- 2026-09-23：五刀全部落地，`npm test` 含 `i18n-check` 全绿（822/824，红的两条是本机缺私有卡的既有实卡测试）。扫描 55 个外壳文件，未走 `t()` 的中文字面量 0 条；目录 1713 条（web 十片＋src 两片）。隔离实例真浏览器实测：设置里切 EN → `<html lang>`、标题、面板标题、栏轨标签当场换，`/api/access/login` 的错误从「未设置访问密码」变 “No access password set”，`liyuan.config.json` 落 `uiLanguage`，刷新后仍是英文；切回中文同样即时。卡的开场白正文一字未动。
- 迁移中定下的几条约定：常量表按「值留中文加 `// i18n-ignore`、用时 `t(TABLE[k])`」（检查脚本把这类值算作在用的键，但不强求英文）；同一中文在两处要不同英文时改中文原文（`{n} 条`＝消息数；`{n} 条目`／`{n} 条条目`＝条目数）；前端不再按服务端中文文案做 `includes` 判断（`App.tsx` 的通知刷新改成「首页或会话面板可见时任何通知都轻刷一次」）；`nextProjectName` 的序号正则按当前语言模板生成。
- 已知限制：桌面壳菜单在起窗时建一次，网页里切语言后菜单要下次启动才换；已写进 `rpTimeline` 的过程条摘要、已落盘的会话名/子项目名/检查点留言保持生成时的语言；`.field-hint` 的 `word-break: break-all` 改成 `normal + overflow-wrap: anywhere`（英文不拆词，中文照常逐字断）。
- 未做：README 英文段、文档站英文版（另起）。
