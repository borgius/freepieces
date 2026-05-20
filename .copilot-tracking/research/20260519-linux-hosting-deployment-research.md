<!-- markdownlint-disable-file -->

# Task Research Notes: Linux Hosting Deployment for freepieces

## Research Executed

### File Analysis

- `src/worker/create-worker.ts`
  - Full Hono app factory + `FreepiecesWorker` return type (`.fetch` + `.queue`)
  - Uses `c.executionCtx.waitUntil()` at line 95 (via webhook-api.ts) for async webhook fan-out
  - Uses `MessageBatch<{ pieceName?: string; payload?: unknown }>` in `.queue()` handler (lines 120–138)
  - Uses `ExportedHandler<Env>` satisfies constraint (line 139)
  - Uses `c.env.ASSETS.fetch(...)` for admin SPA serving (lines 102–109)

- `src/framework/types.ts`
  - `Env` interface defines every CF-specific binding type
  - `KVNamespace` × 2: `FREEPIECES_TOKEN_STORE` and `FREEPIECES_AUTH_STORE` (+ `FP_` and legacy aliases)
  - `Queue` binding: `TRIGGER_QUEUE?: Queue` (line 150)
  - `Fetcher` binding: `ASSETS?: Fetcher` (line 153) — serves admin SPA static files
  - Email binding: `FREEPIECES_EMAIL?: { send: (msg: unknown) => Promise<void> }` (line 103)
  - CF Access vars: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD_FREEPIECES`
  - `FREEPIECES_WORKER_NAME` — used only in admin UI command hints, no runtime logic

- `src/lib/token-store.ts`
  - All functions take `KVNamespace` as first param: `storeToken`, `getToken`, `listStoredUserIds`, `deleteToken`
  - KV operations: `kv.put()`, `kv.get()`, `kv.list({prefix, cursor})`, `kv.delete()`
  - `listStoredUserIds()` paginates through KV list pages with cursor

- `src/lib/env.ts`
  - `getKVBinding(env, name)` — duck-types by checking `'get' in (v as object)` (~line 50)
  - `requireKVBinding(env, name)` — throws if not found
  - All string resolution via `getEnvStr` / `requireEnvStr` — pure string helpers, no CF types

- `src/lib/webhook.ts`
  - All subscription CRUD hits `KVNamespace` directly (list, get, put, delete)
  - `dispatchWebhook()` calls `requireKVBinding(env, 'TOKEN_STORE')` (~line 192)
  - Queue delivery: `resolveQueueBinding(env, queueName)` → `queue.send(eventPayload)` (lines 244–251)
  - HTTP callback delivery: `fetch(sub.callbackUrl, ...)` — standard Web fetch, no CF-specific API

- `src/lib/auth-issuer.ts`
  - `WeakMap` keyed on KV binding object reference for isolate-scoped singleton
  - Falls back to `env` itself as key when KV binding absent (already coded: `?? env`)

- `src/auth/issuer.ts`
  - `import { CloudflareStorage } from '@openauthjs/openauth/storage/cloudflare'` (line 18)
  - `storage: CloudflareStorage({ namespace: getKVBinding(env, 'AUTH_STORE') as any })`
  - `sendVerificationEmail()` imported from `./email`

- `src/auth/email.ts`
  - Line 74: `const { EmailMessage } = await import('cloudflare:email')` — CF runtime import
  - Line 75: `new EmailMessage(senderEmail, recipientEmail, rawMessage)` — CF Email Workers API
  - **Already guarded**: falls back to `console.log` when `emailBinding` or `senderEmail` is absent (lines 60–63)
  - Uses `mimetext` (npm package) to build MIME message — cross-platform

- `src/routes/webhook-api.ts`
  - Line 95: `c.executionCtx.waitUntil(dispatchWebhook(...))` — only CF-specific usage in this file
  - All other code: standard `KVNamespace` methods and `fetch()`

- `src/worker/index.ts`
  - Exports `createFreepiecesWorker`, `FreepiecesWorker`, pieces and framework surface

- `wrangler.toml`
  - `[[kv_namespaces]]` × 2 (TOKEN_STORE, AUTH_STORE)
  - `[[send_email]]` binding → `FREEPIECES_EMAIL`
  - `[assets]` directory `./dist/public` with `ASSETS` binding
  - Optional `[[queues.producers]]` entries (commented out)

### Code Search Results

- `Queue|MessageBatch|TRIGGER_QUEUE|waitUntil|executionCtx` — 20 matches
  - `routes/webhook-api.ts:95` — `c.executionCtx.waitUntil(dispatchWebhook(...))` — **only** `waitUntil` usage
  - `worker/create-worker.ts:120` — `.queue(batch: MessageBatch, env: Env)` handler
  - Queue delivery only triggered when `sub.queueName` is set (opt-in per subscription)

- `cloudflare:email|EmailMessage`
  - `src/auth/email.ts:74` — `await import('cloudflare:email')` — only CF dynamic import in codebase

- `ASSETS` binding
  - `src/framework/types.ts:153` — `ASSETS?: Fetcher`
  - `src/worker/create-worker.ts:102–109` — `c.env.ASSETS.fetch(...)` for SPA serving

- `ExportedHandler`
  - `src/worker/create-worker.ts:139` — `satisfies ExportedHandler<Env>` — CF Worker types only

### External Research

- `@hono/node-server` v2.0.3 (latest 2026-05-19, NOT installed)
  - Peer dep: `hono: ^4` (compatible with installed `hono@4.12.14`)
  - Exports: `.` (main `serve()`), `./serve-static`, `./utils/*`, `./conninfo`
  - API: `serve({ fetch: app.fetch, port: 3000 })` wraps Node `http.createServer`
  - `./serve-static` provides `serveStatic()` backed by Node.js `fs`

- `@openauthjs/openauth@0.4.3` storage adapters (verified in dist/esm/storage/):
  - `cloudflare.js` — wraps `KVNamespace.get/put/delete/list` (used today)
  - `memory.js` — in-memory sorted array, optional file persistence (`persist: "./persist.json"`)
  - `aws.js`, `dynamo.js` — DynamoDB variants
  - **No SQLite, Redis, or filesystem adapters** in this version

- `MemoryStorage` API (verified from source):
  - `MemoryStorage({ persist?: string })` — creates adapter
  - Methods: async `get`, `set`, `remove`, async generator `scan*`
  - With `persist`: reads/writes JSON on every mutation (not cluster-safe but adequate for single-process Linux)

- `hono@4.12.14` adapters in dist/adapter/: cloudflare-workers, cloudflare-pages, bun, aws-lambda — **no node** adapter
  - `dist/middleware/serve-static/` — runtime-agnostic base requiring runtime-specific `getContent`+`isDir`
  - Node implementation lives in `@hono/node-server/serve-static` (not installed)

- `nodemailer` in pnpm store: v7.0.11 and v7.0.13 as **transitive deps** — not a direct dependency
  - Would need to be added as direct dependency for Linux email

### Project Conventions

- AGENTS.md sync rules: every feature change must update worker, SDK, CLI, examples, docs, tests
- `src/lib/env.ts` resolution order: `FREEPIECES_` → `FP_` → legacy unprefixed
- `tsconfig.worker.json` uses `"lib": ["ES2022", "WebWorker"]`, `"types": ["node", "@cloudflare/workers-types"]`

---

## Key Discoveries

### Project Structure

The project uses clean dependency injection via the `Env` interface:
- **Hono app logic** in `src/worker/create-worker.ts` — CF-agnostic HTTP routing
- **CF-specific bindings** injected through the `Env` object passed to every handler
- **No global state** reads from CF globals — all CF APIs come through the `env` parameter
- This design means Linux support is a matter of providing a Linux-compatible `Env` at startup

### Implementation Patterns

**Complete KV interface used throughout the codebase:**

```typescript
// All operations actually called (from token-store.ts, webhook.ts, admin-config.ts, auth-resolve.ts):
kv.get(key: string): Promise<string | null>
kv.get(key: string, type: 'json'): Promise<unknown>
kv.put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
kv.delete(key: string): Promise<void>
kv.list({ prefix?: string, cursor?: string }): Promise<{
  keys: { name: string }[];
  list_complete: boolean;
  cursor?: string;
}>
```

**Queue interface used:**

```typescript
// Producer (webhook.ts dispatchWebhook):
queue.send(body: unknown): Promise<void>
// Consumer (create-worker.ts .queue() method):
batch.messages: Array<{ body: unknown; ack(): void }>
```

**ExecutionContext.waitUntil — sole usage (routes/webhook-api.ts:95):**

```typescript
c.executionCtx.waitUntil(
  dispatchWebhook(pieceName, webhookBody, c.env).catch((err: unknown) =>
    console.error('[freepieces] dispatchWebhook error:', err),
  ),
);
return c.text('OK', 200);
```

**ASSETS Fetcher usage (create-worker.ts:102–109):**

```typescript
if (!c.env.ASSETS) {
  return c.json({ error: 'Admin assets not configured. Run: npm run build:admin' }, 503);
}
const assetPath = pathname.startsWith('/admin/assets/') ? pathname : '/admin/index.html';
return c.env.ASSETS.fetch(new Request(new URL(assetPath, c.req.url).toString(), c.req.raw));
```

**cloudflare:email dynamic import (auth/email.ts:74–77):**

```typescript
// Already guarded: logs to console when emailBinding absent (line 60-63)
const { EmailMessage } = await import('cloudflare:email');
const message = new EmailMessage(senderEmail, recipientEmail, rawMessage);
await emailBinding.send(message);
```

### Complete Examples

**@hono/node-server serve pattern (v2.0.3):**

```typescript
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';

// Start HTTP server
serve({ fetch: app.fetch, port: Number(process.env['PORT'] ?? 3000) });

// Static file middleware (Node fs-backed implementation of hono serve-static)
app.use('/admin/*', serveStatic({ root: './dist/public' }));
```

**OpenAuth MemoryStorage with file persistence:**

```typescript
import { MemoryStorage } from '@openauthjs/openauth/storage/memory';

// Persistent across restarts (single-process safe):
const storage = MemoryStorage({ persist: './data/auth-store.json' });

issuer({ storage, providers, subjects, allow: async () => true, success: ... });
```

**KV shim for Linux (implements full interface used by token-store.ts and webhook.ts):**

```typescript
// src/lib/linux-kv.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createFileKV(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  let store: Record<string, string> = {};
  if (existsSync(filePath)) {
    store = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
  }
  const save = () => writeFileSync(filePath, JSON.stringify(store));
  return {
    async get(key: string, type?: 'json') {
      const val = store[key] ?? null;
      return type === 'json' ? (val ? (JSON.parse(val) as unknown) : null) : val;
    },
    async put(key: string, value: string) { store[key] = value; save(); },
    async delete(key: string) { delete store[key]; save(); },
    async list({ prefix = '' }: { prefix?: string; cursor?: string } = {}) {
      const keys = Object.keys(store).filter(k => k.startsWith(prefix)).sort().map(name => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}
```

**nodemailer replacement for auth/email.ts:**

```typescript
// src/lib/linux-email.ts
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env['SMTP_HOST'],
  port: Number(process.env['SMTP_PORT'] ?? 587),
  secure: process.env['SMTP_SECURE'] === 'true',
  auth: { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] },
});

// Called from createAuthIssuer() instead of sendVerificationEmail()
export async function sendVerificationEmailSmtp(to: string, code: string): Promise<void> {
  const from = process.env['FREEPIECES_AUTH_SENDER_EMAIL'] ?? '';
  if (!from) { console.log(`[freepieces-auth] Verification code for ${to}: ${code}`); return; }
  await transporter.sendMail({
    from: `Freepieces <${from}>`,
    to,
    subject: `Your verification code: ${code}`,
    text: `Your verification code is: ${code}\n\nExpires in 10 minutes.`,
  });
}
```

**ExecutionContext.waitUntil Linux replacement — two options:**

```typescript
// Option A: setImmediate (fire-and-forget, 200 returns immediately — matches CF behavior):
setImmediate(() => {
  dispatchWebhook(pieceName, webhookBody, c.env).catch((err: unknown) =>
    console.error('[freepieces] dispatchWebhook error:', err));
});
return c.text('OK', 200);

// Option B: optional chaining guard (zero code-change approach):
(c.executionCtx?.waitUntil ?? ((p: Promise<void>) => setImmediate(() => p)))(
  dispatchWebhook(pieceName, webhookBody, c.env).catch(console.error)
);
```

### API and Schema Documentation

**Complete CF API inventory with Linux replacements:**

| CF API | File | Lines | Function | Linux Replacement |
|--------|------|-------|----------|-------------------|
| `KVNamespace` (TOKEN_STORE) | `lib/token-store.ts` | 27–96 | Token CRUD | `createFileKV('./data/token-store.json')` |
| `KVNamespace` (TOKEN_STORE) | `lib/webhook.ts` | 110–169 | Subscription CRUD | Same `createFileKV` instance |
| `requireKVBinding(env,'TOKEN_STORE')` | `routes/webhook-api.ts` | 168, 206, 225 | KV access | Inject shim into env |
| `KVNamespace` | `lib/admin-config.ts` | 16–18 | isPieceEnabled flag | Same KV shim |
| `KVNamespace` | `lib/auth-resolve.ts` | 25 | Token lookup | Same KV shim |
| `CloudflareStorage({namespace})` | `auth/issuer.ts` | 19 | OpenAuth auth storage | `MemoryStorage({ persist: './data/auth-store.json' })` |
| `import('cloudflare:email')/EmailMessage` | `auth/email.ts` | 74–75 | Email construction | nodemailer (bypass CF path via optional `storage` param) |
| `EMAIL` binding `.send(msg)` | `auth/email.ts` | 77 | Email dispatch | nodemailer `transporter.sendMail()` |
| `ExecutionContext.waitUntil()` | `routes/webhook-api.ts` | 95 | Async fan-out | `setImmediate()` or optional chaining |
| `MessageBatch<T>` + `msg.ack()` | `worker/create-worker.ts` | 120–138 | Queue consumer handler | Remove `.queue()` from Linux export |
| `Queue.send(body)` | `lib/webhook.ts` | 247 | Queue event delivery | Reject `queueName` subs; only `callbackUrl` on Linux |
| `ASSETS Fetcher` | `worker/create-worker.ts` | 102–109 | Admin SPA serving | `serveStatic({ root: './dist/public' })` from `@hono/node-server` |
| `ExportedHandler<Env>` | `worker/create-worker.ts` | 139 | Worker export type constraint | Remove; call `serve({ fetch })` directly |
| `@cloudflare/workers-types` | `tsconfig.json`, `tsconfig.worker.json` | — | Ambient CF types | `@types/node` in `tsconfig.linux.json` |

### Configuration Examples

**New Linux-only env vars (additions to `.env.example`):**

```bash
# ── Linux / Node.js server ────────────────────────────────────────────────────
PORT=3000
FREEPIECES_DATA_DIR=./data

# SMTP (replaces Cloudflare Email Workers binding for verification codes)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@example.com
SMTP_PASS=<your-smtp-password>
FREEPIECES_AUTH_SENDER_EMAIL=noreply@example.com
```

**New direct npm dependencies:**

```json
{
  "dependencies": {
    "@hono/node-server": "^2.0.3",
    "nodemailer": "^7.0.13"
  },
  "devDependencies": {
    "@types/nodemailer": "^6.4.17"
  }
}
```

### Technical Requirements

1. **`WebWorker` lib removal**: `tsconfig.worker.json` uses `"lib": ["ES2022", "WebWorker"]`. Linux build must use `"lib": ["ES2022"]` only and `"types": ["node"]` not `@cloudflare/workers-types`.

2. **`cloudflare:email` import guard**: Dynamic import in `auth/email.ts:74` throws on Node.js. The surrounding guard (lines 60–63) already skips the CF path when `emailBinding` is absent. Linux entrypoint injects a different email mechanism via the `createAuthIssuer()` call.

3. **KV shim duck-typing**: `getKVBinding()` in `env.ts` checks `'get' in (v as object)`. Any object with a `.get` method passes. The shim only needs to implement the 5 operations actually called.

4. **`ExportedHandler<Env>` typing**: This is a CF Worker type. Linux entrypoint calls `serve({ fetch: worker.fetch })` instead.

5. **Queue subs on Linux**: `resolveQueueBinding()` already returns `undefined` when not found and logs an error. Linux entrypoint can additionally reject `queueName` at subscription creation time by not registering any queue bindings in env.

6. **Admin SPA on Linux**: `@hono/node-server/serve-static` must be mounted at `/admin/*` with `root: './dist/public'` and SPA fallback to `index.html` for client-side routing (non-asset paths).

7. **Auth issuer storage hardcoded**: `auth/issuer.ts` hardcodes `CloudflareStorage`. Cleanest fix: add optional `storage?: StorageAdapter` param to `createAuthIssuer()`. One-line change, fully backward-compatible.

8. **`executionCtx.waitUntil`**: Only one call in `routes/webhook-api.ts:95`. Guard with optional chaining or inject a shim context.

---

## Recommended Approach

**Single Linux entrypoint (`src/linux-server.ts`)** requiring minimal changes to existing source:

**Minimal source modifications needed (2 files):**
- `src/auth/issuer.ts` — add `storage?: StorageAdapter` optional param to `createAuthIssuer()` (1-line change)
- `src/routes/webhook-api.ts:95` — guard `waitUntil`: `c.executionCtx?.waitUntil(p) ?? setImmediate(() => p)` (1-line change)

**New files required:**
1. `src/linux-server.ts` — Node.js entrypoint
2. `src/lib/linux-kv.ts` — File-backed KV shim
3. `src/lib/linux-email.ts` — nodemailer email sender
4. `tsconfig.linux.json` — TypeScript config without CF types
5. `scripts/start-linux.sh` — startup script for systemd/Docker
6. `Dockerfile` (optional)

The entrypoint:
1. Reads env vars from `process.env`, constructs a plain `Env`-compatible object
2. Instantiates `createFileKV('./data/token-store.json')` for TOKEN_STORE
3. Uses `MemoryStorage({ persist: './data/auth-store.json' })` for OpenAuth
4. Wires `sendVerificationEmailSmtp` for email delivery
5. Creates Hono app from `createFreepiecesWorker()`, then mounts `serveStatic` at `/admin/*`
6. Calls `serve({ fetch: app.fetch, port })` from `@hono/node-server`

---

## Implementation Guidance

- **Objectives**: Deploy freepieces on any Linux server (VPS, Docker, systemd) without Cloudflare. Same HTTP API, same admin SPA, same auth flow. No regression on CF deployments.

- **Key Tasks**:
  1. Add `@hono/node-server` and `nodemailer` to `dependencies`
  2. Add `@types/nodemailer` to `devDependencies`
  3. Create `src/lib/linux-kv.ts` — file-backed KV shim
  4. Create `src/lib/linux-email.ts` — nodemailer email sender
  5. Create `src/linux-server.ts` — entrypoint wiring shims and calling `serve()`
  6. Create `tsconfig.linux.json` with Node types only
  7. Add `"build:linux"` and `"start"` scripts to `package.json`
  8. Add optional `storage` param to `createAuthIssuer()` in `src/auth/issuer.ts`
  9. Guard `executionCtx.waitUntil()` in `src/routes/webhook-api.ts`
  10. Add `scripts/start-linux.sh` and optional `Dockerfile`
  11. Update `README.md` and `docs/` with Linux hosting section
  12. Update `AGENTS.md` sync rules to include `src/linux-server.ts` and `src/lib/linux-*.ts`

- **Dependencies**:
  - `@hono/node-server@^2.0.3` — new direct dependency
  - `nodemailer@^7.0.13` — new direct dependency (already in pnpm store as transitive)
  - `@types/nodemailer` — new devDependency

- **Success Criteria**:
  - `node dist/linux/linux-server.js` starts a working HTTP server on `PORT`
  - All HTTP routes respond: `/health`, `/pieces`, `/admin/`, `/admin/api/*`, `/run/:piece/:action`, `/auth/*`, `/mcp/*`
  - Admin SPA loads from `dist/public/` with client-side routing working
  - OpenAuth email login works via SMTP
  - OAuth2 tokens persist across restarts via file KV
  - Subscriptions with `callbackUrl` work; `queueName` returns a clear error
  - `npm test` and `npm run check` pass with no regressions
  - New unit tests added for `linux-kv.ts` and `linux-email.ts`

---

## Summary Table: CF API → Linux Replacement

| CF API | Used In | Linux Replacement | Effort |
|--------|---------|-------------------|--------|
| `KVNamespace` (TOKEN_STORE) | token-store.ts, webhook.ts, webhook-api.ts, auth-resolve.ts, admin-config.ts | File-backed JSON KV shim (`src/lib/linux-kv.ts`) | Medium |
| `KVNamespace` (AUTH_STORE) | auth/issuer.ts | `MemoryStorage({ persist })` from openauth (already in deps) | Low |
| `CloudflareStorage` | auth/issuer.ts | `MemoryStorage({ persist: './data/auth-store.json' })` | Low |
| `cloudflare:email` + `EmailMessage` | auth/email.ts | nodemailer SMTP (`src/lib/linux-email.ts`) | Medium |
| `EMAIL` binding `.send()` | auth/email.ts | nodemailer transporter via optional `sendCode` injection | Medium |
| `ExecutionContext.waitUntil()` | routes/webhook-api.ts:95 | Optional chaining + `setImmediate()` | Low |
| `MessageBatch` + `msg.ack()` | worker/create-worker.ts queue handler | Remove `.queue()` from Linux export | Low |
| `Queue.send()` | lib/webhook.ts dispatchWebhook | Reject `queueName` subs at subscription creation | Low |
| `ASSETS Fetcher` | worker/create-worker.ts:102–109 | `serveStatic({ root: './dist/public' })` from `@hono/node-server` | Low |
| `ExportedHandler<Env>` | worker/create-worker.ts:139 | Remove; use `serve({ fetch })` directly | Low |
| `@cloudflare/workers-types` | tsconfig.json, tsconfig.worker.json | `@types/node` in `tsconfig.linux.json` | Low |
| CF Access JWT verification | lib/cf-access.ts | Keep as-is (skipped when env vars absent) | None |

**Legend**: Low = < 1 hour, Medium = 1–4 hours

---

## Env Var Mapping: New Linux-Only Variables

| Linux Env Var | Purpose | CF Equivalent | Required |
|---------------|---------|---------------|----------|
| `PORT` | HTTP server listen port | None (Cloudflare manages port) | No (default: 3000) |
| `FREEPIECES_DATA_DIR` | Directory for KV JSON persistence files | None (KV is managed) | No (default: `./data`) |
| `SMTP_HOST` | SMTP server hostname | `FREEPIECES_EMAIL` binding | Yes (for email login) |
| `SMTP_PORT` | SMTP server port | — | No (default: 587) |
| `SMTP_SECURE` | Use TLS for SMTP (`true`/`false`) | — | No (default: false) |
| `SMTP_USER` | SMTP authentication username | — | Yes (for email login) |
| `SMTP_PASS` | SMTP authentication password | — | Yes (for email login) |

All existing env vars carry over unchanged (`FREEPIECES_PUBLIC_URL`, `FREEPIECES_TOKEN_ENCRYPTION_KEY`, `FREEPIECES_RUN_API_KEY`, `FREEPIECES_ADMIN_EMAILS`, etc.). The `getEnvStr` / `getEnvBool` helpers in `src/lib/env.ts` read from a plain object, so the Linux `Env` object just needs the same string values populated from `process.env`.

---

## Build/Entry Point Recommendations

**Linux entrypoint**: `src/linux-server.ts`

**New `package.json` scripts:**

```json
"build:linux": "tsc --project tsconfig.linux.json",
"start": "node dist/linux/linux-server.js",
"start:dev": "node --watch dist/linux/linux-server.js"
```

**`tsconfig.linux.json`** (new file, separate from `tsconfig.worker.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "declaration": false,
    "outDir": "dist/linux",
    "rootDir": "src",
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": [
    "src/linux-server.ts",
    "src/worker/**",
    "src/lib/**",
    "src/auth/**",
    "src/framework/**",
    "src/routes/**",
    "src/pieces/**"
  ],
  "exclude": [
    "src/**/*.test.ts",
    "src/admin",
    "src/ghpages",
    "src/cli"
  ]
}
```

**Key architectural constraint**: `src/auth/issuer.ts` hardcodes `CloudflareStorage({ namespace: getKVBinding(env, 'AUTH_STORE') })`. To support Linux without a KV binding in `env`, add one optional `storage?: StorageAdapter` param to `createAuthIssuer(env, storage?)`. The Linux entrypoint passes `MemoryStorage({ persist })`. The CF path keeps the existing default. This is the only structural change needed to existing files that cannot be handled by a shim injection.
