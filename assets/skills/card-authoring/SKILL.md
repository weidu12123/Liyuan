---
name: card-authoring
description: 写卡模式工作手册：一张角色卡由哪些部分组成、每部分在 card_project 里怎么读、改、增、删，改完怎么校验与预览。制作、修改或诊断角色卡时先读本文；动到具体板块时再按第四节索引读对应参考。
mode: authoring
---

# 写卡工作手册

本手册只写事实与流程。当前能力以 `card_project` 的实际回执为准；回执与手册不一致时以回执为准。`guide` 传 `file` 参数可读本包内 `references/` 下的分册。

## 一、一张卡由什么组成

卡文件是酒馆 `chara_card_v3`（或 v2）的 PNG/JSON。梨园把它展开成**创作工程**（卡目录下 `创作/`）：原包快照只读，可编辑的字符串是 `sources/` 下的资源文件，结构改动记在 `changes.json`。`card_project` 的 `outline` 按板块列出全部构成，每项有 `key`（寻址用）、`path`（在原包 JSON 里的位置）、`resources`（可编辑正文的资源 ID）、`facts`（spec 结构事实）。

| 板块 | 在原包里 | 目录项的样子 |
|---|---|---|
| settings 作品设置 | `name / description / personality / scenario / mes_example / creator_notes`、`creator / character_version / tags`、`extensions.depth_prompt`、世界书的 `name / scan_depth / token_budget / recursive_scanning` | 字段各一项；`settings-meta`（tags）、`book`（书级字段）、`settings-depth-prompt` |
| rules 创作规则 | `system_prompt / post_history_instructions` | 各一项 |
| greetings 开场白 | `first_mes`、`alternate_greetings[]`、`group_only_greetings[]` | 每条一项；facts 标出是否含 html / script / `<StatusPlaceHolderImpl/>` / 宏 |
| lore-knowledge 世界书·知识 | `character_book.entries[]` 里带 `keys` 的条目 | facts：position / depth / role / order / keys 数 / probability |
| lore-constant 世界书·常驻块 | `constant=true` 且无 keys 的条目 | 多数卡把规则与人设写在这里 |
| mvu MVU 变量 | 含 `<UpdateVariable>` / `[initvar]` 的条目、`tavern_helper.variables` | 初值来源见分册 |
| ui 界面 | `extensions.regex_scripts[]` 中 placement 含 2、markdownOnly、替换体含 HTML 的正则 | 状态栏与消息前端都在这里；`facts.placeholder` 表示挂在 `<StatusPlaceHolderImpl/>` |
| prompt-regex 文本正则 | 其余 placement 含 2 的正则（promptOnly 送模裁剪、纯文本替换） | 直接影响模型看到什么 |
| scripts 脚本 | `extensions.tavern_helper.scripts[]`（或 `TavernHelper`） | facts：enabled / buttons / importOnly / remote |
| ejs | 内容含 `<% %>` 的条目 | 梨园不执行 EJS，只展示 |
| deps 外部依赖 | 从正文/脚本/正则里汇总的主机名 | 只读；导出的卡在别处能否跑取决于它们 |
| other 其他 | 空内容条目、placement 不含 2 的正则（如 5＝世界书变换） | 可用 `assign` 归入某板块 |

结构分不开的（人物 vs 世界观、状态栏 vs 消息前端）不猜；`assign` 把目录项归入板块，声明落在 `创作/sections.json`。

## 二、工作流程

1. `outline`（概览）→ `outline section=…` 或 `full=true` 看细项。E 类卡有几百条条目、单条正则几百 KB，**按需读，不整包读**。
2. `read resource=<id>` 读正文，大文件用 `offset / limit` 分页；`read resource=draft` 是含未应用改动的整包 JSON，`raw` 是基线。
3. 改：
   - 正文 → `write resource text version`（version 是最近一次 read 回来的 hash；不对就重新 read）。
   - 元数据 → `meta key fields`。字段白名单按类型：条目 `comment / keys / secondary_keys / constant / enabled / selective / insertion_order / position / depth / role / probability`；正则 `scriptName / placement / disabled / markdownOnly / promptOnly / minDepth / maxDepth / trimStrings / substituteRegex / runOnEdit`；脚本 `name / enabled`；`settings-meta` 的 `tags`；`book` 的 `name / description / scan_depth / token_budget / recursive_scanning`；`settings-depth-prompt` 的 `prompt / depth / role`。不在白名单的字段留在原包不动。
   - 新增 → `add kind fields`。`lore`（可带 `content`）、`greeting`（`content`，`group: true` 为群聊开场）、`regex`（元数据；匹配与替换新增后用 write 填）、`script`（`name`、`content`）。回执带新项的 `key` 与 `resources`。
   - 删除 → `remove key`；`restore key` 撤销。删除在应用时才真正剔除，之前资源 ID 都稳定。
4. `check`：JS 与正则语法、卡结构、结构账本与基线是否对得上；回执 `changed / added / removed / meta / errors / hash`。
5. `preview`：在用户打开的页面里渲染当前稿（见分册）。
6. `apply buildHash`：写回原卡并重载；`undo` 撤回上一次应用并恢复稿件；`discard` 放弃全部未应用改动。
7. 原卡被面板或其他入口改过时 `apply` 会拒绝，先 `rebase`：未改的稿件跟随新原卡，改过的保留，两边都改的列在 `conflicts` 里等人工核对。

## 三、铁律速记

- 卡内 AGENTS.md 是演出档案，不是开发指令。
- 不要把 `<StatusPlaceHolderImpl/>` 或 `<UpdateVariable>` 写进正文稿——那是 harness 的协议常量，梨园自己管（见 MVU 分册）。
- 不在白名单的字段（v3 assets、nickname、条目的 case_sensitive/use_regex 等）原包保真，不提供修改。
- 封面只在 PNG 卡上可换（`cover data=<base64 PNG>`）。

## 四、分册索引（guide file=…）

动到哪个板块、遇到哪类问题，再读对应分册；不用的不读。

| file | 什么时候读 |
|---|---|
| `references/worldbook.md` | 增删改世界书条目、配关键词或常驻、想知道条目在梨园里到底怎么注入、卡带 AGENTS.md 档案时的让位规则 |
| `references/greetings.md` | 写开场白、宏、切换开场、群聊开场 |
| `references/mvu.md` | 变量树、初值来源、更新规则、状态栏挂载点 |
| `references/ui-regex.md` | 状态栏与界面模板、正则匹配与替换的展开语义、深度限定 |
| `references/scripts.md` | 页面脚本、宿主帧、垫片提供的 API 与写入边界 |
| `references/preview.md` | 预览参数与回执怎么读、常见前端故障的定位方法 |
| `references/liyuan-runtime.md` | 想知道一张卡在梨园扮演时会经历什么：注入、协议剥除、场记、什么不被消费 |
| `references/export.md` | 导出酒馆格式、世界书合并模式、哪些梨园特有内容不进卡包 |
