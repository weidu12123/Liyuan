# PLAN-RP-AGENT-EXEC：立骨架执行计划（M-A/M-B/M-C/M-D）

> **2026-09-08：本文保留为历史执行记录，当前路线见 RP agent 下一阶段。**
> 下一步先优化无预设扮演体验，再补角色卡制作与配套代码能力，第三步前端优化；预设继续后置。
> 本文旧检查器、强制流程和未勾选项不能直接当作当前待办；以最新用户决定及第三刀、上一拍修订记录为准。

> 2026-08-03 定稿。上游契约：docs/PLAN-RP-AGENT.md（两层设计：RP 工具栈 + 预设拆三层）。
> 本文档是它的**执行计划**——把四个任务（agent 循环、RP 工具、预设拆层、板块工具化）收敛成
> 四个里程碑，每步落到具体文件、带验收标准。23 拍实弹数据（8 层 × 主生成+2 roll）已坐实全部根因。

## 0. 证据基线（23 拍实弹，2026-08-03）

后续所有验收都对照这组数：

| 指标 | 现状 | 目标（M-A 后） |
|---|---|---|
| 思考量 | 0–37259 字随机抖动（f3-swipe2=37259） | 收敛到读题+决定（几百字级） |
| 空正文拍 | 3/23（f2-s2/f6-s2/f7-main，思考→检索→结束，0 字） | **0**（结构性消灭，见 §2.3） |
| 最佳拍基准 | f6-main：0 思考 / 33.9s / 1945 字 | 常态化（证明排练是纯浪费） |
| draft_write 调用 | 0（工具零注册） | 每拍 ≥1，wire 可见 |
| 脑内账本 patch | 思考尾部手写 JSON patch（f6-s2 实录） | world_state_update 工具调用 |
| 场记记账 | 「输出不可解析」失败（格式栈混入正文） | 模型直接提交 patch，harness 只验 |
| #revise | 幕后偷改，模型不知情 | 停用，M-B 由 check→edit 循环取代 |

三处病灶同一根因的三个投影：写正文（脑内排练）、改正文（#revise 偷改）、记账（#sideText 偷做）
——全部改成**模型是操作者，harness 是执行器**。

## 1. 决策记录（本文档采用的默认方案，否决请改此节）

| # | 决策 | 采用方案 | 理由 |
|---|---|---|---|
| D1 | 流式体验 | draft_write 的 content 参数**增量转发**到现有 text 通道 | 用户体验几乎不变，正文照样流出；draft_edit 补丁走修订帧 |
| D2 | 唯一交稿入口的强制方式 | **宽进严出**：模型直出正文时 harness 自动视为一次 draft_write（落工作区→跑 check→报告喂回） | 弱工具模型不卡死，强模型自然走工具路 |
| D3 | 破限归属 | **留提示词侧**（不进代码层） | 破限是生成前说服，验收器只能事后打回，机制不匹配（修正 PLAN-RP-AGENT §3.3） |
| D4 | 压缩 compact | **留 harness 侧不工具化** | 等同 coding agent 的自动压缩，上下文管理是 harness 本职 |
| D5 | 场记旁路 | M-A 降级为**兜底**（模型没调 world_state_update 才旁路补账），M-B 视数据决定退役 | 平滑过渡，账本不断档 |

## 2. M-A：立骨架（切片）——✅ 已完成（2026-08-03，两拍实弹验证，424 测试绿，未提交）

> 实弹记录 `_obs-ma/2026-08-03T10-44-06-280Z/`：循环形态达成（f1 查设定×5 → 交稿 500 字被打回
> → 重交 3564 字通过 → 模型记账；f2 直出代收→四次重交→通过；场记零发出、空拍零）。
> 思考未塌（f1=41951 字/187.8s，f2=9567 字/9412 字正文/132.7s）——预设与格式栈还在场，M-C 的活。

### 2.1 范围

开放式 agent 循环 + 三工具（draft_write / draft_check / world_state_update）+ wire 工具帧
+ draft_write 参数流式转发。**不含**：draft_read/edit/search（M-B）、预设拆层（M-C）。
M-A 实弹时格式栈不会完全消失（预设还在要求 w2g/catsay）——这不算 M-A 失败，见 §2.6。

### 2.2 新模块：回合工作区 `src/stage/workspace.ts`

正文成为工件的落点。一拍一个工作区，持有：

- `draft: string` —— 当前稿（draft_write 全量替换；宽进严出的直出正文也落这里）
- `writes: number` —— 交稿次数（验收统计用）
- `patches: Record<string, unknown>[]` —— world_state_update 累计的 patch（定稿后统一套用）
- `lastReport` —— 最近一次 draft_check 报告（判「全绿」用）

执行器复用现成代码，**零新算法**：

| 工具 | 执行器（现成） | harness 职责 |
|---|---|---|
| draft_write | 落 `ws.draft` | 收稿 + content 增量转发 text 通道（D1） |
| draft_check | `checkDraft` + `checkSovereignty` + `formatDraftReport`（src/draft.ts） | 跑规则出报告，报告文本回喂 |
| world_state_update | `applyPatch` 干跑验证 + `canonicalizeCharacterKeys`（src/state.ts） | **只验不生成**：JSON 合法/路径存在/主权红线；合格入 `ws.patches`，报告套用结果 |

