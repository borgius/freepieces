<!-- markdownlint-disable-file -->

# Task Details: Linux Hosting Deployment for freepieces

## Research Reference

**Source Research**: #file:../research/20260519-linux-hosting-deployment-research.md

---

## Phase 1: Dependencies

### Task 1.1: Add direct dependencies for Node.js server and SMTP email

Install `@hono/node-server` (HTTP server adapter for Hono) and `nodemailer` (SMTP mailer). Both are absent from `package.json` today. `nodemailer` already sits in the pnpm store as a transitive dep so no network download is needed; it just needs to be promoted to a direct dep.

- **Files**:
  - `package.json` — add to `"dependencies"`: `"@hono/node-server": "^2.0.3"`, `"nodemailer": "^7.0.13"`
  - `package.json` — add to `"devDependencies"`: `"@types/nodemailer": "^6.4.17"`
- **Command**: `pnpm add @hono/node-server nodemailer && pnpm add -D @types/nodemailer`
- **Success**:
  - `node_modules/@hono/node-server` exists after install
  - `import { serve } from '@hono/node-server'` resolves without error in TypeScript
  - `import { serveStatic } from '@hono/node-server/serve-static'` resolves
  - `import nodemailer from 'nodemailer'` resolves
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 162–178) — dependency verification and version compatibility
- **Dependencies**: none

---

## Phase 2: Minimal Source Patches

### Task 2.1: Add optional `storage` param to `createAuthIssuer()` in `src/auth/issuer.ts`

`createAuthIssuer()` hardcodes `CloudflareStorage({ namespace: getKVBinding(env, 'AUTH_STORE') as any })`. On Linux there is no KV binding, so this throws. Fix: add an optional second parameter `storage?: StorageAdapter` that, when provided, is used instead of `CloudflareStorage`. The CF path keeps its existing default.

- **Files**:
  - `src/auth/issuer.ts`
- **Change description**:
  1. Import `StorageAdapter` type from `@openauthjs/openauth/storage`
  2. Change signature to `createAuthIssuer(env: Env, storage?: StorageAdapter)`
  3. In the issuer config, replace the hardcoded `CloudflareStorage(...)` line with:
     ```typescript
     storage: storage ?? CloudflareStorage({ namespace: getKVBinding(env, 'AUTH_STORE') as KVNamespace }),
     ```
  4. Update callers — `src/lib/auth-issuer.ts` `getIssuerApp()` — to pass no second arg (preserves CF behavior)
- **Success**:
  - `tsc --noEmit` on the affected files passes
  - CF path (`getIssuerApp(env)` with no second arg) continues to use `CloudflareStorage`
  - Linux path (`createAuthIssuer(env, memoryStorage)`) uses the provided adapter
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 119–126) — `CloudflareStorage` usage and `MemoryStorage` API
- **Dependencies**: Task 1.1 (pnpm install, so `StorageAdapter` type is available)

### Task 2.2: Guard `executionCtx.waitUntil()` in `src/routes/webhook-api.ts`

Line 95 in `webhook-api.ts` calls `c.executionCtx.waitUntil(...)`. On Node.js `c.executionCtx` is `undefined`, causing a runtime crash on webhook delivery.

- **Files**:
  - `src/routes/webhook-api.ts`
- **Change description**: Replace the `waitUntil` call at line 95 with an optional-chaining + `setImmediate` fallback:
  ```typescript
  const dispatch = dispatchWebhook(pieceName, webhookBody, c.env).catch((err: unknown) =>
    console.error('[freepieces] dispatchWebhook error:', err),
  );
  if (c.executionCtx?.waitUntil) {
    c.executionCtx.waitUntil(dispatch);
  } else {
    setImmediate(() => { dispatch.catch(() => {}); });
  }
  return c.text('OK', 200);
  ```
- **Success**:
  - On CF: `waitUntil` still called (behavior unchanged)
  - On Linux: `setImmediate` used, response returns immediately, dispatch runs async
  - `tsc --noEmit` passes
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 245–257) — `executionCtx.waitUntil` options A and B
- **Dependencies**: none

---

## Phase 3: Linux Infrastructure Files

### Task 3.1: Create `src/lib/linux-kv.ts` — file-backed KV shim

A plain object implementing the exact KV interface called throughout the codebase: `get`, `put`, `delete`, `list`. Persists to a JSON file on every mutation. Safe for single-process deployments; not cluster-safe (acceptable for V1).

- **Files**:
  - `src/lib/linux-kv.ts` — new file
