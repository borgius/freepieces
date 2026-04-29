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
- **Admin UI** — React SPA for managing pieces, secrets, connected OAuth users, OAuth sessions, and embedded MDX docs
- **Activepieces compat shims** — drop-in `createAction`, `PieceAuth`, and `Property` wrappers for porting community pieces
- **Bundled Cloudflare pieces** — native D1, R2, Queue, and Workflow actions for Worker bindings

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

## Documentation

- `docs/quick-start.mdx` — bootstrap the repo locally, run a smoke test, and deploy to Cloudflare
- `docs/install.mdx` — detailed reference for the local bootstrap flow
- `docs/auth.mdx` — detailed auth guide covering runtime headers, OAuth storage, admin sessions, and webhook verification
- `scripts/install.sh` — local bootstrap helper for this repository
- `docs/pieces.mdx` — piece architecture, registration, and native vs AP pieces
- `docs/actions.mdx` — action runtime contract and examples
- `docs/cloudflare-bindings.mdx` — bundled D1, R2, Queue, and Workflow pieces
- `docs/triggers.mdx` — webhook subscriptions, callback delivery, and queue delivery
- `docs/pooling.mdx` — polling triggers, with Gmail as the main example

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

# 4. Add the returned namespace ID to .env as TOKEN_STORE_ID
#    and set FREEPIECES_PUBLIC_URL / FREEPIECES_URL there too

# 5. Deploy
npm run deploy
```

`npm run deploy` runs `./scripts/deploy.sh`, which renders `wrangler.toml` from `wrangler.toml.tmpl` and your local `.env` before calling Wrangler.

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
- `X-Piece-Token: <token>` — passes a direct runtime credential for API-key or single-prop `CUSTOM_AUTH` pieces
- `X-Piece-Auth: {"prop":"val",…}` — passes multiple named credentials for multi-prop `CUSTOM_AUTH` pieces; value must be a JSON object where every value is a string

Use `X-User-Id` for OAuth2 pieces such as Gmail. Use `X-Piece-Token` for a single direct credential such as a Slack bot token or API key. Use `X-Piece-Auth` when a `CUSTOM_AUTH` piece requires more than one named credential — for example `{"botToken":"xoxb-…","signingSecret":"…"}`. You may send multiple headers; the worker merges them in order.

In local dev, if `RUN_API_KEY` is not set, the bearer token remains the fallback for both modes. The SDK and examples also send `X-User-Id` / `X-Piece-Token` when available so local and deployed behavior stay aligned.

### Bundled Cloudflare binding pieces

`freepieces` includes native no-auth pieces for Worker-local Cloudflare bindings:

| Piece | Actions | Default binding |
| --- | --- | --- |
| `cloudflare-d1` | `query`, `first`, `execute` | `DB` |
| `cloudflare-r2` | `put_object`, `get_object`, `delete_object`, `list_objects` | `BUCKET` |
| `cloudflare-queue` | `send_message`, `send_batch` | `QUEUE` |
| `cloudflare-workflow` | `create_instance`, `create_batch`, `get_status`, `pause_instance`, `resume_instance`, `terminate_instance`, `restart_instance`, `send_event` | `WORKFLOW` |

Add the relevant bindings to `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "your-database"
database_id = "${D1_DATABASE_ID}"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "your-bucket"

[[queues.producers]]
binding = "QUEUE"
queue = "your-queue"

[[workflows]]
binding = "WORKFLOW"
name = "your-workflow"
class_name = "YourWorkflow"
```

Then call the pieces like any other action:

```bash
curl -X POST "https://<your-worker>.workers.dev/run/cloudflare-d1/query" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "sql": "select * from users where id = ?", "params": ["your-user-id"] }'

curl -X POST "https://<your-worker>.workers.dev/run/cloudflare-r2/put_object" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "key": "notes/hello.txt", "value": "hello", "contentType": "text/plain" }'

curl -X POST "https://<your-worker>.workers.dev/run/cloudflare-queue/send_message" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "body": { "jobId": "job-id" }, "contentType": "json" }'

curl -X POST "https://<your-worker>.workers.dev/run/cloudflare-workflow/create_instance" \
  -H "Authorization: Bearer $RUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "id": "job-id", "params": { "source": "queue" } }'