### 2.3 循环重写：`#toolsTurn` → `#agentLoop`（src/stage/engine.ts:559）

```
思考 → 工具 → 看结果 → 再思考 → 工具 → …… → 定稿
```

- **谢幕条件**：模型停止调用工具（stopReason ≠ toolUse）时判定——
  - 工作区有稿 → 定稿收拍；
  - 工作区无稿但本轮直出了正文 → 宽进严出（D2）：自动收稿、跑 check、报告喂回，再给一轮；
  - 无稿也无正文 → 回喂「你还没有交稿」逼续写。**空正文拍在此结构性消灭**（现状 engine.ts
    的 `if (final && text)` 落树意味着空拍静默丢失，用户白烧一次 roll 且无任何通知）。
- **安全阀**：`MAX_ROUNDS = 12`（取代 MAX_LOOKUPS=3 的检索封顶）。触阀时以现稿定稿，
  onNotify 告警。只读三工具（lorebook/memory/world_state_get）并入同一循环，不再单独限次。
- **落树语义**：assistant 条目正文 = 工作区定稿（不是 raw 流拼接）。工具调用轨迹以现有
  activity 机制留痕。
- **定稿后**：`ws.patches` 非空 → 叶守卫下统一 `applyPatch` + rp-state 落树（复用 scribe-run
  的守卫与落盘逻辑）；为空 → 场记旁路兜底（D5）。`#revise` 在新路径停用（代码保留给 M-B
  抽 draft_edit）。

### 2.4 工具注册：src/stage/tools.ts

- 新增 `writeTools(language)`：三件写侧工具的 schema（纯数据，与执行分离，沿用现有模式）；
- draft_write 描述里写死契约：「这是唯一交稿方式；不调用即无正文」；
- 引擎分发：读侧走 `runStageTool`（不动），写侧走 workspace 执行器。

### 2.5 流层与 wire：D1 的管道

- `packages/ai` openai-completions：暴露 toolCall 参数增量事件（现在只有 text/thinking delta）。
  **⚠ 顺手清旧账：packages/ai 的 dist 停在 7/18，src/dist 不同步（流式开关运行时死代码），
  M-A 必须重建 dist 并核对**（记忆条目 liyuan-cot-replanning-root-cause 钉过此事）。
- server/wire.ts：`tool_start/tool_end/note` 帧已存在（wire.ts:142），draft_write 的 content
  增量走现有 `assistant_delta kind:"text"`，前端零改动即可先跑通；工具帧展示细化可后置。
- jiti 二象性红线：工作区状态只活在引擎单拍内、不跨模块共享，不触碰 globalThis 桥问题。

### 2.6 M-A 验收（3–5 层实弹，TGbreak 预设 + 一张 MVU 卡，对照 §0 基线）

1. 循环形态：wire 里看得见「思考→工具→思考→工具」，draft_write/draft_check/
   world_state_update 调用可见；
2. 思考量显著塌缩（向 f6-main 的形态收敛），墙钟不劣化（双 KPI：演得好+跑得快——
   多轮往返的延迟增量要量化记录）;
3. 空正文拍 = 0；
4. 账本：world_state_update 提交的 patch 套用成功，「输出不可解析」不再出现（走工具路径的拍）;
5. 回归：现有 413 测试全绿 + workspace/agentLoop 新单测（faux provider 离线整测，沿用
   engine 现有测法）。

## 3. M-B：补齐工具栈 + 旁路退役（**调序后置**：排在 M-C 之后——思考未塌的元凶是预设污染，不是工具栈缺口；draft_edit/read/search 是效率优化，不挡 KPI）

> 2026-08-03 深夜补记（M-C 完成后的形态更新 + 动机强化，**单独会话执行**）：
> M-C 两拍实测显示动笔前一轮思考独占 ~70%（14k 字「一次想透再写」）——因为模型只有
> draft_write（全量替换）没有 edit，只能整拍预规划；f2 的 882→849→838 三连**全文重交**
> 是直接靶子（期望变成 1 稿 + N 次定点 edit）。M-B 是进一步塌思考+提速的主抓手。
>
> M-C 后的形态简化（原计划相应作废）：
> - **工作区即工件**：draft_edit 直接改 `ws.draft` + 改稿即验（与 draft_write 收稿即验同理），
>   **不再需要 rp-draft-op 落树补丁链**（落树语义=定稿）。原「从 #revise 搬」作废——
>   #revise 已在 M-C 删除；`resolveDraftEditText`（draft.ts）直接可用做定位校验。
> - 三工具执行归 workspace `runWriteTool`（engine 分发零改动：READ_TOOLS 之外全走写侧）。
> - 契约与报告指路：draft_write 描述加「局部修改用 draft_edit」；system 工作方式段
>   「写侧三件」→ 五件；`formatDraftReport` 已有「逐处用 draft_edit」指路句，工具就位即生效。
> - draft_read：返回现稿全文+稿次字数；draft_search：命中处 ±24 字上下文引用（≤8 处）
>   ——供 edit 前拿精确原文。
> - **场记旁路 D5 复查**：M-A+M-C 共 4/4 拍模型自主记账、旁路零触发——保留兜底（零成本），
>   M-D 全量后再定退役。
> - wire 替换帧（M-A 遗留 UX 债）：多稿重交正文在流上重复外发；draft_edit 的定点变更不上屏
>   （落树后重渲正确）。替换帧（assistant_replace 类）随 M-B wire 部分做。
> - 展示块渲染管道（w2g 选择框/catsay/摘要以账本渲染补回，D-C3 欠账）是 M-B 后半，
>   可与工具部分分开落地。
> - 验收：两拍实弹对照 M-C（`_obs-ma/2026-08-03T14-12-33-988Z`）——draft_edit 替代全文重交、
>   重交轮思考/墙钟下降、动笔前大规划轮是否变薄。

