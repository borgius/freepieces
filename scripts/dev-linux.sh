#!/bin/sh
# scripts/dev-linux.sh — hot-reload dev server for Linux/Docker
# Runs esbuild in watch mode and restarts Node when the bundle changes.

# Kill all child processes (esbuild watcher) when this shell exits
trap 'kill 0' EXIT

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Load .env when present
if [ -f .env ]; then
  set -o allexport
  # shellcheck disable=SC1091
  . .env
  set +o allexport
fi

echo "[freepieces] Starting esbuild watcher..."
./node_modules/.bin/esbuild src/linux-server.ts \
  --bundle --platform=node --target=node22 --format=cjs \
  --outfile=dist/linux/linux-server.cjs \
  --external:cloudflare:* \
  --watch=forever &

# Give esbuild time to complete the initial build (~85 ms in practice)
sleep 1

echo "[freepieces] Starting server (node --watch)..."
exec node --watch dist/linux/linux-server.cjs
