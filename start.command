#!/bin/bash
# Liyuan Agent — macOS Finder double-click launcher
# Opens Terminal, runs start.sh in this folder.
cd "$(dirname "$0")" || exit 1
chmod +x ./start.sh 2>/dev/null || true
exec ./start.sh "$@"
