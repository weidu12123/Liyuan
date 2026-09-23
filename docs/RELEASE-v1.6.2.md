# Liyuan Agent 1.6.2

## 新增

### agent 模式

正文与上下文分离，趋近于一般的 coding agent。

| Coding Agent | agent 模式 |
|---|---|
| 项目文件夹（Workspace） | 正文目录 |
| 代码（Code） | 剧情正文 |
| 读文件（Read） | 读正文（read） |
| 代码检索（Grep） | 文本检索（grep） |
| 局部修改（Edit） | 局部改动（edit） |
| 版本回退（Checkpoint） | 检查点 |
| 上下文压缩（Compact） | 讨论压缩 |
| 运行预览（Screenshot） | 正文截图（screenshot） |

## 修复

- 大会话在升级后从会话列表消失（#11）。
- agent 模式下正文直接输出在讨论区，不写入文件。
- agent 模式桌面端分栏比例不可调且无法收起，手机端无法滑动切页。
- agent 模式打开状态面板时遮挡输入栏。
- 打开对话默认停留在消息流顶部而非最新一条。
