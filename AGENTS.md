# AGENTS.md — 梨园项目助手须知

本文件是任何 AI 助手（Claude Code / opencode / 其他）进入本仓库的**第一读**。

## 铁律

1. **禁止直接动手改代码**，除非用户明确说「开始/动手」。
   用户会说「先同步情况」「你来告诉我」「只读」——那期间只能读、不能改。
2. **读思考记录必须先读** `docs/READING-THINKING.md`——按文件 mtime 找最新会话
   会读错位置（旧会话被 model_change 碰过 mtime 会排到前面）。必须用行级
   timestamp 核对北京时间。
3. **流程与提示词的最终形态**定义在 `docs/PLAN-ROUND-FLOW.md`——任何提示词/
   引擎改动都要回答「离这个流程近了多少」。
4. 预设的处理是四步管线（导入原样 → 装载拨开关保存 → 引擎按开关编译 → 梨园声明/过目/分流成逐块
   `（预设）` 条目），条目来源标注（`（预设）` / `（世界书·书名）`）与来源书卸载跟随见
   `docs/PLAN-PRESET-HARNESS-STRIP.md` 状态末条。工坊功能通道（`/api/card/authoring`）不动。
   `docs/PLAN-RP-AGENT-EXEC.md` 与 `docs/PRESET-SPLIT-TAXONOMY.md` 保留为历史计划与研究资料。

## 快速索引

- `docs/CARD-AUTHORING-SLICE1.md` — 写卡第一切片的实际能力、验证与下一步边界
- `docs/PLAN-SANDBOX.md` — 沙箱：原生文件工具以卡目录为界、卡外走选择卡申请（`src/sandbox.ts`）
- `docs/PLAN-ROUND-FLOW.md` — 分轮演出流程（最终形态 + 落地记录）
- `docs/READING-THINKING.md` — 读思考记录的**正确方法**（先读这个再碰会话文件）
- `src/stage/` — 台上引擎（assemble 提示词 / engine 回合循环 / workspace 稿纸 /
  tools 工具 schema）
- 测试：`node --test test/*.test.ts`（2026-09-12 最近验证：800 项，796 通过，4 项既有实卡环境失败）
