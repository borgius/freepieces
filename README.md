# freepieces

> A production-ready, MIT-licensed alternative to `@activepieces/pieces-framework` that runs on **Cloudflare Workers** and supports Activepieces-style community nodes.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why freepieces?

`@activepieces/pieces-framework` is published on npm with a `license: none` metadata field, creating ambiguity for commercial or redistributed projects.  
`freepieces` ships its **own MIT-licensed framework primitives** so you never depend on ambiguously-licensed code.  
Community pieces authored in the Activepieces style can be ported with the included **compatibility shims**.

---

## Architecture

```
src/
├── worker.ts               ← Cloudflare Workers entrypoint (fetch handler)
├── framework/
│   ├── types.ts            ← Core types: Env, PieceDefinition, PieceAction, …
│   ├── piece.ts            ← createPiece() builder
│   ├── registry.ts         ← registerPiece / getPiece / listPieces
│   └── auth.ts             ← URL helpers for login / callback routes
├── lib/
│   ├── crypto.ts           ← AES-GCM encrypt/decrypt (Web Crypto API)
│   ├── token-store.ts      ← KV-backed encrypted token storage
│   └── oauth.ts            ← OAuth2 login URL builder + callback handler
├── compat/
│   └── activepieces.ts     ← Shims: createAction, PieceAuth, Property
├── pieces/
│   ├── example-oauth.ts    ← Example piece using OAuth2 (GitHub)
│   └── example-apikey.ts   ← Example piece using API-key auth
└── client/
    └── script-client.ts    ← Node.js/Deno script client with predefined token
```

---

## Storage model & security

| Data type | Where stored | Notes |
|---|---|---|
| OAuth client ID / secret | **Cloudflare Secret** | `wrangler secret put OAUTH_CLIENT_ID` |
| AES-GCM encryption key | **Cloudflare Secret** | `wrangler secret put TOKEN_ENCRYPTION_KEY` |
| Per-user OAuth tokens | **Cloudflare KV** (encrypted) | Encrypted with AES-256-GCM before write |
| Static credentials (API keys) | **Cloudflare Secret** or runtime env | Never committed to source |

> **Important:** Cloudflare Secrets are deployment-time values. They are **not** a dynamic database.  
> Per-user OAuth tokens acquired at runtime are stored **encrypted** in KV (`TOKEN_STORE`), not as Secrets.

### Encryption

- Algorithm: **AES-256-GCM** via the Web Crypto API (available natively in Workers).
- Key material: 32 random bytes stored as a 64-char hex string in `TOKEN_ENCRYPTION_KEY`.
- Storage format: `<iv_base64url>:<ciphertext_base64url>` — a fresh random IV per write.

### CSRF / state protection

- OAuth state parameter is a signed opaque blob: `<payload_base64url>.<hmac_sha256_base64url>`.
- HMAC key is derived from `TOKEN_ENCRYPTION_KEY`.
- The callback handler rejects any state that fails signature verification.

---

## Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/pieces` | List registered pieces and their actions |
| `GET` | `/auth/login/:piece?userId=<id>` | Start OAuth2 flow (redirects to provider) |
| `GET` | `/auth/callback/:piece` | OAuth2 callback — exchanges code, stores token |
| `POST` | `/run/:piece/:action` | Execute an action (JSON body = props) |

---

## Quick start

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)

### Install

```bash
npm install
```

### Local development

```bash
npm run worker:dev
```

### Type-check

```bash
npm run check
```

### Deploy to Cloudflare Workers

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

---

## Admin UI

The admin console is a React SPA served from `/admin/`.

### First-time setup

Set three Cloudflare Secrets before the first login:

```bash
wrangler secret put ADMIN_USER          # choose any username, e.g. "admin"
wrangler secret put ADMIN_PASSWORD      # choose a strong password
wrangler secret put ADMIN_SIGNING_KEY   # openssl rand -hex 32
```

Then rebuild and redeploy so the SPA is included:

```bash
npm run build:admin
./deploy.sh
```

### Logging in

Open `https://freepieces.example.workers.dev/admin/` in your browser.  
Enter the `ADMIN_USER` and `ADMIN_PASSWORD` values you set above.  
A session cookie (`__fp_admin`) is issued and lasts **24 hours**.

### Local development

Add the same three variables to your `.env` file:

```dotenv
ADMIN_USER=admin
ADMIN_PASSWORD=changeme
ADMIN_SIGNING_KEY=<output of: openssl rand -hex 32>
```

Then start the dev worker:

```bash
npm run worker:dev
```

Open `http://localhost:8787/admin/` and log in with the credentials above.

> **Note:** The SPA is served via the Cloudflare ASSETS binding. During `wrangler dev` the
> assets are read from `dist/public/`, so run `npm run build:admin` at least once before
> starting the dev server if you haven't already.

---

## Using the script client

```bash
# Against the local dev worker
FREEPIECES_URL=http://localhost:8787 \
FREEPIECES_TOKEN=my-secret-token \
node --loader ts-node/esm src/client/script-client.ts
```

---

## Compatibility shims for Activepieces community nodes

```typescript
import {
  createPiece,
  createAction,
  PieceAuth,
  Property
} from './src/compat/activepieces';

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

## License

[MIT](LICENSE) © 2026 Victor Borg
