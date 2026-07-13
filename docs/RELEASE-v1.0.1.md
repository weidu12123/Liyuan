# Liyuan / 梨园 v1.0.1

1.0.0 后的首个补丁：连接配置真正生效、连接面板好用一点、通知不烦人。

## 下载

| 平台 | 文件 | 怎么开 |
|------|------|--------|
| **Windows** | `Liyuan-1.0.1-windows.zip` | Node ≥ 22 → 解压 → 双击 `start.bat` |
| **Linux** | `Liyuan-1.0.1-linux.zip` | Node ≥ 22 → `chmod +x start.sh && ./start.sh` |
| **macOS** | `Liyuan-1.0.1-macos.zip` | Node ≥ 22 → 解压 → 双击 `start.command` |
| **Docker** | `docker-compose.yml` | `docker compose up -d --build` |

校验：同目录 `SHA256SUMS.txt`。

> 首次启动会 `npm install`（需联网一次），之后可离线。默认 `http://127.0.0.1:7620`

## 本版修复与改进

### 最大回复 tokens 真正可配

- 连接面板可设 **最大回复 tokens**（以及思考档、上下文窗口）
- 改 `liyuan.agent.json` 后：启动 / 打开连接面板 / 保存配置时会同步到运行时 `models.json` 并重绑当前模型
- 自定义 OpenAI 兼容中转默认走 `max_tokens`（多数中转只认这个字段）
- 说明：若上游中转站本身忽略输出上限，客户端无法强制截断；换 DeepSeek 等正常渠道即可验证

### 连接面板前端

- 已选模型清单：思考档 / 上下文 / 最大回复 **分行带标签**，不再挤成一行
- JSON 配置预览可直接改 `maxTokens` / `contextWindow` 等
- 配置仓库对「启用中」配置新增 **刷新**：重传到运行时，不必关了再启用

### 通知气泡

- info / warning / error 均自动消散（约 4s / 6s / 8s），仍可点击立即关闭

### 启动与打包

- macOS：`start.command`；Linux/macOS `start.sh` 加强 Node 版本提示
- 打包脚本支持三端 `windows` / `linux` / `macos`，并生成 `SHA256SUMS.txt`

## 从 1.0.0 升级

解压新包到新目录，或覆盖安装目录后保留你的：

- `liyuan.agent.json` / `liyuan.config.json`
- `.liyuan*` 运行时数据目录

重新 `start` 即可。若改过模型上限，打开一次「连接」面板或点配置 **刷新** 确保同步。

## 要求

- Node.js **≥ 22**
- 任意 OpenAI 兼容 API Key

## 许可证

PolyForm Noncommercial 1.0.0 — 个人/非商业使用。