- `draft_read` / `draft_search`：读工作区现稿/定位文字（纯函数，工作区上包一层）；
- `draft_edit`：定点补丁——从 `#revise` 搬 `resolveDraftEditText` + 套用 + rp-draft-op 落树；
- `#revise` 退役：职责完全由「draft_check 报告 → 模型 draft_edit」取代；
- 场记旁路视 M-A 数据决定退役或保留兜底（D5 复查）；
- 展示类格式块（状态栏/w2g/catsay）改 harness 从账本**渲染**，不再让模型手写——先做渲染管道，
  预设里「必须输出这些块」的要求到 M-C 才摘除，两步咬合。

## 4. M-C：预设拆层（harness 层）——当前里程碑（2026-08-03 细化；类型学详见 docs/PRESET-SPLIT-TAXONOMY.md）

> 2026-08-03 晚：用户指出 Agent 版双人成行是残缺魔改版，不能当分析基础。已对**正常版**双人成行
> （70 启用/19810 字）+ TGbreak（46/11517）+ 夏瑾（12/4293）逐块人工拆层，产出九性质五去向
> 类型学与三份内置拆层表（docs/PRESET-SPLIT-TAXONOMY.md，简称 TAXONOMY）。旧四类分类器
> （preset-classify.ts）降级为未知预设的粗分兜底。本节按 TAXONOMY §5 修订。

### 4.0 摸底事实（2026-08-03 核对）

- **实弹在场预设 = TGbreak😺V2.1.6，46 启用块 / 11517 字**（`.liyuan/preset-override.json`
  优先生效）。「67 块 / 49173 字」是 Agent 版双人成行的数字，且该版残缺——分析语料一律用
  正常版（本地留档）。
- **格式栈实测形态**（M-A f1 落树 8469 字）：draft_notes/w2g/catsay/details 摘要/
  UpdateVariable+JSONPatch 全套在正文里；模型调了 world_state_update 仍手写 UpdateVariable
  =双份记账。⚠ KPI 参照修正：f1「交稿 3564 字」是含格式栈的 content，**真正文
  （extractDraftBody 口径）≈500–800 字**（TGbreak 字数规则），对照要用剥标签口径。
- **历史清洗现状**：draft_notes 命中 FOLD_NAME_RE 历史已剥；w2g/catsay/UpdateVariable 走
  unwrap **内容留历史**=模仿源，需注册 addFoldTags。
- **常驻削减潜力**（TAXONOMY §3）：三份预设常驻可削 74–83%，非破限常驻均 <2k 字；
  退场大头是 H 类「脑内 harness」（预设自带的提示词版引擎，~14k 字，梨园原生机制全覆盖）。

### 4.1 决策（本节为准，否决请改此节；上游 D1–D5 继续有效）

| # | 决策 | 采用方案 | 理由 |
|---|---|---|---|
| D-C1 | 拆层依据（**2026-08-03 晚重定**，原「style 原文常驻」作废） | 按 TAXONOMY 九性质五去向执行：A 破限+B 全程文风+C 行为规则=**常驻**（非破限部分 <2k）；D 方法论+E 场景包=**skill**；F 机械纪律=**代码**；G 验算指令=**丢弃**；H 脑内 harness=**原生机制承接后退场**；I 噪声=蒸发。三份预设用**内置拆层表**（手工校准），未知预设四类器粗分兜底（兜底方向=常驻） | 逐块实证取代正则猜测；「常驻越少越好」的量化落地（74–83% 削减）。H 类整体退场是本里程碑的实弹主变量 |
| D-C2 | 「写作 skill」层 | **工具化按需读取**：读侧第四件工具 `writing_guide(topic)`，D/E 类按主题分包（general / nsfw 起步，主题表由拆层产出写进工具描述）；空则不挂工具 | 真按需的落点是**工具结果不落历史**（rebuildHistory 只留定稿正文）——方法论只活在当拍，谢幕即蒸发。「每拍末端注入」是伪按需。场景包分主题：瑟瑟语料 1211 字只在瑟瑟拍进上下文 |
| D-C3 | 展示块暂缺 | 接受 w2g 选择框 / catsay / 摘要块随 H 类退场**暂时消失**，M-B 渲染管道以账本渲染补回（咪咪吐槽的点评功能精神保留给 M-B 设计） | 调序（M-B 后置）的副作用；实弹期正文更纯利于 KPI 判读 |
| D-C4 | 破限归属（D3 落地） | 破限=A 类，逐块表**显式标注**、常驻原文不动不压缩不拆；未知预设兜底时哄劝话术（JAILBREAK_CHATTER）仍按噪声丢 | 不再依赖分类器兜底碰运气——三份表里 A 类逐块钉死 |
| D-C5 | 主权检查联动（新增） | 拆层表 C 类块可带 `sovereignty-override` 标记：预设自带 user_boundary（如 TGbreak 话痨卡**允许代写 user 对白**）时 checkSovereignty 降档（保留「代做重大决定」，放行「代写对白」） | 不降档则 M-C 实弹（话痨卡）必误报打回，KPI 被污染 |

