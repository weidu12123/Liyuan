# Liyuan / 梨园 v1.0.2

双 agent 分治与面板管理补丁：剧情与系统事务拆开，面板坞可删除。

## 下载

| 平台 | 文件 | 怎么开 |
|------|------|--------|
| **Windows** | `Liyuan-1.0.2-windows.zip` | Node ≥ 22 → 解压 → 双击 `start.bat` |
| **Linux** | `Liyuan-1.0.2-linux.zip` | Node ≥ 22 → `chmod +x start.sh && ./start.sh` |
| **macOS** | `Liyuan-1.0.2-macos.zip` | Node ≥ 22 → 解压 → 双击 `start.command` |
| **Docker** | `docker-compose.yml` | `docker compose up -d --build` |

校验：同目录 `SHA256SUMS.txt`。

> 首次启动会 `npm install`（需联网一次），之后可离线。默认 `http://127.0.0.1:7620`

## 本版改进

### 双 agent 分治（助手）

- 中间剧情模型只演戏；系统事务（诊断、改配置、修账本、写面板、沉淀技能等）交给右栏独立「助手」会话
- 输入框发送键右侧耳麦按钮打开助手；主输入框 `//` 开头（或整条括号包裹）会自动转给助手
- 助手可单独指定模型（默认跟随剧情模型）
- `skill_save` 迁至助手，不再打断剧情模型

### 面板坞删除

- 顶栏「面板」列表每行支持删除（二次确认）
- 与 agent `panel_close` 同语义：归档出活跃列表，随世界线可回档

### 其它

- 过程条支持实时步骤与中间旁白
- `.gitignore` 加固：助手运行时目录、本地测试产物、生成素材等不入库

## 从 1.0.1 升级

解压新包到新目录，或覆盖安装目录后保留你的：

- `liyuan.agent.json` / `liyuan.config.json`
- `.liyuan*` 运行时数据目录

重新 `start` 即可。

## 要求

- Node.js **≥ 22**
- 任意 OpenAI 兼容 API Key

## 许可证

PolyForm Noncommercial 1.0.0 — 个人/非商业使用。