- **Implementation**:
  ```typescript
  import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
  import { dirname } from 'node:path';

  export interface KVShim {
    get(key: string): Promise<string | null>;
    get(key: string, type: 'json'): Promise<unknown>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(opts?: { prefix?: string; cursor?: string }): Promise<{
      keys: Array<{ name: string }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  }

  export function createFileKV(filePath: string): KVShim {
    mkdirSync(dirname(filePath), { recursive: true });
    let store: Record<string, string> = {};
    if (existsSync(filePath)) {
      store = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
    }
    const save = () => writeFileSync(filePath, JSON.stringify(store, null, 2));
    return {
      async get(key: string, type?: 'json') {
        const val = store[key] ?? null;
        return type === 'json' ? (val ? (JSON.parse(val) as unknown) : null) : val;
      },
      async put(key: string, value: string) {
        store[key] = value;
        save();
      },
      async delete(key: string) {
        delete store[key];
        save();
      },
      async list({ prefix = '' }: { prefix?: string; cursor?: string } = {}) {
        const keys = Object.keys(store)
          .filter((k) => k.startsWith(prefix))
          .sort()
          .map((name) => ({ name }));
        return { keys, list_complete: true as const, cursor: undefined };
      },
    };
  }
  ```
- **Success**:
  - `getKVBinding(env, 'TOKEN_STORE')` returns the shim (duck-type passes: `'get' in obj`)
  - `storeToken`, `getToken`, `listStoredUserIds`, `deleteToken` in `token-store.ts` work correctly
  - Subscription CRUD in `webhook.ts` works correctly
  - Data persists to disk across restarts
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 182–215) — full KV interface and shim sample code
- **Dependencies**: Task 1.1

### Task 3.2: Create `src/lib/linux-email.ts` — nodemailer SMTP email sender

Replaces the Cloudflare Email Workers binding for sending verification codes. Used in the Linux entrypoint instead of `sendVerificationEmail` from `src/auth/email.ts`.

- **Files**:
  - `src/lib/linux-email.ts` — new file
- **Implementation**:
  ```typescript
  import nodemailer from 'nodemailer';

  export function createSmtpSender() {
    const transporter = nodemailer.createTransport({
      host: process.env['SMTP_HOST'],
      port: Number(process.env['SMTP_PORT'] ?? 587),
      secure: process.env['SMTP_SECURE'] === 'true',
      auth:
        process.env['SMTP_USER']
          ? { user: process.env['SMTP_USER'], pass: process.env['SMTP_PASS'] }
          : undefined,
    });

    return async function sendCode(email: string, code: string): Promise<void> {
      const from = process.env['FREEPIECES_AUTH_SENDER_EMAIL'] ?? process.env['FP_AUTH_SENDER_EMAIL'] ?? '';
      if (!from || !process.env['SMTP_HOST']) {
        console.log(`[freepieces-auth] Verification code for ${email}: ${code}`);
        return;
      }
      await transporter.sendMail({
        from: `Freepieces <${from}>`,
        to: email,
        subject: `Your verification code: ${code}`,
        text: `Your verification code is: ${code}\n\nThis code expires in 10 minutes.`,
      });
    };
  }
  ```
- **Note**: The `sendCode` function replaces the `sendCode` callback inside `CodeUI({ sendCode: ... })` in `createAuthIssuer()`. The Linux entrypoint passes it when calling `createAuthIssuer(env, storage, sendCode)` — requires Task 2.1 to also expose a `sendCode` override param (add as third optional param).
- **Success**:
  - When `SMTP_HOST` is absent: logs code to console (dev-friendly fallback)
  - When `SMTP_HOST` is set: sends email via nodemailer without error
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 218–240) — nodemailer sample code and env vars
- **Dependencies**: Task 1.1

### Task 3.3: Create `src/linux-server.ts` — Node.js entrypoint

The main entrypoint for Linux deployments. Imports the Hono app factory, wires all shims into an `Env`-compatible object, mounts static file serving, and calls `serve()`.

- **Files**:
  - `src/linux-server.ts` — new file