### 4.2 改造点（按文件，动手顺序即此序）

1. **拆层表数据 + 校验脚本**：`src/preset-split.ts`（或数据文件）承载 TAXONOMY §2 三份内置表
   （块名/性质/去向/句级杂质标记/sov-override）；校验脚本干跑三份预设，报告每块命中与
   未覆盖块（防预设改版后表漂移）。未知预设回落四类器粗分（classifyBlock 保留，降级兜底）。
2. **draft.ts**：
   - `extractDraftRules` 摘掉格式栈 requiredTags 提取（「选择框/行动选项」段与「draft_notes」段
     删除）；**卡状态栏组保留**；字数/禁词/比喻/句式保留——**规则提取扫全量原文含 H 类**
     （夏瑾字数藏思维链尾的教训）。
   - 新增**句级拆分器**（stripAuditLines 扩展）：G 类验算行摘除（*_check/「写完检查」）、
     H 类格式栈指令行摘除、C 类规则句从 H 块救出（TGbreak COT 夹带的 player_input 边界/
     时间不倒流）——按拆层表的句级标记执行，宁漏勿误。
3. **materials.ts**：按拆层表分流产出：`residentBlocks`（A 原文+B/C 归拢节）、
   `skillPacks`（topic→文本）、`presetRuleTexts`（全量，供规则提取）、装配报告
   `presetAssembly`（每块性质/去向/出处，写 `.liyuan/preset-assembly.json`）。
   死变量按表救活/判死；`presetPoliceTexts` 死变量删除；格式栈已知标签注册 `addFoldTags`
   （历史送模整块剥）。⚠ 顺手核实 {{random}} 宏是否会话内钉死（TAXONOMY §4.5，
   破限信件 {{random}} 若每拍重摇会砸 R3 前缀缓存——只核实记录，修复可后置）。
4. **tools.ts + workspace/engine 接线**：读侧加 `writing_guide`（参数 topic，enum 由
   skillPacks 生成；description 写明「写作方法论参考——动笔前读一遍照做；**不是验收清单**，
   机械纪律由验收器把关」）。skillPacks 空则不挂；READ_TOOLS 加名。
   sov-override 标记 → wsDeps 降档开关（D-C5）。
5. **assemble.ts**：
   - system「# 预设指令（用户自备，按原序）」→ A 类原文照排 +「# 文风与写法（用户预设）」
     （B 类）+「# 行为边界（用户预设）」（C 类），引导语明示：照此写作；机械纪律由验收器
     把关，**不要在思考里逐条自查**。
   - 「# 工作方式」只读三件 → 四件：skillPacks 非空时提「本预设附有写作方法论
     （主题：…），动笔前值得用 writing_guide 读相关主题」（空则只字不提）。
   - 「# 输出结构」presetActive 分支删掉「预设要求的其他模块按预设格式输出」——正文=纯剧情
     叙事+卡状态栏（若有）。**对格式栈只字不提，不写「不要输出 X」**。
   - 末端【预设末端指令】→ B/C 类中来自 postHistory 通道的归拢节，同引导语。
   - `StageInjectionOptions` 加 `wordRange`：【导演备注】注入「本拍正文目标 X–Y 字
     （不含格式区块，由验收器核验）」。
6. **engine.ts**：postHistory 侧同走拆层表分流；`planningTag` 链路整体摘除；
   wordRange 从 wsDeps.rules 传 buildStageInjection；phPoliceTexts 死变量清理。
7. **落树语义不变**：定稿原样落树；模型惯性写出格式栈块第一版只观察不拦，实弹看残留率。

### 4.3 验收（对照 §2 M-A 两拍基线）

1. 回归：424 测试全绿 + 新单测（拆层表分流/句级拆分器/规则摘除/writing_guide/新版装配段/sov 降档）。
2. 两拍实弹（`_obs-ma-2floor.mjs` 同法：同 TGbreak override、同修仙卡、同模型同 high 档）：
   - **思考量塌缩**（主 KPI）：对照 f1=41951 / f2=9567 字；
   - **正文纯度**：格式栈块消失；真正文以 **extractDraftBody 口径**对照（M-A 基线≈500–800 字，
     TGbreak 字数规则内）——不缩水、不注水；
   - **墙钟不劣化**（187.8s / 132.7s 基线）；
   - **writing_guide 调用可见**（activities 帧）——skill 按需机制真被用上，方法论不再出现在
     system/末端（上下文瘦身与调用率同拍可测）；
   - **常驻实测**：装配报告显示 TGbreak 常驻 ≈2.5k 字（TAXONOMY §3 预算），偏差过大要解释；
   - 正文质量人工过目（用户终审，「演得好」不倒退）。
