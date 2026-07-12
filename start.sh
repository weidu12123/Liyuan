#!/usr/bin/env bash
# Liyuan Agent 1.0 — Linux / macOS launcher
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-7620}"
HOST="${HOST:-0.0.0.0}"

echo ""
echo "  ========================================"
echo "    Liyuan Agent  v1.0"
echo "  ========================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found. Install Node >= 22."
  exit 1
fi

echo "[liyuan] Node $(node -v)"

# First-run defaults (no personal keys)
if [[ ! -f liyuan.config.json && -f liyuan.config.example.json ]]; then
  echo "[liyuan] Creating liyuan.config.json from example ..."
  cp liyuan.config.example.json liyuan.config.json
fi
if [[ ! -f liyuan.agent.json && -f liyuan.agent.example.json ]]; then
  echo "[liyuan] Creating liyuan.agent.json from example ..."
  cp liyuan.agent.example.json liyuan.agent.json
  echo "[liyuan] Edit liyuan.agent.json and set your API key before chatting."
fi

if [[ ! -d node_modules ]]; then
  echo "[liyuan] node_modules missing — running npm install ..."
  echo "[liyuan] First run needs network; later starts are offline-ready."
  npm install
fi

if [[ ! -f web/dist/index.html ]]; then
  echo "[liyuan] Frontend dist missing — running web:build ..."
  npm run web:build
fi

# free port if busy (optional; ignore errors)
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pid}" ]]; then
    echo "[liyuan] Port ${PORT} in use, killing ${pid} ..."
    kill "${pid}" 2>/dev/null || true
    sleep 0.5
  fi
fi

export HOST PORT
echo "[liyuan] Starting http://${HOST}:${PORT}"
echo "[liyuan] Continues last session. New:  ./start.sh --new"
echo "[liyuan] Ctrl+C to stop."
echo ""

exec node server/main.ts "$@"
