#!/usr/bin/env bash
# scripts/install.sh — local bootstrap helper for the freepieces repository

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
REQUIRED_NODE_MAJOR=20
PNPM_VERSION="10.33.0"

RUN_INSTALL=true
RUN_CHECK=false
BUILD_ADMIN=false
OVERWRITE_ENV=false

usage() {
	cat <<'EOF'
Bootstrap the freepieces repository for local development.

Usage:
	bash scripts/install.sh [options]

Options:
	--skip-install   Skip dependency installation
	--check          Run "npm run check" after setup
	--build-admin    Run "npm run build:admin" after setup
	--overwrite-env  Replace the existing .env with local-friendly defaults
	--help           Show this help message

What the script does:
	- verifies Node.js >= 20
	- ensures pnpm is available (via corepack when possible)
	- installs dependencies
	- creates .env from .env.example when needed
	- rewrites a few values for local development:
			FREEPIECES_PUBLIC_URL=http://localhost:8787
			FREEPIECES_URL=http://localhost:8787
			TOKEN_STORE_ID=00000000000000000000000000000000
			RUN_API_KEY commented out by default
			ADMIN_SIGNING_KEY generated automatically

What the script does not do:
	- create a real Cloudflare KV namespace
	- deploy the worker
	- set Cloudflare secrets
EOF
}

log() {
	printf '\n==> %s\n' "$*"
}

warn() {
	printf 'Warning: %s\n' "$*"
}

die() {
	printf 'Error: %s\n' "$*" >&2
	exit 1
}

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

ensure_node() {
	command_exists node || die 'Node.js is required. Install Node.js 20 or newer.'
	local node_major
	node_major="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
	if (( node_major < REQUIRED_NODE_MAJOR )); then
		die "Node.js ${REQUIRED_NODE_MAJOR}+ is required. Found: $(node -v)"
	fi
}

ensure_pnpm() {
	if command_exists pnpm; then
		return
	fi

	command_exists corepack || die 'pnpm is not installed and corepack is unavailable.'

	log "pnpm not found. Activating pnpm@$PNPM_VERSION via corepack"
	corepack enable >/dev/null 2>&1 || true
	corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null 2>&1

	command_exists pnpm || die 'Unable to activate pnpm. Install pnpm manually and re-run the script.'
}

generate_signing_key() {
	if command_exists openssl; then
		openssl rand -hex 32
		return
	fi

	node --input-type=module -e "import crypto from 'node:crypto'; console.log(crypto.randomBytes(32).toString('hex'))"
}

write_env_file() {
	[[ -f "$ENV_EXAMPLE" ]] || die ".env.example not found at $ENV_EXAMPLE"

	cp "$ENV_EXAMPLE" "$ENV_FILE"
	local signing_key
	signing_key="$(generate_signing_key)"

	node --input-type=module - "$ENV_FILE" "$signing_key" <<'NODE'
import fs from 'node:fs';

const [envFile, signingKey] = process.argv.slice(2);
let text = fs.readFileSync(envFile, 'utf8');

const replacements = [
	['FREEPIECES_PUBLIC_URL=https://<your-worker>.workers.dev', 'FREEPIECES_PUBLIC_URL=http://localhost:8787'],
	['TOKEN_STORE_ID=<your-kv-namespace-id>', 'TOKEN_STORE_ID=00000000000000000000000000000000'],
	['RUN_API_KEY=fp_sk_<64-char-hex-string>', '# RUN_API_KEY=fp_sk_your-local-key'],
	['FREEPIECES_URL=https://<your-worker>.workers.dev', 'FREEPIECES_URL=http://localhost:8787'],
	['ADMIN_SIGNING_KEY=<64-char-hex-string>', `ADMIN_SIGNING_KEY=${signingKey}`],
];

for (const [from, to] of replacements) {
	text = text.replace(from, to);
}

fs.writeFileSync(envFile, text);
NODE

	log "Created $ENV_FILE with local-friendly defaults"
	warn 'TOKEN_STORE_ID is a local placeholder. Replace it with a real namespace ID before deployment.'
	warn 'Provider credentials such as Gmail and Slack secrets are still placeholders.'
}

install_dependencies() {
	log 'Installing dependencies'
	(
		cd "$ROOT_DIR"
		pnpm install
	)
}

run_check() {
	log 'Running npm run check'
	(
		cd "$ROOT_DIR"
		npm run check
	)
}

build_admin() {
	log 'Building admin UI'
	(
		cd "$ROOT_DIR"
		npm run build:admin
	)
}

print_next_steps() {
	cat <<EOF

Setup complete.

Next steps:
	1. Review $ENV_FILE and replace any provider placeholders you need.
	2. Start the worker locally:
			 cd "$ROOT_DIR"
			 npm run worker:dev
	3. In another terminal, smoke test the worker:
			 curl http://localhost:8787/health
			 curl -X POST http://localhost:8787/run/example-apikey/ping \
				 -H "Content-Type: application/json" \
				 -H "Authorization: Bearer dev-token" \
				 -d '{"hello":"world"}'
	4. Read docs/install.md and docs/quick-start.md for the full walkthrough.

When you are ready to deploy, create a real KV namespace, set Cloudflare secrets,
update .env with real values, and run ./scripts/deploy.sh.
EOF
}

for arg in "$@"; do
	case "$arg" in
		--skip-install)
			RUN_INSTALL=false
			;;
		--check)
			RUN_CHECK=true
			;;
		--build-admin)
			BUILD_ADMIN=true
			;;
		--overwrite-env)
			OVERWRITE_ENV=true
			;;
		--help)
			usage
			exit 0
			;;
		*)
			usage
			die "Unknown option: $arg"
			;;
	esac
done

ensure_node
ensure_pnpm

if [[ -f "$ENV_FILE" && "$OVERWRITE_ENV" != "true" ]]; then
	log "$ENV_FILE already exists — leaving it unchanged"
else
	write_env_file
fi

if [[ "$RUN_INSTALL" == "true" ]]; then
	install_dependencies
else
	log 'Skipping dependency installation'
fi

if [[ "$RUN_CHECK" == "true" ]]; then
	run_check
fi

if [[ "$BUILD_ADMIN" == "true" ]]; then
	build_admin
fi

print_next_steps