3. 可视化：`.liyuan/preset-assembly.json` 可查每块预设去向（PLAN §5.3）。
4. 实弹后 server 停干净（node server/main.ts 起 7620，跑完杀进程）。

### 4.4 M-C 实施与两拍实测（2026-08-03 晚，未提交）

实施落点：`src/preset-split.ts`（九性质拆层表×3 + 分流引擎 + 兜底）；materials/engine 接线；
`writing_guide(topic)` 读侧第四工具；sov 降档；wordRange 显式注入；planningTag/#revise/
presetPoliceTexts 死链清理；{{random}} 内容寻址钉死（缓存修复顺手完成）；
`.liyuan/preset-assembly.json` 去向报告落盘。回归 **434/434 绿**（424 基线 + 10 新增）。
拆层对账（_split-verify.mts）：TGbreak 常驻 2229 / 双人 3254 / 夏瑾 720——全部命中 TAXONOMY 预算。

两拍实弹（`_obs-ma/2026-08-03T14-12-33-988Z/`，同 TGbreak+修仙卡+deepseek-v4-flash+high）对照 M-A：

| 指标 | M-A f1 | M-C f1 | M-A f2 | M-C f2 |
|---|---|---|---|---|
| 思考 | 41951 | **20357（−51%）** | 9567 | 20073 |
| 墙钟 | 187.8s | **106.5s（−43%）** | 132.7s | 155.4s |
| 落树正文 | 8469 字（58% 格式栈） | **773 字·零标签** | 9412 字 | **838 字·零标签** |
| 真正文（body 口径） | ~500–800 | 738 ✓ | ~800 | 798 ✓ |
| writing_guide | — | 0 次 | — | **1 次（自主调用 general）** |
| 空拍/场记旁路 | 0/0 | 0/0 | 0/0 | 0/0 |

判读：
1. **正文纯度 KPI 完胜**：格式栈（draft_notes/w2g/catsay/UpdateVariable/摘要）从落树正文
   完全消失，字数命中预设区间，双份记账消失。
2. **思考量**：均值 25.8k→20.2k（−22%），**方差塌缩**（41951/9567 的随机抖动 → 20357/20073
   稳定）；**性质质变**——抽样全为读题+设定推理（英文，无正文排练、无格式验算、无禁词纠结）。
   但绝对量未到「几百字级」北极星；f2 单点高于 M-A f2（后者本是随机低点，15 层实弹已证
   同条件 0–37k 抖动，单点不可比）。
3. 剩余思考大头是**剧情推理+设定考证**（模拟器机制/修炼体系对照）——属「读题」的合法部分但
   偏厚。归因候选：模型思考风格（deepseek 英文长思考）/ 卡的系统复杂度 / high 档。
   **留给 M-D 15 层+多模型对照定论，不在 M-C 过度归因。**
4. 已知残留：多稿重交时正文在流上重复外发（M-A 已知 UX 债，wire 替换帧归 M-B）；
   装配报告 residentChars 首版漏计 postHistory 通道（当场已修，两通道合计）。

## 5. M-D：全量验收

15 层实弹（每层 roll 两次）对照 §0 基线全指标复测；49173 字预设 → system 只剩文风摘要的
实测确认；双 KPI 终验。通过后并版发布。

> 2026-08-04 用户澄清 M-D 定位：M-D 的本意是**全盘工具化**（把各板块做成 agent 可调用的工具），
> 对「演得好」影响不大——因此**不能拿 M-D 当思考问题的判据来源**。思考问题的收口在 M-B/M-C2。

## 4.5 M-B 实施与实测（2026-08-04，未提交）

### 4.5.1 落点

- `src/draft.ts`：定位阶梯 `locateEdit`（精确→首尾 trim→中文标点归一，**回报命中级别**，
  优于 Codex 的不回报）；`applyDraftEdits` 批量原子（先全部定位、全绿才落笔，含区间重叠检测）；
  `searchDraft`；失败回显模型自己声称的 old（对标 Codex `lib.rs:790`）；
  `checkDraft` 字数违规给**差值+段均长**；`formatDraftReport` 改指路 draft_edit。
  ⚠ **不变量**：`normalizePunct` 每条规则必须逐字符一对一（不合并、不增删），
  否则 punct 级命中的下标映射回原文会错位（省略号原写 `/[…⋯]+/` 会合并，已修，有测试钉死）。
- `src/stage/tools.ts`：写侧三件 → 六件（+draft_edit/read/search）。
- `src/stage/workspace.ts`：三件执行器 + `ws.edits` 计数；draft_edit **改稿即验**。
- `src/stage/assemble.ts`：「写侧三件」→ 五件，循环描述改「需要就 draft_edit 定点改」。
- `src/state.ts`：**inventory/plot_threads 静默丢数据修复**——非字符串元素进 warnings
  并回显被丢原值 + 说明期望形态（旧实现 filter 掉后 `applied` 仍回报成功，实弹里模型
  为此连试三次、烧 14% 思考）。
