# Liyuan Agent 1.0 — production image
# Build: docker build -t liyuan:1.0.0 .
# Run:   docker run -d -p 7620:7620 -v liyuan-data:/app/.liyuan-data-proxy liyuan:1.0.0
FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer cache)
COPY package.json package-lock.json ./
COPY packages ./packages
# file: deps need package manifests present before npm install
RUN npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

# App sources + prebuilt web (if missing, build below)
COPY server ./server
COPY src ./src
COPY assets ./assets
# skills/ 默认已无内置 skill（三档退役后 git rm）；git 不存空目录，clean clone 里没有它，
# 硬 COPY 会挂（CI docker build："/skills": not found）。运行时 /app/skills 由卷提供，
# 用户自建的 skill 落在那里；下面的 mkdir 保证镜像里有个空目录。
# presets/（默认预设）刀1 已删：presets/默认.json 随「无预设＝真的无预设」退役，
# 用户预设住在 assets/presets（随包剔除）。扮演骨架在 assets/SYSTEM.md（上面已 COPY）。
COPY .liyuan/extensions ./.liyuan/extensions
COPY liyuan.config.example.json liyuan.agent.example.json ./
COPY start.sh docker-entrypoint.sh ./
COPY web/dist ./web/dist
COPY web/package.json ./web/package.json

# Fallback: build frontend if dist not in build context
RUN if [ ! -f web/dist/index.html ]; then \
      npm --prefix web install && npm run web:build && rm -rf web/node_modules; \
    fi

# 默认素材备份：assets/cards 与 assets/lorebooks 会被卷挂载遮住，
# entrypoint 首启时从这里补回默认角色卡/世界书
# skills 现无内置项：只建空目录（不备份），entrypoint 的 seed_assets 会跳过缺失的 default/skills
RUN mkdir -p assets/default skills \
  && cp -r assets/cards assets/default/cards \
  && cp -r assets/lorebooks assets/default/lorebooks

# 配置真身放在 /app/config（卷挂载点），/app 下同名文件由 entrypoint 软链过去。
# 不在这里 cp 出 liyuan.*.json：镜像内的真文件会和 compose 的目录挂载冲突（issue #1）。
RUN mkdir -p config \
  && chmod +x start.sh docker-entrypoint.sh

ENV HOST=0.0.0.0
ENV PORT=7620
ENV NODE_ENV=production

EXPOSE 7620

# Persist runtime dirs via anonymous volumes (sessions live under ~/.liyuan/agent by design)
# /app/config 存 liyuan.config.json / liyuan.agent.json（含 API Key），重建镜像不丢
VOLUME ["/root/.liyuan", "/app/config", "/app/.liyuan-state", "/app/.liyuan-uploads", "/app/.liyuan-media", "/app/.liyuan-audio", "/app/.liyuan-artifacts", "/app/.liyuan-codex", "/app/.liyuan-lore", "/app/.liyuan-memory", "/app/.liyuan-skills", "/app/.liyuan-worldline", "/app/.liyuan-cache", "/app/assets/presets", "/app/assets/personas", "/app/liyuan-profiles", "/app/skills", "/app/cards"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7620)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/main.ts"]
