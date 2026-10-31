# 梨园 · 内测说明（群内测试用）

感谢试玩。这是 **Agent 向角色扮演 Web 客户端**（ST 数据可导入，不接 ST 卡自带前端引擎）。

## 环境

- **Node.js ≥ 22**
- 任意 OpenAI 兼容 API Key（如 DeepSeek）

## 安装

```bash
git clone <本仓库 URL>
cd Liyuan   # 或仓库根目录若只有这一层
cp liyuan.agent.example.json liyuan.agent.json
cp liyuan.config.example.json liyuan.config.json
# 编辑 liyuan.agent.json，填入 apiKey / 模型 id
npm install
npm run web:build   # 若已有 web/dist 可跳过
npm run web
# Windows 也可双击 start.bat
```

浏览器打开控制台打印的地址（默认 `http://127.0.0.1:7620`）。

**请勿把带 Key 的 `liyuan.agent.json` 提交或发群文件。**

## 建议试用

1. 连接面板：配好模型，确认「已连接」
2. 角色卡：导入自己的 ST 卡（PNG/JSON），点卡进对话
3. 世界书：可多本勾选挂载；点书名只浏览该本
4. 用户身份：切换应接近即时（热更新）
5. 对话：正常 RP；需要界面时 agent 可用 `show_html`（也可在正文用 \`\`\`html 块）
6. 侧栏面板 / 存档 / 世界线：按需点点

## 已知边界（预期内）

- **不**运行角色卡自带正则/独立 HTML 前端（ST 专用玩法）
- 卡内 `extensions` 大段脚本默认不进 prompt；文件仍完整在磁盘
- 公网裸奔有风险：内测建议本机或内网；VPS 请自行反代+鉴权
- 无完整账号体系 / 多用户

## 反馈请带

- 系统：Windows / macOS / Linux + Node 版本  
- 复现步骤  
- 控制台 / `_web-err.log` 相关片段（**打码 Key**）  
- 期望 vs 实际  

## 版本

内测版，接口与配置可能变动。请从本仓库拉取更新，勿依赖未备份的会话数据当唯一存档。