- **Implementation outline**:
  ```typescript
  import './pieces/index.js';
  import { serve } from '@hono/node-server';
  import { serveStatic } from '@hono/node-server/serve-static';
  import { MemoryStorage } from '@openauthjs/openauth/storage/memory';
  import { createFreepiecesWorker } from './worker/create-worker.js';
  import { createFileKV } from './lib/linux-kv.js';
  import { createSmtpSender } from './lib/linux-email.js';

  const dataDir = process.env['FREEPIECES_DATA_DIR'] ?? './data';
  const tokenKv = createFileKV(`${dataDir}/token-store.json`);
  const authStorage = MemoryStorage({ persist: `${dataDir}/auth-store.json` });
  const sendCode = createSmtpSender();

  // Build an Env-compatible plain object from process.env + shims
  const env = {
    // String vars — pass through from process.env using canonical names
    FREEPIECES_PUBLIC_URL: process.env['FREEPIECES_PUBLIC_URL'],
    FREEPIECES_TOKEN_ENCRYPTION_KEY: process.env['FREEPIECES_TOKEN_ENCRYPTION_KEY'],
    FREEPIECES_RUN_API_KEY: process.env['FREEPIECES_RUN_API_KEY'],
    FREEPIECES_ADMIN_EMAILS: process.env['FREEPIECES_ADMIN_EMAILS'],
    FREEPIECES_ALLOWED_EMAILS: process.env['FREEPIECES_ALLOWED_EMAILS'],
    FREEPIECES_DISABLE_AUTH: process.env['FREEPIECES_DISABLE_AUTH'],
    FREEPIECES_AUTH_SENDER_EMAIL: process.env['FREEPIECES_AUTH_SENDER_EMAIL'],
    FREEPIECES_GMAIL_CLIENT_ID: process.env['FREEPIECES_GMAIL_CLIENT_ID'],
    FREEPIECES_GMAIL_CLIENT_SECRET: process.env['FREEPIECES_GMAIL_CLIENT_SECRET'],
    FREEPIECES_GOOGLE_CLIENT_ID: process.env['FREEPIECES_GOOGLE_CLIENT_ID'],
    FREEPIECES_GOOGLE_CLIENT_SECRET: process.env['FREEPIECES_GOOGLE_CLIENT_SECRET'],
    FREEPIECES_GITHUB_CLIENT_ID: process.env['FREEPIECES_GITHUB_CLIENT_ID'],
    FREEPIECES_GITHUB_CLIENT_SECRET: process.env['FREEPIECES_GITHUB_CLIENT_SECRET'],
    // KV shim for token and subscription storage
    FREEPIECES_TOKEN_STORE: tokenKv,
    // No AUTH_STORE binding — Linux uses MemoryStorage via createAuthIssuer param
    FREEPIECES_AUTH_STORE: undefined,
    // No queue binding — queueName subscriptions are not supported on Linux
    ASSETS: undefined,
  } as unknown as import('./framework/types.js').Env;

  // Store authStorage and sendCode in env for issuer access (see Task 2.1 extension)
  // The linux-specific fields are picked up by createAuthIssuer when called from auth-issuer.ts
  (env as Record<string, unknown>)['__linux_authStorage'] = authStorage;
  (env as Record<string, unknown>)['__linux_sendCode'] = sendCode;

  const worker = createFreepiecesWorker();

  // Create a Hono app that wraps the worker fetch and adds Node.js static serving
  import { Hono } from 'hono';
  const app = new Hono();

  // Admin SPA static assets (must come before the worker.fetch passthrough)
  app.use(
    '/admin/*',
    serveStatic({
      root: './dist/public',
      rewriteRequestPath: (path) => {
        // Serve index.html for all non-asset paths (client-side routing)
        if (!path.startsWith('/admin/assets/')) return '/admin/index.html';
        return path;
      },
    }),
  );

  // All other routes delegate to the freepieces Hono app
  app.all('*', (c) => worker.fetch(c.req.raw, env, { waitUntil: () => {}, passThroughOnException: () => {} } as ExecutionContext));

  const port = Number(process.env['PORT'] ?? 3000);
  serve({ fetch: app.fetch, port }, () => {
    console.log(`[freepieces] Server running at http://localhost:${port}`);
  });
  ```
- **Note on `__linux_*` env fields**: The cleanest approach is to extend Task 2.1 to also accept `sendCode` as a third optional param to `createAuthIssuer()`. The entrypoint would then need to reach into `auth-issuer.ts` to inject them. An alternative is to extend `Env` with optional `__linux_*` fields and read them in `auth/issuer.ts`. Document the chosen approach clearly in the implementation.
- **Success**:
  - Server starts, `/health` returns `{"ok":true,...}`
  - `/admin/` serves `dist/public/admin/index.html`
  - `/admin/assets/**` serves static assets
  - Auth routes redirect to `/oa/authorize`
  - Runtime routes respond correctly
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 294–350) — `@hono/node-server` serve + serveStatic API, entrypoint recommendations
- **Dependencies**: Tasks 1.1, 2.1, 2.2, 3.1, 3.2

### Task 3.4: Create `tsconfig.linux.json`

TypeScript config for the Linux build. Must NOT include `@cloudflare/workers-types` or `WebWorker` lib (which would inject CF globals like `KVNamespace`, `MessageBatch`, etc. into the type environment).

- **Files**:
  - `tsconfig.linux.json` — new file at project root
- **Content**:
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
- **Note**: `src/framework/types.ts` declares `KVNamespace`, `Queue`, `Fetcher`, `MessageBatch` via `@cloudflare/workers-types`. On the Linux build these are referenced in the `Env` interface but the shim objects are compatible at runtime. `skipLibCheck: true` avoids type-level failures on CF-specific interface fields that aren't needed at the Node.js call sites.
- **Success**:
  - `tsc --project tsconfig.linux.json --noEmit` completes without errors
  - `dist/linux/linux-server.js` is emitted and runnable with `node`
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 353–380) — tsconfig recommendations and CF types interaction
- **Dependencies**: Tasks 2.1, 2.2, 3.1, 3.2, 3.3

---

## Phase 4: Build and Startup Scripts

### Task 4.1: Add `build:linux`, `start`, and `start:dev` to `package.json`

- **Files**:
  - `package.json`
- **Scripts to add** (insert after `"build:cli"`):
  ```json
  "build:linux": "tsc --project tsconfig.linux.json",
  "start": "node dist/linux/linux-server.js",
  "start:dev": "node --watch dist/linux/linux-server.js"
  ```
- **Success**:
  - `pnpm run build:linux` compiles to `dist/linux/`
  - `pnpm start` starts the HTTP server
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 383–392) — script recommendations
- **Dependencies**: Task 3.4

### Task 4.2: Create `scripts/start-linux.sh`

Startup helper that loads `.env`, runs `npm run build:linux` if `dist/linux/linux-server.js` is absent, then starts the server. Suitable for use as a systemd `ExecStart`.

- **Files**:
  - `scripts/start-linux.sh` — new file
- **Content outline**:
  ```bash
  #!/usr/bin/env bash
  set -euo pipefail
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$ROOT_DIR"
  [[ -f .env ]] && set -o allexport && source .env && set +o allexport
  [[ ! -f dist/linux/linux-server.js ]] && npm run build:linux
  exec node dist/linux/linux-server.js
  ```
- **Success**:
  - Script is executable (`chmod +x`)
  - Starts server when run directly
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 395–405)
- **Dependencies**: Task 4.1

### Task 4.3: Create `Dockerfile`

Multi-stage Dockerfile: build stage compiles TypeScript; runtime stage is a minimal Node.js image.

- **Files**:
  - `Dockerfile` — new file at project root
- **Content outline**:
  ```dockerfile
  FROM node:22-alpine AS builder
  WORKDIR /app
  RUN npm install -g pnpm
  COPY package.json pnpm-lock.yaml ./
  RUN pnpm install --frozen-lockfile
  COPY . .
  RUN pnpm run build:admin && pnpm run build:linux

  FROM node:22-alpine AS runtime
  WORKDIR /app
  RUN npm install -g pnpm
  COPY package.json pnpm-lock.yaml ./
  RUN pnpm install --prod --frozen-lockfile
  COPY --from=builder /app/dist/linux ./dist/linux
  COPY --from=builder /app/dist/public ./dist/public
  ENV PORT=3000
  EXPOSE 3000
  VOLUME ["/app/data"]
  CMD ["node", "dist/linux/linux-server.js"]
  ```
- **Success**:
  - `docker build -t freepieces .` succeeds
  - `docker run -p 3000:3000 --env-file .env freepieces` starts and `/health` responds
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 408–430)
- **Dependencies**: Tasks 4.1, 4.2

---

## Phase 5: Env Var and Config Updates

### Task 5.1: Add Linux-only env vars to `.env.example`

- **Files**:
  - `.env.example`
- **Additions** (add a new `# Linux / Node.js` section):
  ```bash
  # ── Linux / Node.js server ────────────────────────────────────────────────────
  PORT=3000
  FREEPIECES_DATA_DIR=./data

  # SMTP — replaces Cloudflare Email Workers for verification code delivery
  # Leave SMTP_HOST unset to use console-log fallback (local dev)
  SMTP_HOST=smtp.example.com
  SMTP_PORT=587
  SMTP_SECURE=false
  SMTP_USER=noreply@example.com
  SMTP_PASS=<your-smtp-password>
  FREEPIECES_AUTH_SENDER_EMAIL=noreply@example.com
  ```
- **Success**:
  - All existing CF env vars unchanged
  - New Linux vars documented with defaults and purpose
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 300–320) — env var mapping table
- **Dependencies**: Task 3.3

---

## Phase 6: Tests

### Task 6.1: Add unit tests for `src/lib/linux-kv.ts`

- **Files**:
  - `src/lib/linux-kv.test.ts` — new file
- **Test cases**:
  - `put` then `get` returns stored value
  - `get` on missing key returns `null`
  - `get(key, 'json')` deserializes JSON
  - `delete` removes the entry
  - `list({ prefix })` returns only matching keys, sorted
  - Data persists to disk and is restored on a new `createFileKV` instance pointing to same file
- **Success**:
  - All tests pass under `vitest`
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 182–215)
- **Dependencies**: Task 3.1

### Task 6.2: Add unit tests for `src/lib/linux-email.ts`

- **Files**:
  - `src/lib/linux-email.ts` — test coverage
  - `src/lib/linux-email.test.ts` — new file
- **Test cases**:
  - When `SMTP_HOST` is unset: `sendCode()` logs to console and does not call nodemailer
  - When `SMTP_HOST` is set: `sendCode()` calls `transporter.sendMail()` with correct `to`/`subject`/`from`
  - Use `vi.mock('nodemailer')` to mock the transporter
- **Success**:
  - All tests pass under `vitest`
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 218–240)
- **Dependencies**: Task 3.2

---

## Phase 7: Documentation

### Task 7.1: Add Linux hosting section to `README.md`

Add a new `## Linux / Self-hosted Deployment` section after the existing `## Cloudflare Workers` section.

- **Files**:
  - `README.md`
- **Section content**:
  - Prerequisites (Node.js ≥ 20, pnpm)
  - Quickstart steps: clone → `pnpm install` → copy `.env.example` → set `FREEPIECES_PUBLIC_URL` + `FREEPIECES_TOKEN_ENCRYPTION_KEY` → `pnpm run build:admin && pnpm run build:linux` → `pnpm start`
  - Docker quickstart: `docker build -t freepieces . && docker run -p 3000:3000 --env-file .env freepieces`
  - Link to `docs/linux-hosting.mdx` for full reference
- **Success**:
  - README renders correctly; no broken links
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 433–460)
- **Dependencies**: Tasks 3.3, 4.3

### Task 7.2: Add `docs/linux-hosting.mdx`

Full Linux hosting reference doc covering: architecture differences from CF, all env vars, SMTP setup, systemd service unit example, Docker Compose example, data directory layout, upgrade procedure.

- **Files**:
  - `docs/linux-hosting.mdx` — new file
- **Success**:
  - Renders correctly in the admin docs SPA
  - All env vars documented match `.env.example`
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 460–490)
- **Dependencies**: Task 5.1

### Task 7.3: Update `AGENTS.md` sync rules

Add `src/linux-server.ts` and `src/lib/linux-*.ts` to the "What must stay in sync" surfaces in `AGENTS.md`.

- **Files**:
  - `AGENTS.md`
- **Addition**: In the sync surface list, add a bullet for Linux server entrypoint alongside worker entrypoints
- **Success**:
  - `AGENTS.md` lists Linux entrypoint as a required sync surface
- **Research References**:
  - #file:../research/20260519-linux-hosting-deployment-research.md (Lines 35–42) — AGENTS.md conventions
- **Dependencies**: Task 3.3

---

## Dependencies

- Node.js ≥ 20 on target Linux host
- pnpm ≥ 10 for install
- `@hono/node-server@^2.0.3`
- `nodemailer@^7.0.13`
- `@types/nodemailer@^6.4.17`
- `@openauthjs/openauth@^0.4.0` (already installed; `MemoryStorage` used)

## Success Criteria

- `pnpm run build:linux` compiles without errors
- `node dist/linux/linux-server.js` starts and `/health` returns `{"ok":true,...}`
- Admin SPA loads at `/admin/` with client-side routing
- Auth email login works via SMTP (or falls back to console log)
- Token store and subscriptions persist across restarts
- `queueName` subscriptions return a clear error on Linux
- CF Worker deploy (`pnpm run deploy`) still works unchanged
- `pnpm test` green; `pnpm run check` passes
