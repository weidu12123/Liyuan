# PLAN-DIRECTOR-NOTE：导演备注（动态提示词槽位·第一步）

> 2026-10-16 立。用户定案：「不是新增一个输入框的问题，是提示词，需要有一个新的动态的临时的变量影响下一次的输出或者影响重roll。」
> 本步只针对**扮演模式**（第一步、第二步都针对扮演）。执行顺序遵守 [[feedback-cli-before-frontend]]：**先引擎＋CLI 验收，再 Web 前端**。

---

## 〇、本质

戏内历史只允许存在两样东西：{{user}} 的言行、{{char}} 的言行。用户偶尔需要当导演（安排剧情走向、给当拍演出提要求），这份指示必须是**瞬时变量**——影响它被消费的那一次生成，用完即焚；不落树、不进历史、不进任何沉淀物。

## 一、现状（落点）

| 环节 | 现状 | 位置 |
|---|---|---|
| 每拍装配 | `buildStageInjection` 产出【】块串 → 与用户原话拼成**同一条 user 消息**（注入在前、原话最后） | `src/stage/assemble.ts:470`、`src/stage/engine.ts:1013` |
| 落树 | 树上只有用户原话（注入是装配期虚拟物；pi 在 message_end 落树） | `engine.ts:838-843` |
| 重 roll | 叶钉回 user → `stage.regenerate()` → 在 user 下挂新 assistant 变体 | `server/main.ts:1108`、`engine.ts:744` |
| 入口 | CLI 与 Web 同源：`handlePrompt`（CLI 主循环也走它） | `server/main.ts:3057`、`3905` |

## 二、方案：导演备注（`directorNote`）

**数据**：一个字符串。宿主暂存 `pendingDirectorNote`（`server/main.ts`，不落盘、不进树）→ 随调用传参进引擎（参数化而非引擎状态；排队拍随行）。

**装配**：`StageInjectionOptions` 加可选 `directorNote`；有值时在注入块**末尾**（紧贴用户原话之前）发射：

```
【导演备注】
让她傲娇一点，别急着答应
```

无值时**不发射**——没有备注的任何一拍，送模文案与既有逐字相同。**不加「消息流约定」新行**（标签自明，先实测；模型误读则记录再议，不顺手加句——铁律一）。

**生命周期**（一条规则）：`/note <文本>` 武装 → 待生效 → 被**下一拍扮演生成**消费即焚（普通发送／重 roll／swipe 末条 next 的再生成都算）；`/note` 无参清除；再武装覆盖；非扮演轮不消费（工作轮发东西不会吃掉它）；切会话/新建会话清空。

**不入物清单**：会话树（只有原话）／场记（`engine.ts:1278` 只传 `lastUserText`）／向量记忆／压缩摘要／世界状态／预设宏 `{{lastusermessage}}`／绿灯扫描与被动召回（都用 `lastUserText`）。

**入口**：`handlePrompt` 拦截 `/note`（与 `/reroll`、`/compact` 同一套宿主拦截），并进 `src/commands.ts` 的 RP_COMMANDS（输入框补全用）。回执三条：`导演备注已就位，将影响下一拍：{note}`／`已清除导演备注`／agent 模式拒绝：`导演备注仅扮演模式可用`。

**引擎签名**：

```ts
performTurn(userText: string, directorNote?: string)   // engine.ts:734
regenerate(directorNote?: string)                      // engine.ts:744
```

## 三、刀切分与验收

### 刀 1（引擎＋CLI）

- 改：`assemble.ts`（选项＋块）、`engine.ts`（签名 4 处＋队列）、`main.ts`（暂存＋`/note`＋3 个消费点＋切会话清空）、`commands.ts`、i18n 三条。
- 单测：`stage-assemble`（有备注→末块且其余逐字一致；空白/无备注→不出块）；`stage-engine`（送模含备注且树不含；一次性；regenerate 路径同）。
- 实弹（隔离实例 `--cli`＋捕获代理录请求）：① `/note X` → 发一拍 → 请求末条 user 消息含【导演备注】；② 会话文件里只有原话；③ 不武装的下一拍请求里没有该块；④ `/note X` → `/reroll` → 同样成立。
- 全量 `npm test`＋i18n-check。

### 刀 2（Web，2026-10-16 落地，用户当拍改形）

用户定的形态（取代初版「待生效小签＋带备注重 roll 菜单项」）：

- **命名**：前端一律叫**「备注」**（提示词里的标签保持【导演备注】——已实弹验证，不动）。
- **输入**：composer 工具行加「备注」按钮，**点一下加一行**（可多条、每条可删）；备注行占输入卡整行、排在正文框上方。
- **随行**：发送 / 重 roll（气泡「生成」）/ 改写后重 roll 时，前端先发一个 `/note`（多条＝命令内多行）再发动作；命令（/rewind 等）与 agent/工作轮不带走备注。
- **显示**：备注随这一拍生成出的**回复**记一份**只作显示**的记录（`details.rpNotes`，与 rpChoices 同一条 details 通道）——模型看不见、不进装配/历史；前端渲染成用户气泡下的备注小气泡（虚线描边），**刷新仍在、切变体时跟着变**（记录挂在变体上）。

