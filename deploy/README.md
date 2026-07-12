# Liyuan 部署

## 方式 A：一键安装脚本（systemd / 后台进程）

> 仓库若为 **private**：`raw.githubusercontent.com` 不可匿名下载，请先 `git clone` 后本地执行，或用带 token 的 raw URL。

```bash
# 公开仓库时可用：
curl -fsSL https://raw.githubusercontent.com/weidu12123/Liyuan/v1.0.0/deploy/install.sh | bash

# 私有仓库推荐：
git clone --depth 1 --branch v1.0.0 https://github.com/weidu12123/Liyuan.git /opt/liyuan
bash /opt/liyuan/deploy/install.sh --dir /opt/liyuan --port 7620 --ref v1.0.0

# 自定义参数示例
bash deploy/install.sh --dir /opt/liyuan --port 7620 --ref v1.0.0 --service liyuan
```

要求：Linux、root（写 systemd 时）、curl、git、可联网。脚本会尽量安装 Node 22。

装好后：

```bash
# 填 API Key
nano /opt/liyuan/liyuan.agent.json

# 服务管理
systemctl status liyuan
systemctl restart liyuan
```

## 方式 B：Docker Compose

```bash
git clone --depth 1 --branch v1.0.0 https://github.com/weidu12123/Liyuan.git
cd Liyuan
docker compose up -d --build
# 打开 http://服务器IP:7620
```

挂载自定义密钥：

```bash
cp liyuan.agent.example.json liyuan.agent.json
# 编辑 apiKey
# 在 docker-compose.yml 取消 volumes 里 agent/config 挂载注释后
docker compose up -d
```

停止 / 清理：

```bash
docker compose down
# 连数据一起删：
docker compose down -v
```
