/**
 * Linux / Node.js entrypoint for freepieces.
 *
 * Starts an HTTP server using @hono/node-server that exposes the same API
 * surface as the Cloudflare Worker, with file-backed KV and SMTP email
 * replacing CF-specific bindings.
 *
 * Admin SPA static files are served from dist/public/admin/.
 * All other routes are handled by the standard freepieces Hono app.
 *
 * Usage:
 *   node dist/linux/linux-server.js
 *   PORT=3000 FREEPIECES_DATA_DIR=./data node dist/linux/linux-server.js
 */

import './pieces/index.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { MemoryStorage } from '@openauthjs/openauth/storage/memory';
import { createFreepiecesWorker } from './worker/create-worker.js';
import { getIssuerApp } from './lib/auth-issuer.js';
import { createFileKV } from './lib/linux-kv.js';
import { createSmtpSender } from './lib/linux-email.js';
import type { Env } from './framework/types.js';

// ── Runtime shims ─────────────────────────────────────────────────────────

const dataDir = process.env['FREEPIECES_DATA_DIR'] ?? './data';
const tokenKv = createFileKV(`${dataDir}/token-store.json`);
const authStorage = MemoryStorage();
const sendCode = createSmtpSender();

// ── Env object ───────────────────────────────────────────────────────────
// Build an Env-compatible plain object from process.env + shims.
// String vars are resolved by getEnvStr() in canonical FREEPIECES_ form.
const env = {
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
  // File-backed KV shim — satisfies duck-type check ('get' in obj)
  FREEPIECES_TOKEN_STORE: tokenKv,
  // No AUTH_STORE KV binding — Linux uses MemoryStorage via getIssuerApp opts
  FREEPIECES_AUTH_STORE: undefined,
  // No Cloudflare ASSETS binding — static files served by @hono/node-server/serve-static
  ASSETS: undefined,
} as unknown as Env;

// Pre-populate the issuer cache with Linux-specific storage and sendCode.
// openauth-api.ts calls getIssuerApp(c.env) on every /oa/* request; since
// c.env is the same object reference as `env` above, it will find this entry.
getIssuerApp(env, { storage: authStorage, sendCode });

// ── Worker ───────────────────────────────────────────────────────────────

const worker = createFreepiecesWorker();

// Noop ExecutionContext for Node.js (no waitUntil needed; webhook-api.ts uses
// setImmediate fallback when executionCtx?.waitUntil is absent).
const noopCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ── Hono app ─────────────────────────────────────────────────────────────

const app = new Hono();

// Admin static assets — must come before the SPA catch-all
app.use('/admin/assets/*', serveStatic({ root: './dist/public' }));

// Admin SPA — serve index.html for all non-API admin paths (client-side routing)
app.get('/admin/*', async (c) => {
  // Admin API requests are handled by the worker
  if (c.req.path.startsWith('/admin/api/')) {
    return worker.fetch(c.req.raw, env, noopCtx);
  }
  try {
    const html = await readFile('./dist/public/admin/index.html', 'utf8');
    return c.html(html);
  } catch {
    return c.text('Admin SPA not built. Run: pnpm run build:admin', 503);
  }
});

// All other routes delegate to the freepieces worker
app.all('*', (c) => worker.fetch(c.req.raw, env, noopCtx));

// ── Server ───────────────────────────────────────────────────────────────

const port = Number(process.env['PORT'] ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`[freepieces] Server running at http://localhost:${port}`);

  // Fire a warmup request to the issuer's /oa/authorize endpoint right after
  // the server starts.  On a fresh process (or cold Cloudflare isolate when
  // PUBLIC_URL points to production), the first authorize call imports an
  // RSA-OAEP-512 key pair which takes 10+ seconds.  Starting it now means the
  // key is ready by the time the user opens the browser and clicks Sign in.
  const issuerBase = `http://localhost:${port}`;
  const redirectUri = encodeURIComponent(`${issuerBase}/admin/api/callback`);
  void fetch(
    `${issuerBase}/oa/authorize?client_id=freepieces-worker` +
      `&redirect_uri=${redirectUri}&response_type=code&provider=code`,
  ).catch(() => {});
});
