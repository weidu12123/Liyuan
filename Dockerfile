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
COPY .liyuan/extensions ./.liyuan/extensions
COPY liyuan.config.example.json liyuan.agent.example.json ./
COPY start.sh ./
COPY web/dist ./web/dist
COPY web/package.json ./web/package.json

# Fallback: build frontend if dist not in build context
RUN if [ ! -f web/dist/index.html ]; then \
      npm --prefix web install && npm run web:build && rm -rf web/node_modules; \
    fi

# Default configs inside image (override via volume / env mount)
RUN cp liyuan.config.example.json liyuan.config.json \
  && cp liyuan.agent.example.json liyuan.agent.json \
  && chmod +x start.sh

ENV HOST=0.0.0.0
ENV PORT=7620
ENV NODE_ENV=production

EXPOSE 7620

# Persist runtime dirs via anonymous volumes (sessions live under ~/.liyuan/agent by design)
VOLUME ["/root/.liyuan", "/app/.liyuan-state", "/app/.liyuan-uploads", "/app/.liyuan-media", "/app/.liyuan-audio", "/app/.liyuan-artifacts", "/app/.liyuan-codex", "/app/.liyuan-lore"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7620)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/main.ts"]
