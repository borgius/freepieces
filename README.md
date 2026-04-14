# freepieces

> Use all 700+ MIT-licensed community pieces from [Activepieces](https://github.com/activepieces/activepieces/tree/main/packages/pieces/community) on Cloudflare Workers — with a clean MIT framework, OAuth2, and a CLI that installs and deploys them in minutes.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/freepieces)](https://www.npmjs.com/package/freepieces)

---

## About

The [Activepieces community](https://github.com/activepieces/activepieces/tree/main/packages/pieces/community) ships **700+ integration pieces** (Gmail, Slack, GitHub, Notion, Stripe, and hundreds more) as individual MIT-licensed npm packages. **freepieces** gives you a lightweight MIT framework and compatibility shim to run them on Cloudflare Workers — along with a CLI to search, install, and deploy them in minutes.

**Use it when you want:**

- All 700+ Activepieces community pieces without licensing blockers
- First-class Cloudflare Workers support (KV, Secrets, Web Crypto)
- A CLI workflow to search, install, and deploy `@activepieces/piece-*` packages
- An admin UI to manage piece credentials and OAuth tokens

---

## Features

- **`fp` CLI** — scaffold a new Worker, search npm for pieces, install and generate wrappers, deploy
- **Piece framework** — `createPiece()` and `createAction()` builders with full TypeScript types
- **OAuth2 + API-key auth** — CSRF-protected OAuth flow, AES-256-GCM encrypted token storage in Cloudflare KV
- **Admin UI** — React SPA for managing pieces, secrets, and OAuth sessions
- **Activepieces compat shims** — drop-in `createAction`, `PieceAuth`, and `Property` wrappers for porting community pieces

---

## Installation

```bash
npm install -g freepieces
# or
npx freepieces init
```

### Requirements

- Node.js ≥ 20
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) — installed automatically if missing

---

## Quick start

```bash
# Scaffold a new Worker project
fp init

# Search for available pieces
fp search gmail

# Install a piece and generate a wrapper
fp install @activepieces/piece-gmail

# Start the local dev worker
npm run worker:dev

# Deploy to Cloudflare
fp deploy
```

---

## CLI reference

| Command | Description |
|---|---|
| `fp` / `fp tui` | Interactive piece selector (TUI) |
| `fp init` | Scaffold a new Worker deployment |
| `fp search [query]` | Search npm for `@activepieces/piece-*` packages |
| `fp install <pkg>` | Install a piece and generate a wrapper stub |
| `fp uninstall [pkg]` | Remove a piece and its wrapper (alias: `fp remove`) |
| `fp config` | Configure Worker secrets interactively |
| `fp deploy` | Build admin SPA and deploy to Cloudflare |

Run `fp --help` or `fp <command> --help` for full options.

---

## Deploy to Cloudflare Workers

```bash
# 1. Set required secrets
wrangler secret put OAUTH_CLIENT_ID
wrangler secret put OAUTH_CLIENT_SECRET
wrangler secret put TOKEN_ENCRYPTION_KEY   # openssl rand -hex 32

# 2. Create the KV namespace
wrangler kv namespace create TOKEN_STORE

# 3. Add the KV namespace ID to wrangler.toml (see comments in the file)

# 4. Deploy
npm run deploy
```

### API routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/pieces` | List registered pieces and actions |
| `GET` | `/auth/login/:piece?userId=<id>` | Start OAuth2 flow |
| `GET` | `/auth/callback/:piece` | OAuth2 callback, stores token |
| `POST` | `/run/:piece/:action` | Execute an action (JSON body = props) |

---

## Admin UI

The admin console is a React SPA served from `/admin/`.

```bash
# Set credentials before first login
wrangler secret put ADMIN_USER          # e.g. "admin"
wrangler secret put ADMIN_PASSWORD      # strong password
wrangler secret put ADMIN_SIGNING_KEY   # openssl rand -hex 32

# Build and deploy
npm run build:admin && ./deploy.sh
```

Then open `https://<your-worker>.workers.dev/admin/` and log in. Sessions last 24 hours.

**Local dev:** add the same three variables to `.env`, run `npm run worker:dev`, and open `http://localhost:8787/admin/`.

> Run `npm run build:admin` at least once before `wrangler dev` — the SPA is served from `dist/public/` via the ASSETS binding.

---

## Security

| Data | Storage | Protection |
|---|---|---|
| OAuth client ID / secret | Cloudflare Secret | Deployment-time value, never in source |
| AES-GCM encryption key | Cloudflare Secret | `openssl rand -hex 32` |
| Per-user OAuth tokens | Cloudflare KV | AES-256-GCM encrypted, fresh random IV per write |
| Static API keys | Cloudflare Secret or runtime env | Never committed |

OAuth state is a signed blob (`<payload>.<hmac-sha256>`). The callback handler rejects any state that fails HMAC verification.

---

## Writing a piece

### Native freepieces API

```typescript
import { createPiece, createAction } from 'freepieces/framework';

export const myPiece = createPiece({
  name: 'my-piece',
  displayName: 'My Piece',
  version: '0.1.0',
  actions: [
    createAction({
      name: 'do-something',
      displayName: 'Do Something',
      props: {},
      async run() {
        return { ok: true };
      }
    })
  ]
});
```

### Porting an Activepieces community piece

```typescript
import {
  createPiece,
  createAction,
  PieceAuth,
  Property
} from 'freepieces/compat/activepieces';

export const myPiece = createPiece({
  name: 'my-piece',
  displayName: 'My Piece',
  version: '0.1.0',
  auth: PieceAuth.OAuth2({
    authorizationUrl: 'https://provider.example/oauth/authorize',
    tokenUrl: 'https://provider.example/oauth/token',
    scope: ['read', 'write']
  }),
  actions: [
    createAction({
      name: 'do-something',
      displayName: 'Do Something',
      props: {
        message: Property.ShortText({ displayName: 'Message', required: true })
      },
      async run({ auth, propsValue }) {
        return { auth, message: propsValue['message'] };
      }
    })
  ]
});
```

---

## Development

```bash
# Install dependencies
pnpm install

# Type-check all targets
npm run check

# Start local dev worker
npm run worker:dev

# Run tests
npm test

# Build everything
npm run build
```

### Project layout

```
src/
├── worker.ts          ← Cloudflare Worker entrypoint
├── framework/         ← createPiece, createAction, registry, auth helpers
├── lib/               ← AES-GCM crypto, KV token store, OAuth2 flow
├── compat/            ← Activepieces shims (createAction, PieceAuth, Property)
├── pieces/            ← Example and bundled pieces
├── client/            ← Script client (Node.js / Deno)
├── admin/             ← React admin SPA
└── cli/               ← fp CLI (commander-based)
```

---

## Contributing

Contributions are welcome. Open an issue to discuss a change before submitting a PR.

```bash
git clone https://github.com/borgius/freepieces.git
cd freepieces
pnpm install
npm test
```

---

## License

[MIT](LICENSE) © 2026 Victor Borg
