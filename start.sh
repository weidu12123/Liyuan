#!/usr/bin/env bash
# Liyuan Agent 1.0.1 - Linux / macOS launcher
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-7620}"
HOST="${HOST:-0.0.0.0}"
OPEN_BROWSER="${OPEN_BROWSER:-1}"
MIN_NODE_MAJOR=22

echo ""
echo "  ========================================"
echo "    Liyuan Agent  v1.0.1"
echo "  ========================================"
echo ""

os_name="$(uname -s 2>/dev/null || echo unknown)"
is_macos=0
if [[ "$os_name" == "Darwin" ]]; then
  is_macos=1
fi

node_install_hint() {
  echo "         Install Node.js >= ${MIN_NODE_MAJOR}:"
  echo "         - https://nodejs.org/  (LTS / Current, pick >= ${MIN_NODE_MAJOR})"
  if [[ "$is_macos" -eq 1 ]]; then
    echo "         - Homebrew:  brew install node@${MIN_NODE_MAJOR}"
    echo "                      brew link --overwrite --force node@${MIN_NODE_MAJOR}"
  else
    echo "         - Linux: use NodeSource / nvm / distro packages for Node ${MIN_NODE_MAJOR}+"
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js not found."
  node_install_hint
  exit 1
fi

NODE_VER="$(node -v 2>/dev/null || true)"
echo "[liyuan] Node ${NODE_VER}"

# Require major version >= MIN_NODE_MAJOR (e.g. v22.x.x)
major="$(echo "${NODE_VER#v}" | cut -d. -f1)"
if ! [[ "$major" =~ ^[0-9]+$ ]] || (( major < MIN_NODE_MAJOR )); then
  echo "[ERROR] Need Node.js >= ${MIN_NODE_MAJOR} (found ${NODE_VER:-unknown})."
  node_install_hint
  exit 1
fi

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
  echo "[liyuan] node_modules missing 鈥?running npm install ..."
  echo "[liyuan] First run needs network; later starts are offline-ready."
  npm install
fi

if [[ ! -f web/dist/index.html ]]; then
  echo "[liyuan] Frontend dist missing 鈥?running web:build ..."
  npm run web:build
fi

# free port if busy (optional; ignore errors)
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
elif command -v lsof >/dev/null 2>&1; then
  pid="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pid}" ]]; then
    echo "[liyuan] Port ${PORT} in use, killing ${pid} ..."
    # shellcheck disable=SC2086
    kill ${pid} 2>/dev/null || true
    sleep 0.5
  fi
fi

export HOST PORT
LOCAL_URL="http://127.0.0.1:${PORT}"
echo "[liyuan] Starting ${LOCAL_URL}  (bind ${HOST}:${PORT})"
echo "[liyuan] Continues last session. New:  ./start.sh --new"
echo "[liyuan] Ctrl+C to stop."
echo ""

# Open browser shortly after server start (macOS open / Linux xdg-open)
if [[ "${OPEN_BROWSER}" != "0" ]]; then
  (
    sleep 2
    if [[ "$is_macos" -eq 1 ]] && command -v open >/dev/null 2>&1; then
      open "${LOCAL_URL}/" 2>/dev/null || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "${LOCAL_URL}/" 2>/dev/null || true
    fi
  ) &
fi

exec node server/main.ts "$@"

