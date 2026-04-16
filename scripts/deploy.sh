#!/usr/bin/env bash
# scripts/deploy.sh – one-shot deployment script for freepieces Cloudflare Worker
#
# Prerequisites (already provisioned if you ran this before):
#   - wrangler installed and authenticated  (wrangler whoami)
#   - KV namespace TOKEN_STORE created      (id in .env as TOKEN_STORE_ID)
#   - Secrets already set via wrangler:
#       TOKEN_ENCRYPTION_KEY  – 32-byte AES-GCM key  (openssl rand -hex 32)
#       Per-piece OAuth secrets, e.g. GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET
#
# Usage:
#   ./scripts/deploy.sh                   # build + deploy
#   ./scripts/deploy.sh --rotate-key      # regenerate TOKEN_ENCRYPTION_KEY and deploy
#   ./scripts/deploy.sh --dry-run         # local type-check + build only, no Cloudflare changes

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

die() {
  echo "Error: $*" >&2
  exit 1
}

# Load environment variables from .env (gitignored)
ENV_FILE="$ROOT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -o allexport && source "$ENV_FILE" && set +o allexport
else
  die ".env file not found at $ENV_FILE. Copy .env.example to .env and fill in the values."
fi

PUBLIC_URL="${FREEPIECES_PUBLIC_URL:?FREEPIECES_PUBLIC_URL not set in .env}"
KV_BINDING="TOKEN_STORE"
KV_NAMESPACE_ID="${TOKEN_STORE_ID:?TOKEN_STORE_ID not set in .env}"
AUTH_KV_BINDING="AUTH_STORE"
AUTH_KV_NAMESPACE_ID="${AUTH_STORE_ID:?AUTH_STORE_ID not set in .env}"

if [[ ! "$KV_NAMESPACE_ID" =~ ^[0-9a-fA-F]{32}$ ]]; then
  die "TOKEN_STORE_ID in .env must be a real 32-character KV namespace ID. Current value: $KV_NAMESPACE_ID"
fi

if [[ ! "$AUTH_KV_NAMESPACE_ID" =~ ^[0-9a-fA-F]{32}$ ]]; then
  die "AUTH_STORE_ID in .env must be a real 32-character KV namespace ID. Current value: $AUTH_KV_NAMESPACE_ID"
fi