- 回归 **445/445 绿**（434 基线 + 11 新增）。

### 4.5.2 实弹（8 有效拍，同卡同预设，greeting 钉死 3）

⚠ **方法论教训**：首轮实弹（`_obs-ma/2026-08-03T17-08-35-901Z`）误用了不同开场白
（`/greeting` 无参会**推进并持久化** greetingIndex，漂到了 4=18 字的公告页），
数据不可比、且当时误报为 −89%/−95%。**此后所有实弹脚本必须用 `/greeting <固定序号>`**
（`_obs-mb-4floor.mjs` 已钉死 3）。

| 分组 | 思考量 |
|---|---|
| **首拍**（n=3，MVU 开） | 7209 / 9272 / **30557**（均值 15679，极差 23348） |
| **非首拍**（n=5，MVU 开） | 10246 / 1867 / 2322 / 4673 / 4631（均值 **4748**） |
| M-C 基线 | 20357 / 20073（均值 20215） |

**结论：非首拍 −77%（20215→4748）；首拍仍高且方差大。**
draft_edit 被自主用上（f2 出现 `查现稿「像是」→ 定点改 1 处 → 验收通过` 的 Grep→Edit 链路）；
全文重交归零（基线 f2 是 882→849→838 三连）。

**反直觉发现**：用了 edit 的拍思考**更少**；「一次过稿」反而是病症（说明已在脑内打磨完）。
故「首次 draft_write 前思考占比」这个指标方向是反的——一次过稿会让它变成 100%，
**已作废，改看绝对量**。同理「正文排练占比」在小分母上会虚高（30557 那拍 v1+v2 仅占 6%）。

### 4.5.3 MVU 冲突（本里程碑最大发现，根因已定位）

某张 MVU 卡的世界书里两条 **constant（每拍必注入）** 条目——
`b9a1d8752948`（uid 82「[mvu_update]变量输出格式」1397 字）与
`3c581bdaf751`（uid 83「📋 MVU变量输出格式强调」，原文「**must be inserted to the end of
reply, and cannot be omitted**」）——要求模型输出 `<UpdateVariable><Analysis>` + JSON Patch。

**这是酒馆 MVU 插件协议；梨园没有该解析器，梨园是 agent 直接调 `world_state_update`。**
于是每拍收到两条互斥强制令（世界书「必须输出」vs draft_write「纯剧情文字」）。三个后果：

1. **首拍 31% 思考**（14% 纠结该听谁 + 17% 手写 JSON Patch）；
2. **正文污染**：`_obs-mb4/…18-27-43-340Z/floor-1` 落树正文带完整 `<UpdateVariable>` 块（英文），
   无任何解析器消费它；
3. **双份记账**：手写 Patch + 调 world_state_update 各一遍。

只在首拍犯——后续拍历史清洗（`addFoldTags`）已把它剥掉，模型看不到自己上拍写过就不再模仿
（harness 事后擦屁股、事前不拦）。

**B 方案验证（已落地）**：两条指纹加进 `liyuan.config.json` 的 `disabledLore`（现 20 条）。
实测（`_obs-mvu/2026-08-03T18-58-28-837Z`，3 拍）：**思考提及 MVU 归零、正文污染归零**（硬证据）；
首拍 7988（回落到原低点区间），30557 尖峰未复现——但**首拍 n=1，不足以断言尖峰消除**。

**A 方案（通解，下一里程碑）**：MVU 是社区最流行变量插件，`UpdateVariable`/`JSONPatch`/
`<Analysis>` 签名易识别——应进拆层器判 **H 类「脑内 harness」退场**（梨园原生机制已覆盖），
且需覆盖**世界书通道**（现拆层只做预设通道）。凡带 MVU 的卡在梨园都会踩此坑。

### 4.5.5 M-C2 A 方案实施（2026-08-04，未提交）

`src/protocol-detect.ts`（新）+ `src/stage/materials.ts` 接线 + `engine.ts` 日志与报告留痕。
命中即置 `enabled = false`——与用户在面板上手关同一机制，constant 注入 / 关键词激活 /
`lorebook_search` 三条通道都尊重 `enabled`，一处置死全线生效。回归 **452/452**（445 + 7 新增）。

**判定纪律**：任一强信号（插件专属标签/命名，如 `<UpdateVariable>`、`[mvu_update]`、
`{{get_message_variable::}}`）或**任意 ≥2 信号共现**。全库实测（10 本世界书 556 条 / 55.5 万字）：
**8 条协议条目全中、正常设定零误伤、灰区为零**（无「沾边未判死」条目）。

**B 方案覆盖率实测只有 24%（推翻 §4.5.3 的「已验证」）**：同一本世界书里
uid80「[mvu_update]变量更新规则」**4865 字**与 uid81「变量列表」63 字**从未被 B 方案覆盖**——
uid80 全文不含 `UpdateVariable` 字样，只有标题的 `[mvu_update]` 能识别。
故 §4.5.3 那组「B 方案实测思考归零、首拍回落 7988」的数据，**是在仍有 4928 字 MVU 每拍在场时测的**。

