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

首启无需任何手工准备。容器会自己在宿主机建好 `./data/`：

```
data/config/liyuan.config.json   角色卡 / 世界书 / 用户身份（从 example 播种）
data/config/liyuan.agent.json    模型与 API Key（从 example 播种，勿提交仓库）
data/cards/                      导入暂存，含默认「青梧」种子
data/card-spaces/                卡工作空间（会话、账本随卡存放）
data/lorebooks/                  世界书
```

填 Key 有两条路，任选：

```bash
# 路子一：直接在网页的「连接」面板里填，即时生效，不用重启
# 路子二：改文件
nano data/config/liyuan.agent.json
docker compose restart
```

停止 / 清理：

```bash
docker compose down
# 连数据一起删：
docker compose down -v
```

### 报错 "Are you trying to mount a directory onto a file?"

v1.2.0 及更早版本把 `liyuan.config.json` / `liyuan.agent.json` 做了文件级挂载。宿主机上没有这两个文件时，Docker 会建两个**空目录**顶上去，撞上镜像里的同名文件就崩（[issue #1](https://github.com/weidu12123/Liyuan/issues/1)）。v1.2.1 起改成只挂 `data/config` 目录，不会再有这问题。

已经踩上的话，拉新版直接起就行，不用手工删任何东西——entrypoint 会认出那两个空目录、清掉并重新播种：

```bash
git pull
docker compose up -d --build
```

若你之前按旧文档手工填过 `data/config/liyuan.agent.json`（是文件不是目录），它会被原样保留，Key 不丢。

## 方式 C：GHCR 镜像（免构建）

服务器上不装 Node、不在服务器上构建，直接拉预构建镜像（amd64 / arm64）：

```bash
mkdir -p /opt/liyuan && cd /opt/liyuan
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/weidu12123/Liyuan/master/deploy/compose.ghcr.yml
docker compose up -d
# 打开 http://服务器IP:7620
```

数据落在 `./data/`，布局与方式 B 完全一致，两种方式可随时互相切换。更新：

```bash
docker compose pull && docker compose up -d
```

也可直接 `docker pull ghcr.io/weidu12123/liyuan:1.6.1` 指定版本。
