# 如何正确读取梨园的思考记录（必读，防止找错位置）

> 血泪教训（2026-08-08）：曾把**下午 17:27/17:29 的旧会话生成**当成「刚刚跑的两次」，
> 把 11k 字英文思考误报为用户当场所见——用户当场否认「最多 1K」。根因：只按文件
> mtime 排序取最新，而旧会话文件会被 model_change 等记录「碰」到最新时间。
> 本文是唯一正确的阅读流程，任何助手要读思考必须先走完下面的定位步骤。

## 0. 会话文件位置

```
~/.liyuan/agent/sessions/<工作区>/*.jsonl
```

每个文件 = 一个会话。文件名 `2026-08-08T11-37-40-681Z_<sessionId>.jsonl` 里
的时间戳是**会话创建时间（UTC）**，不是最后生成时间。

## 1. 定位「用户说的那两次」——绝不能只按 mtime

**错误做法**：`Get-ChildItem | Sort LastWriteTime -Descending | 取前 2`。
旧会话会被 model_change 等系统行碰过 mtime，排到最前面，导致读错会话。

**正确做法**：找到目标会话后，**用每行的顶层 `timestamp` 字段核对生成时刻**：

```python
import io, json
from datetime import datetime, timezone, timedelta
CST = timezone(timedelta(hours=8))
def ts(t):
    return datetime.fromtimestamp(t / 1000, CST).strftime('%m-%d %H:%M:%S') if t else '?'
rows = [json.loads(l) for l in io.open(path, encoding='utf-8') if l.strip()]
for i, r in enumerate(rows):
    m = r.get('message') or {}
    print(i, r.get('type'), m.get('role'), ts(r.get('timestamp')),
          str(r.get('id'))[:14], 'parent=' + str(r.get('parentId'))[:14])
```

关键判据：
- **assistant 行的 `timestamp`（北京时间）必须落在用户说的那个时刻**。
  例如用户说「7 点 35 左右跑了两条」→ assistant 行时间应为 19:35±几分钟，
  差一小时以上（如 17:27）就是找错文件了。
- 顶层 `timestamp` 是 UTC 毫秒；显示时 +8 小时转北京时间。
- 文件名时间戳是 UTC，直接看会差 8 小时，别拿它当生成时间。

## 2. 区分「拍」与「swipe 变体」

同一 `parentId`（= 同一条 user 消息）下的多个 assistant = 同一次输入的不同
swipe，不是多拍。要看「用户跑了哪几次」= 数不同的 user 消息 / 不同 parentId。

## 3. 思考正文在哪：`details.rpTimeline`

- 落树消息的 `content` 里只有**最后一轮**的 thinking（`content[].thinking`），
  不是全拍思考。
- **全拍思考链在 `message.details.rpTimeline`**：数组，每项 `{kind: "thinking"|"tool"|"text", ...}`。
- ⚠ **timeline 的 tool 段字段是 `activities`（数组）**，不是 `activity`——
  读错字段会得到空工具名，误判「模型没调工具」（8/08 犯过）。

```python
tl = (m.get('details') or {}).get('rpTimeline') or []
for s in tl:
    if s.get('kind') == 'thinking':
        print('思考', len(s.get('text') or ''), '字:', (s.get('text') or '')[:60])
    elif s.get('kind') == 'tool':
        for a in s.get('activities') or []:      # 是 activities，不是 activity！
            print('工具', a.get('name'), ':', a.get('detail'))
    elif s.get('kind') == 'text':
        print('正文段', len(s.get('text') or ''), '字')
```

## 4. 读完整时间线的最小脚本

按上面 §3 的字段写一个脚本即可（改脚本里的文件名 → 运行 → 得到「思考→工具→正文段」全链）。

## 5. 汇报时的纪律

1. **先报时间核对**：列出目标 assistant 行的北京时间，与用户说的时刻对齐后才读正文。
2. 汇报里写明是**哪一次**（几点几分、主生成还是 swipe）。
3. 思考长度用「每段」报，不要只报最大段或总和——分段结构本身是评估对象。
4. 若文件时间对不上用户说的时刻，先停下问，不要拿错会话的数据下结论。