| 书 | 协议条目 | 退场字数 |
|---|---|---|
| 某张 MVU 卡的世界书 | uid 80/81/82/83 | 6485（B 方案只覆盖 1557） |
| 另一张 MVU 卡的世界书 | uid 227/228/229/230 | 11588（B 方案零覆盖） |
| 合计每拍必进上下文（constant&&enabled） | | **17914 字** |

**不做逐行摘的理由（原型验证）**：对后一本的 uid227/229 逐行摘协议行后**仍剩 63% 且剩的还是协议**
（`Mandatory per-category checklist`／`0.INITIALIZATION`／`11.BEAUTY RANKING` 等跨行 YAML 结构，
行级判据抓不住）。而这些条目里的数值表/境界表在该书**另有专条常驻**（境界 #10 / 具体数值 #17 /
灵根 #18）——整条退场不损失设定。**H 类整体退场的原判成立**。

**实弹（2026-08-04，B 方案指纹已从 config 移除，全靠检测器）**：
上游 500 频发（`500 status code (no body)`，非梨园侧——server 日志无栈），
4 轮共 16 拍只有 **6 拍有正文落树**，数据可比性受限。

| 指标 | 值 |
|---|---|
| 有效拍 n=6 思考均值 | **2562**（范围 1682~3683） |
| 非首拍 n=5 均值 | **2400**（M-B 为 4748、M-C 基线 20215） |
| 首拍 n=1 | 3371（M-B 首拍 7209/9272/30557） |
| **MVU 痕迹（全 16 拍全量扫，含被截断拍）** | **思考 0 次 / 正文 0 次** |

`[stage] 外部插件协议退场：4 条 / 6485 字` 日志确认生效。
⚠ **首拍 n=1，达不到验收要求的 n≥3**——上游 500 稳定后需补跑首拍多样本，
才能断言 30557 那种尖峰真的消除。非首拍 2400 亦因分母小（n=5）且样本跨 500 故障期，**暂记不结论**。

### 4.5.4 M-B 未做项（顺延）

- wire 替换帧（重复上屏已从 2.9x/4.0x 降到约 2.0x，末尾整稿重发仍在）；
- 展示块渲染管道（D-C3 欠账）；
- S4「POV vs 行为边界」预设自相矛盾（`<pov>「描述我的感受和想法」` vs
  `<user_boundary>「❌ 不能写内心想法」`）——**每拍重演 6~8%**，归 M-C2 拆层表，
  故意未混入 M-B 以免污染 KPI 判读；
- `turn_plan`：**证据不支持**——30557 那拍拆开看，34% 是剧情结构设计（合法）、31% 是 MVU、
  正文排练仅 6%。分镜表承接的恰是唯一合法的那部分，可能把「演」变成「填表」。
  用户对表格的直觉可能指向「跨拍留存已裁决事项」（流程冲突/POV 冲突两拍各推一遍）——
  与本拍分镜表是两件事，未展开。

## 6. 风险清单

| 风险 | 缓解 |
|---|---|
| 弱工具能力模型不调 draft_write | D2 宽进严出兜底，永不卡死 |
| 多轮往返墙钟上升 | M-A 验收硬指标；工具结果短小化；必要时首轮提示「一次写完再自检」 |
| toolCall 参数流式各 provider 行为不一 | 先 openai-completions 一条路打通；无参数增量的 provider 降级为整段上屏 |
| packages/ai dist 旧账 | M-A 范围内强制重建+核对（§2.5） |
| 格式栈 M-A 阶段仍在正文里 | 预期内（预设未拆），验收不因此判负；M-B/M-C 分步剥离 |
| 模型不调 writing_guide → 方法论缺席 | 工作循环契约温和提示；实弹观测调用率（activities 可见）；调用率低且正文质量受损才降级为首拍自动注入一次 |
| 8/02 教训复发（steer/泄漏/二象性） | 循环互斥与谢幕判定沿用 M0 骨架的 busy/queue；叶守卫复用 scribe-run；工作区不跨 jiti 边界 |

## 7. 待办总览（2026-08-03 调序：M-C 提前，M-B 后置）

- [x] M-A：workspace.ts + writeTools + #agentLoop 重写 + 流层参数增量 + dist 重建 + 单测 + 两拍实弹（循环形态达成，思考未塌→M-C）
- [x] M-C：拆层表+校验脚本 → 句级拆分器+规则摘除 → 拆层装配+去向报告 → writing_guide(topic) → assemble/engine 接线+sov 降档 → 回归 434 → 两拍实弹对照（§4.3 双 KPI；类型学 docs/PRESET-SPLIT-TAXONOMY.md）
- [x] M-B：draft_edit/read/search + 报告精确化 + inventory 静默丢数据修复 + 445 绿 + 8 拍实弹（§4.5；非首拍 −77%，MVU 冲突根因定位）
- [x] **M-C2（思考问题收口）**：① MVU 通解——`src/protocol-detect.ts` 覆盖世界书/卡内嵌通道，
  452 绿，B 方案指纹已从 config 移除（§4.5.5）；② ~~S4 POV/user_boundary 互斥~~ **撤出范围**
  （2026-08-04 用户定案：预设自相矛盾是预设作者的事，梨园不当保姆）；
  ③ 首拍多样本复验 **未完成**（上游 500 频发，实得首拍 n=1）
