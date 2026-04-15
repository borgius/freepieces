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
- **Admin UI** — React SPA for managing pieces, secrets, connected OAuth users, and OAuth sessions
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
| --- | --- |
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
wrangler secret put RUN_API_KEY            # prefix with fp_sk_, e.g. fp_sk_<hex32>
wrangler secret put TOKEN_ENCRYPTION_KEY   # openssl rand -hex 32

# 2. Set piece-specific OAuth secrets for every OAuth piece you enable
wrangler secret put GMAIL_CLIENT_ID
wrangler secret put GMAIL_CLIENT_SECRET
wrangler secret put EXAMPLE_OAUTH_CLIENT_ID
wrangler secret put EXAMPLE_OAUTH_CLIENT_SECRET

# 3. Create the KV namespace
wrangler kv namespace create TOKEN_STORE

# 4. Add the KV namespace ID to wrangler.toml (see comments in the file)

# 5. Deploy
npm run deploy
```

Native and compat OAuth pieces must declare their own `clientIdEnvKey` and `clientSecretEnvKey` values. Direct `registerApPiece()` integrations derive secret names from the piece name, for example `my-piece` → `MY_PIECE_CLIENT_ID` and `MY_PIECE_CLIENT_SECRET`.

### API routes

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Health check |
| `GET` | `/pieces` | List registered pieces and actions |
| `GET` | `/auth/login/:piece?userId=<id>` | Start OAuth2 flow |
| `GET` | `/auth/callback/:piece` | OAuth2 callback, stores token |
| `POST` | `/run/:piece/:action` | Execute an action (JSON body = props) |
| `POST` | `/trigger/:piece/:trigger` | Execute a trigger filter for an inbound payload |
| `POST` | `/subscriptions/:piece/:trigger` | Register a webhook subscription |
| `GET` | `/subscriptions/:piece` | List subscriptions for the current runtime identity |
| `DELETE` | `/subscriptions/:piece/:trigger/:id` | Delete a subscription for the current runtime identity |

### Runtime auth contract

If `RUN_API_KEY` is configured on the worker, runtime endpoints use a split contract:

- `Authorization: Bearer <RUN_API_KEY>` — authenticates the caller
- `X-User-Id: <userId>` — identifies which stored OAuth2 token to read from KV
- `X-Piece-Token: <token>` — passes a direct runtime credential for API-key or `CUSTOM_AUTH` pieces

Use `X-User-Id` for OAuth2 pieces such as Gmail. Use `X-Piece-Token` for direct credentials such as Slack bot tokens or raw API keys. You may send both headers; the worker uses the one that matches the piece auth flow.

In local dev, if `RUN_API_KEY` is not set, the bearer token remains the fallback for both modes. The SDK and examples also send `X-User-Id` / `X-Piece-Token` when available so local and deployed behavior stay aligned.

### SDK usage

```ts
import { createClient } from 'freepieces/sdk';

const client = createClient({
  baseUrl: 'https://freepieces.example.workers.dev',
  token: process.env.RUN_API_KEY,      // fp_sk_<hex32>
  userId: 'alice@example.com',         // KV lookup key for OAuth2 pieces
  pieceToken: 'xoxb-...',              // optional direct credential for API-key/CUSTOM_AUTH pieces
});
```

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

OAuth-backed pieces also show a foldable **Users** section in the admin UI so you can inspect which stored `userId` values currently have tokens.

**Local dev:** add the same three variables to `.env`, run `npm run worker:dev`, and open `http://localhost:8787/admin/`.

> Run `npm run build:admin` at least once before `wrangler dev` — the SPA is served from `dist/public/` via the ASSETS binding.

---

## Security

| Data | Storage | Protection |
| --- | --- | --- |
| Per-piece OAuth client ID / secret | Cloudflare Secret | Deployment-time value, never in source |
| AES-GCM encryption key | Cloudflare Secret | `openssl rand -hex 32` |
| Per-user OAuth tokens | Cloudflare KV | AES-256-GCM encrypted, fresh random IV per write |
| Runtime API key (`RUN_API_KEY`) | Cloudflare Secret | Prefix with `fp_sk_`; authenticates runtime callers |
| Direct piece credentials | Request headers or Cloudflare Secrets | `X-Piece-Token` at runtime, or per-piece env secret |

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
  auth: {
    type: 'oauth2',
    authorizationUrl: 'https://provider.example/oauth/authorize',
    tokenUrl: 'https://provider.example/oauth/token',
    scopes: ['read', 'write'],
    clientIdEnvKey: 'MY_PIECE_CLIENT_ID',
    clientSecretEnvKey: 'MY_PIECE_CLIENT_SECRET',
  },
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

Native freepieces OAuth pieces do not share one global OAuth client credential pair. Each piece names its own secrets explicitly.

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
    scope: ['read', 'write'],
    clientIdEnvKey: 'MY_PIECE_CLIENT_ID',
    clientSecretEnvKey: 'MY_PIECE_CLIENT_SECRET',
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

Compat OAuth pieces should name their secrets explicitly too. Only direct `registerApPiece()` integrations derive `MY_PIECE_CLIENT_ID` / `MY_PIECE_CLIENT_SECRET` automatically from the piece name.

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

```text
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

### Change checklist

For every new feature or behavior change, update every affected surface in the same PR:

- Worker runtime contract (`src/worker.ts` and any shared auth helpers)
- SDK types/client/examples when the caller contract changes
- CLI scaffolding/config/help text when new secrets, flags, or env vars are introduced
- README and examples when user-facing behavior changes
- Tests for the new functionality or changed behavior

Avoid partial backend updates. If a change touches auth, routes, examples, or generated usage, review worker, SDK, CLI, and docs together before you call it done.

```bash
git clone https://github.com/borgius/freepieces.git
cd freepieces
pnpm install
npm test
```

---

## License

[MIT](LICENSE) © 2026 Victor Borg