if [[ ! "$PUBLIC_URL" =~ ^https?:// ]]; then
  die "FREEPIECES_PUBLIC_URL in .env must start with http:// or https://. Current value: $PUBLIC_URL"
fi

if [[ "$PUBLIC_URL" == *"<"* || "$PUBLIC_URL" == *">"* || "$PUBLIC_URL" == *'${'* ]]; then
  die "FREEPIECES_PUBLIC_URL in .env still looks like a placeholder. Set it to your real deployed base URL before running deploy."
fi

# ── Generate wrangler.toml from template + .env ──────────────────────────────
TMPL="$ROOT_DIR/wrangler.toml.tmpl"
OUTPUT="$ROOT_DIR/wrangler.toml"
node --input-type=module - "$TMPL" "$OUTPUT" <<'NODE'
import fs from 'node:fs';

const [templatePath, outputPath] = process.argv.slice(2);
const template = fs.readFileSync(templatePath, 'utf8');
const missing = new Set();

const rendered = template.replace(/\$\{([A-Z0-9_]+)\}/g, (match, key) => {
  const value = process.env[key];
  if (typeof value !== 'string') {
    missing.add(key);
    return match;
  }

  return value;
});

if (missing.size > 0) {
  console.error(`Error: Missing environment values for wrangler template: ${Array.from(missing).join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(outputPath, rendered);
NODE
echo "==> Generated wrangler.toml from template."

WORKER_NAME="freepieces"

ROTATE_KEY=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --rotate-key)  ROTATE_KEY=true  ;;
    --dry-run)     DRY_RUN=true     ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: $0 [--rotate-key] [--dry-run]"
      exit 1
      ;;
  esac
done

if [[ "$ROTATE_KEY" == "true" && "$DRY_RUN" == "true" ]]; then
  die "--rotate-key and --dry-run cannot be used together."
fi

if [[ "$DRY_RUN" != "true" ]]; then
  echo "==> Checking wrangler authentication..."
  wrangler whoami

  # ── Optional: rotate encryption key ─────────────────────────────────────────
  if [[ "$ROTATE_KEY" == "true" ]]; then
    echo "==> Rotating TOKEN_ENCRYPTION_KEY..."
    openssl rand -hex 32 | wrangler secret put TOKEN_ENCRYPTION_KEY
    echo "    ⚠️  Existing encrypted tokens in KV will be unreadable after key rotation."
  fi

  # ── Ensure admin & auth secrets are configured ───────────────────────────
  if [[ -n "${ADMIN_EMAILS:-}" ]]; then
    echo "==> Setting ADMIN_EMAILS from .env..."
    echo "$ADMIN_EMAILS" | wrangler secret put ADMIN_EMAILS
    echo "    ADMIN_EMAILS set."
  else
    echo "⚠️  ADMIN_EMAILS not set in .env"
    echo "    Set it (comma-separated emails) and re-run, or use: wrangler secret put ADMIN_EMAILS"
  fi

  if [[ -n "${ALLOWED_EMAILS:-}" ]]; then
    echo "==> Setting ALLOWED_EMAILS from .env..."
    echo "$ALLOWED_EMAILS" | wrangler secret put ALLOWED_EMAILS
    echo "    ALLOWED_EMAILS set."
  fi

  # ── Optional: OpenAuth social login provider credentials ────────────────
  for var in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET; do
    if [[ -n "${!var:-}" ]]; then
      echo "==> Setting $var from .env..."
      echo "${!var}" | wrangler secret put "$var"
    fi
  done

  # ── Ensure KV namespaces exist ─────────────────────────────────────────
  echo "==> Verifying KV namespace $KV_NAMESPACE_ID (TOKEN_STORE) exists..."
  if ! wrangler kv namespace list 2>/dev/null | grep -q "$KV_NAMESPACE_ID"; then
    echo "    KV namespace $KV_NAMESPACE_ID not found – creating..."
    wrangler kv namespace create "$KV_BINDING"
    echo "    Update TOKEN_STORE_ID in .env with the new namespace ID, then re-run npm run deploy."
    exit 1
  fi
  echo "    TOKEN_STORE KV namespace OK."

  echo "==> Verifying KV namespace $AUTH_KV_NAMESPACE_ID (AUTH_STORE) exists..."
  if ! wrangler kv namespace list 2>/dev/null | grep -q "$AUTH_KV_NAMESPACE_ID"; then
    echo "    KV namespace $AUTH_KV_NAMESPACE_ID not found – creating..."
    wrangler kv namespace create "$AUTH_KV_BINDING"
    echo "    Update AUTH_STORE_ID in .env with the new namespace ID, then re-run npm run deploy."
    exit 1
  fi
  echo "    AUTH_STORE KV namespace OK."
else
  echo "==> Dry run mode: skipping Wrangler auth, secret updates, KV checks, and deploy."
fi

# ── Type-check ───────────────────────────────────────────────────────────────
echo "==> Running TypeScript type check..."
npm run check

# ── Build ────────────────────────────────────────────────────────────────────
echo "==> Building project..."
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
echo "    Auth       : $PUBLIC_URL/oa"
echo ""
echo "To update admin emails:        wrangler secret put ADMIN_EMAILS"
echo "To add allowed users:          wrangler secret put ALLOWED_EMAILS"
echo "To add Google social login:    wrangler secret put GOOGLE_CLIENT_ID && wrangler secret put GOOGLE_CLIENT_SECRET"
echo "To add GitHub social login:    wrangler secret put GITHUB_CLIENT_ID && wrangler secret put GITHUB_CLIENT_SECRET"
echo "To update piece OAuth creds:   wrangler secret put <PIECE>_CLIENT_ID && wrangler secret put <PIECE>_CLIENT_SECRET"
echo "To rotate the encryption key:  ./scripts/deploy.sh --rotate-key"