```

If your Worker uses different binding names, pass `databaseBinding`, `bucketBinding`, `queueBinding`, or `workflowBinding` in the action body.

### Queue delivery for subscriptions

Webhook subscriptions can deliver matched events to a **Cloudflare Queue** instead of an HTTPS callback URL. This keeps event processing inside the Cloudflare network with no public endpoint required on the consumer side.

**1. Create the queue and add a producer binding to `wrangler.toml`:**

```toml
[[queues.producers]]
queue = "slack-new-message"
binding = "QUEUE_SLACK_NEW_MESSAGE"
```

Binding naming convention: `QUEUE_` + queue name in UPPER_SNAKE_CASE (hyphens become underscores).

**2. Create a subscription with `queueName` instead of `callbackUrl`:**

```bash
curl "https://freepieces.example.workers.dev/subscriptions/npm-slack/new_message" \
  -X POST \
  -H "Authorization: Bearer $FREEPIECES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "slack-new-message",
    "propsValue": { "channel": "C0123456789" }
  }'
```

Matched events are sent to the queue as JSON with the same shape as the HTTP delivery payload:

```json
{ "piece": "npm-slack", "trigger": "new_message", "events": [...] }
```

**3. Consume the queue** in a separate Worker (or the same Worker with a `queue()` handler) bound as a consumer.

`callbackUrl` and `queueName` are mutually exclusive — provide exactly one per subscription.

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

Authentication uses [OpenAuth](https://openauth.js.org/) with invite-only registration.

```bash
# Set admin emails (comma-separated)
wrangler secret put ADMIN_EMAILS        # e.g. "admin@example.com,ops@example.com"

# Optional: allow additional non-admin users
wrangler secret put ALLOWED_EMAILS      # e.g. "dev@example.com"

# Optional: enable social login providers
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# Build and deploy
npm run build:admin && ./scripts/deploy.sh
```

Then open `https://<your-worker>.workers.dev/admin/` and sign in with email code, Google, or GitHub.

OAuth-backed pieces also show a foldable **Users** section in the admin UI so you can inspect which stored `userId` values currently have tokens.

**Local dev:** add `ADMIN_EMAILS` to `.env`, run `npm run worker:dev`, and open `http://localhost:9321/admin/`. Verification codes are logged to the console when the EMAIL binding is absent.

The admin UI also includes a **Docs** tab that renders the repository guides directly from `docs/*.mdx`.

> Run `npm run build:admin` at least once before `wrangler dev` — the SPA is served from `dist/public/` via the ASSETS binding.

---

## Security

| Data | Storage | Protection |
| --- | --- | --- |
| Per-piece OAuth client ID / secret | Cloudflare Secret | Deployment-time value, never in source |
| AES-GCM encryption key | Cloudflare Secret | `openssl rand -hex 32` |
| Per-user OAuth tokens | Cloudflare KV | AES-256-GCM encrypted, fresh random IV per write |
| Runtime API key (`RUN_API_KEY`) | Cloudflare Secret | Prefix with `fp_sk_`; authenticates runtime callers |
| Direct piece credentials | Request headers or Cloudflare Secrets | `X-Piece-Token` (single), `X-Piece-Auth` (multi-prop JSON), or per-piece env secret |

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

## Use as a library

`freepieces` can also be consumed as an npm package from another project. This lets you deploy your own Cloudflare Worker with custom pieces without forking this repo.

```bash
npm install freepieces hono
```

### Subpath exports

| Import | What you get |
| --- | --- |
| `freepieces/worker` | `createFreepiecesWorker()` — returns `{ fetch, queue }` |
| `freepieces/framework` | `registerPiece`, `registerApPiece`, `createPiece`, types (`Env`, `PieceDefinition`, `ApPiece`, …) |
| `freepieces/sdk` | TypeScript SDK client (unchanged) |
| `freepieces/admin-assets` | Path to the compiled admin SPA (`dist/public/`) |

### Minimal consumer worker

```ts
// src/worker.ts
import { createFreepiecesWorker } from 'freepieces/worker';
import './pieces/index.js';   // registers your pieces as side effects

export default createFreepiecesWorker();
```

```ts
// src/pieces/index.ts
import { registerApPiece } from 'freepieces/framework';
import type { ApPiece } from 'freepieces/framework';
import airtablePkg from '@activepieces/piece-airtable';

registerApPiece('airtable', (airtablePkg as unknown as { airtable: ApPiece }).airtable);
```

```toml
# wrangler.toml — point [assets] at the package's compiled admin SPA
[assets]
directory = "./node_modules/freepieces/dist/public"
binding = "ASSETS"
```

A working minimal example lives in [`examples/consumer-worker/`](examples/consumer-worker/).

> **Important:** ensure only one copy of `freepieces` is resolved in your project. The piece registry is module-global; if two copies exist the pieces registered before `createFreepiecesWorker()` will be invisible at runtime.

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
