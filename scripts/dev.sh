#!/bin/bash
# Start wrangler dev (Worker + API) and Vite admin (SPA + HMR) together.
# Ctrl-C stops both processes.
set -e

cleanup() {
  kill "$WRANGLER_PID" 2>/dev/null || true
  wait "$WRANGLER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wrangler dev --port 9321 &
WRANGLER_PID=$!

vite --config vite.config.admin.ts