- [ ] **M-D（全盘工具化）**：把各板块做成 agent 可调用的工具（用户原意，非思考问题判据）。
  **契约见 `docs/PLAN-RP-TOOLING.md`**（2026-08-04 定稿）——用户定案「三套注册表必须合一」，
  统一工具层取 stage 形状（纯数据 + 注入），M-D1 垂直切片 → 世界书 → 向量库 → 角色库 → 世界线
  - [x] **M-D1 地基 + lorebook_search 垂直切片**（2026-08-04，**464/464 绿**，未提交）：
    `src/tools/{registry,lore}.ts` + `src/tools/adapters/stage.ts` + `server/tool-adapter.ts`；
    台上语料补齐挂载知识库（兑现描述）、助手保留原始世界书（诊断面不剥协议）；
    实弹一拍检索照常。**核实结论：roleplay.ts 不是死代码**（详见 TOOLING §7）
  - [x] **M-D2 世界书族补全**（2026-08-04，**475/475 绿**，未提交）：
    `lorebook_write`/`list`/`toggle` + `src/tools/gate.ts`（写入门禁搬进 src，原门禁已损坏见 M-D6 R3）；
    toggle 复用 `disabledLore` 指纹通道；实弹两拍验证门禁（未要求→零写入；明确要求→落盘补充设定集）
  - [x] **M-D3 向量库族**（2026-08-04，**492/492 绿**，未提交）：
    `src/tools/memory.ts` 四件（`memory_search` 三份实现合一 + `add`/`list`/`delete`），
    助手面首次拥有记忆工具（新增 `StoryBridge.memoryScope()`）。
    **作用域定案**：`MemoryScope` 对模型全隐藏、写侧不给 `store`（narrative 服务层禁写）、
    `store` 只在 list 露；`memory_add` 必须声明「只在当前对话有效」并改道 `lorebook_write`。
    门禁增 `DELETE_REQUEST_RE`（删除认删除信号，两个信号集分开）。
    `memory_import` 按 D-T3 并入 add。实弹拍1 零写入、拍2 落盘；
    **拍3 召回未取得**（上游 `Stream ended without finish_reason`，已用全新会话对照排除本次改动）
- [ ] **路由破口（M-D1 发现）**：`/reroll <带参>` 绕过宿主拦截落到 pi 会话，
  经 `pi.sendUserMessage` 跑一次**无台上装配**的裸 LLM 回合（无预设拆层/无工作区/无验收器）。
  前端「编辑用户消息」即走此路（`web/src/App.tsx:1180`）。修法是宿主改道 StageEngine。
  **用户定案：归入 TOOLING §3 M-D6 统一修复（D 全做完后一并处理），中途不顺手改。**
- [ ] M-B 顺延项：wire 替换帧 + 展示块渲染管道（D-C3 欠账）
- [ ] **状态栏根治法：模型退出格式博弈（2026-08-05 定案，用户指示先记录不做，下个窗口开工）**
  **问题**：模型被拉进「状态栏格式博弈」——提示词要求它按卡格式输出状态栏占位符，
  模型在自闭合 `<X/>` / 成对 `<X>内容</X>` 之间形态漂移，卡的显示正则（自闭合）打空，
  HTML 界面消失。换一张带 HTML 界面的卡 = 换一套格式要求 = 再猜一次（某张 MVU 卡+T Gbreak
  卡了一整天，8/05 实弹：22:12 会话自闭合→面板正常，22:28 会话成对→面板消失）。
  **根因**：正则翻译器（cardSkin/htmlEmbed）一直是梨园代码在消费，正则从不进模型上下文；
  缺的只是**触发点**（占位符）由谁放——酒馆没 agent 循环只能让模型放，梨园有 harness
  不该沿用这个心智模型。
  **方案（三处改动）**：
  1. harness 定稿自动补占位符——cardfront 已检测出自闭合占位符型状态栏，定稿时若正文
     不含则自动追加，正则永远命中；
  2. 提示词删掉「必须输出状态栏」要求（占位符型卡），模型只写正文 + world_state_update 记账；
  3. 验收器不再验占位符型状态栏（harness 的活）。
  效果：模型对格式零认知，换卡零适配；界面数据后续接账本（D-C3）。
  **今日已修的保底**（不因根治搁置而失效）：mergeFinalText 拼回格式尾巴、tailPass 门控、
  前端 draft 替换语义 + wire timeline 优先、提示词分型（占位符 vs 面板）、验收器认自闭合
  （511 绿）。这些让当前形态可用，但不是终点。
- [ ] M-C2 可选：LLM 离线拆层（任意社区预设通解，TAXONOMY §4.1 v1）+ 预设页签去向改判 UI