- 前端零新协议——复用同一条 `/note` 通道。真浏览器验收通过。

## 四、铁律自检

- **律一**：无备注时送模逐字不变；有备注时增加的是**用户自己的话**＋一个梨园自发标签（与【世界状态】同类）。不加「消息流约定」新行。
- **律二**：不新增注入点/时机/种类——走既有末端注入、既有装配时机；内容主人是用户（与用户原话同主）。
- **律三**：零正则零名单——不做「输入里有没有 OOC 标记」的识别；旧 `isBackstageText` 不动；标签是梨园自己发行的协议。
- **律四三问**：全集＝任何卡任何扮演会话的「戏外指导当拍」需求；负责人＝末端注入（每拍动态内容的唯一装配器）＋生成入口（唯一开拍通道）；没见过的卡＝备注与卡内容零交互（不进历史清洗/作者正则/皮肤）。

## 五、实弹观察项（先记录，不预防性加句）

- 模型可能回客服腔（回应备注而非演出）或把备注当戏内台词——观察项；若出现，不许顺手加句（律一），先记录再议。
- 前缀缓存：备注在装配末端，不动 system 与历史前缀，不破缓存。

## 六、状态

- 2026-10-16：**刀 1 落地（已随 `b5a1b74` 提交）**。
  - 改：`src/stage/assemble.ts`（`directorNote` 选项＋末块）、`src/stage/engine.ts`（`performTurn`/`regenerate`/`#run`/`#turn` 加参＋队列随行）、`server/main.ts`（`pendingDirectorNote` 暂存＋`/note` 拦截＋3 个消费点＋`bindSession` 清空）、`src/commands.ts`（RP_COMMANDS 加 `note`）、`src/i18n/en/server.ts`（3 条）。
  - 单测：`test/stage-assemble.test.ts` 一条（有备注→末块且其余逐字一致；空白/无备注→不出块）；`test/stage-engine.test.ts` 两条（送模含备注且树不含、一次即焚；regenerate 路径同）。全量 858 项 856 过（**2 项既有实卡红**：cardfront-pipeline、mvu）；i18n-check 干净；对触及文件跑了 tsc，无新增诊断（报错全在未动的旧行上）。
  - **CLI 实弹**（隔离实例＋捕获代理→<upstream-proxy>，模型 gemini-3.8-flash-high）：`/note 让她傲娇一点…`→「我推开门，走进茶棚。」→ 抓包末条 user 消息＝【世界状态】…【语言】→**【导演备注】→原话**（位置正确）；`/note 更冷淡一些…`→`/reroll` 同样成立；不武装的下一拍请求无该块（一次即焚）；**会话树 30 条 0 条含「导演备注」**，user 条目只有两句原话；场记旁路（msgs=2）从不带备注。
  - 观察（实弹）：带备注与不带的成品对比，重 roll 那拍明显更冷淡（「声音平得像…」「收起你的铜板」），无客服腔、无角色「听见导演」——观察项未触发。
- 2026-10-16：**刀 2 落地（已随 `b5a1b74` 提交）**。
  - 改：`web/src/App.tsx`（备注按钮＋备注行＋`sendNotes` 接线四处生成动作）、`web/src/components/Messages.tsx`（备注小气泡）、`web/src/app.css`（备注行/气泡样式＋composer-box flex-wrap）、`web/src/i18n/en/app.ts`＋`messages.ts`（6 条）、`src/stage/engine.ts`（落树处记 `details.rpNotes`）、`server/wire.ts`（`WireMsg.notes` 投影）。
  - 单测：`stage-engine` 两条扩断言（回复记 rpNotes、无备注不记；重 roll 变体记自己的备注）；`wire` 一条（投影＋空白/坏值过滤）。全量 859 项 857 过（2 项既有实卡红）；i18n-check 干净；web typecheck 无新增诊断、构建过（dist 已更新）。
  - **真浏览器验收**（隔离实例＋本地假模型 stub，真 Chrome；上游 <upstream-proxy> 当刻网络不通，改走确定性 stub）：备注行 UI 正常 → 发送后**用户气泡下出现备注小气泡**；带备注「生成」重 roll → 气泡变成新备注（挂在变体上）；**刷新后气泡仍在**（树上重放）；无备注的第三拍不新增气泡。抓包：三条生成请求 `【导演备注】` 在场（首拍/重 roll）、第三拍无、场记旁路从无；**会话树 22 条 0 条正文含备注**，user 条只有原话，assistant `rpNotes` = 各自备注。
  - 未做：`swipe next` 末条触发的再生成不带备注（导航与生成同键，不猜；带备注重 roll 走「生成」按钮）。
