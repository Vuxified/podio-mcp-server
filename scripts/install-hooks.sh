#!/usr/bin/env bash
set -euo pipefail

HOOK_SRC="$(dirname "$0")/pre-commit"
HOOK_DST=".git/hooks/pre-commit"

if [ ! -f "$HOOK_SRC" ]; then
  echo "[setup] ERROR: scripts/pre-commit not found"
  exit 1
fi

cp "$HOOK_SRC" "$HOOK_DST"
chmod +x "$HOOK_DST"
echo "[setup] Git hooks installed"
