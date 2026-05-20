#!/usr/bin/env bash
# scripts/start-linux.sh — startup helper for systemd / Docker
# Loads .env, builds if needed, then starts the server.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Load .env when present (systemd services don't source it automatically)
if [[ -f .env ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

# Build if the compiled entrypoint is missing
if [[ ! -f dist/linux/linux-server.cjs ]]; then
  echo "[freepieces] dist/linux/linux-server.cjs not found — running build:linux..."
  npm run build:linux
fi

exec node dist/linux/linux-server.cjs
