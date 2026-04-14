#!/usr/bin/env bash
# deploy.sh – one-shot deployment script for freepieces Cloudflare Worker
#
# Prerequisites (already provisioned if you ran this before):
#   - wrangler installed and authenticated  (wrangler whoami)
#   - KV namespace TOKEN_STORE created      (id in wrangler.toml)
#   - Secrets already set via wrangler:
#       TOKEN_ENCRYPTION_KEY  – 32-byte AES-GCM key  (openssl rand -hex 32)
#       OAUTH_CLIENT_ID       – GitHub / provider OAuth app client ID
#       OAUTH_CLIENT_SECRET   – GitHub / provider OAuth app client secret
#
# Usage:
#   ./deploy.sh                   # build + deploy
#   ./deploy.sh --rotate-key      # regenerate TOKEN_ENCRYPTION_KEY and deploy
#   ./deploy.sh --set-oauth       # (re)set OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET interactively
#   ./deploy.sh --dry-run         # type-check + build only, no deploy

set -euo pipefail

# Load environment variables from .env (gitignored)
ENV_FILE="$(dirname "$0")/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -o allexport && source "$ENV_FILE" && set +o allexport
else
  echo "Error: .env file not found at $ENV_FILE"
  echo "Copy .env.example to .env and fill in the values."
  exit 1
fi

# ── Generate wrangler.toml from template + .env ──────────────────────────────
TMPL="$(dirname "$0")/wrangler.toml.tmpl"
OUTPUT="$(dirname "$0")/wrangler.toml"
if ! command -v envsubst &>/dev/null; then
  echo "Error: 'envsubst' not found. Install gettext: brew install gettext"
  exit 1
fi
envsubst < "$TMPL" > "$OUTPUT"
echo "==> Generated wrangler.toml from template."

WORKER_NAME="freepieces"
PUBLIC_URL="${FREEPIECES_PUBLIC_URL:?FREEPIECES_PUBLIC_URL not set in .env}"
KV_BINDING="TOKEN_STORE"
KV_NAMESPACE_ID="${TOKEN_STORE_ID:?TOKEN_STORE_ID not set in .env}"

ROTATE_KEY=false
SET_OAUTH=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --rotate-key)  ROTATE_KEY=true  ;;
    --set-oauth)   SET_OAUTH=true   ;;
    --dry-run)     DRY_RUN=true     ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: $0 [--rotate-key] [--set-oauth] [--dry-run]"
      exit 1
      ;;
  esac
done

echo "==> Checking wrangler authentication..."
wrangler whoami

# ── Optional: rotate encryption key ─────────────────────────────────────────
if [[ "$ROTATE_KEY" == "true" ]]; then
  echo "==> Rotating TOKEN_ENCRYPTION_KEY..."
  openssl rand -hex 32 | wrangler secret put TOKEN_ENCRYPTION_KEY
  echo "    ⚠️  Existing encrypted tokens in KV will be unreadable after key rotation."
fi

# ── Optional: (re)set OAuth credentials ─────────────────────────────────────
if [[ "$SET_OAUTH" == "true" ]]; then
  echo "==> Setting OAUTH_CLIENT_ID..."
  wrangler secret put OAUTH_CLIENT_ID
  echo "==> Setting OAUTH_CLIENT_SECRET..."
  wrangler secret put OAUTH_CLIENT_SECRET
fi

# ── Ensure admin secrets are configured ─────────────────────────────────────
if [[ -n "${ADMIN_USER:-}" && -n "${ADMIN_PASSWORD:-}" && -n "${ADMIN_SIGNING_KEY:-}" ]]; then
  echo "==> Setting admin credentials from .env..."
  echo "$ADMIN_USER"     | wrangler secret put ADMIN_USER
  echo "$ADMIN_PASSWORD" | wrangler secret put ADMIN_PASSWORD
  echo "$ADMIN_SIGNING_KEY" | wrangler secret put ADMIN_SIGNING_KEY
  echo "    Admin secrets set."
else
  echo "⚠️  ADMIN_USER, ADMIN_PASSWORD, or ADMIN_SIGNING_KEY not set in .env"
  echo "    Set them and re-run, or use: wrangler secret put ADMIN_USER / ADMIN_PASSWORD / ADMIN_SIGNING_KEY"
fi

# ── Ensure KV namespace exists ───────────────────────────────────────────────
echo "==> Verifying KV namespace $KV_NAMESPACE_ID exists..."
if ! wrangler kv namespace list 2>/dev/null | grep -q "$KV_NAMESPACE_ID"; then
  echo "    KV namespace $KV_NAMESPACE_ID not found – creating..."
  wrangler kv namespace create "$KV_BINDING"
  echo "    Update KV_NAMESPACE_ID in this script and wrangler.toml, then re-run."
  exit 1
fi
echo "    KV namespace OK."

# ── Type-check ───────────────────────────────────────────────────────────────
echo "==> Running TypeScript type check..."
npm run check

# ── Build ────────────────────────────────────────────────────────────────────
echo "==> Building admin UI..."
npm run build:admin

echo "==> Building worker..."
npm run build

if [[ "$DRY_RUN" == "true" ]]; then
  echo "==> Dry run complete — skipping deploy."
  exit 0
fi

# ── Deploy ───────────────────────────────────────────────────────────────────
echo "==> Deploying $WORKER_NAME to Cloudflare Workers..."
wrangler deploy

echo ""
echo "✅  Deployment complete!"
echo "    Worker URL : $PUBLIC_URL"
echo "    Health     : $PUBLIC_URL/health"
echo "    Pieces     : $PUBLIC_URL/pieces"
echo "    Admin UI   : $PUBLIC_URL/admin/"
echo ""
echo "To update OAuth credentials run: ./deploy.sh --set-oauth"
echo "To rotate the encryption key run: ./deploy.sh --rotate-key"
