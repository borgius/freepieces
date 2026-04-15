/** Cloudflare Workers entrypoint for freepieces. */

import { Hono } from 'hono';
import { listPieces, getPiece } from './framework/registry';
import { dispatchWebhook } from './lib/webhook';
import adminApi from './routes/admin-api';
import authApi from './routes/auth-api';
import runtimeApi from './routes/runtime-api';
import webhookApi from './routes/webhook-api';
import './pieces/index.js';
import type { Env } from './framework/types';

const app = new Hono<{ Bindings: Env }>();

// ── Health ──────────────────────────────────────────────────────────────
app.get('/health', (c) => c.json({ ok: true, service: 'freepieces', version: '0.1.0' }));

// ── List pieces ─────────────────────────────────────────────────────────
app.get('/pieces', (c) =>
  c.json(
    listPieces().map((p) => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      version: p.version,
      auth: p.auth,
      actions: p.actions.map((a) => ({
        name: a.name,
        displayName: a.displayName,
        description: a.description,
      })),
      triggers: p.triggers.map((t) => ({
        name: t.name,
        displayName: t.displayName,
        description: t.description,
        type: t.type,
      })),
    })),
  ),
);

// ── Domain sub-apps ─────────────────────────────────────────────────────
app.route('/auth', authApi);
app.route('/', runtimeApi);

// ── Admin SPA redirect ──────────────────────────────────────────────────
app.get('/admin', (c) => c.redirect('/admin/', 301));

// ── Admin API (login/logout + authenticated routes) ─────────────────────
app.route('/admin/api', adminApi);

// ── Admin SPA – serve assets (AFTER /admin/api routes) ──────────────────
app.get('/admin/*', (c) => {
  if (!c.env.ASSETS) {
    return c.json({ error: 'Admin assets not configured. Run: npm run build:admin' }, 503);
  }
  const pathname = new URL(c.req.url).pathname;
  const assetPath = pathname.startsWith('/admin/assets/')
    ? pathname
    : '/admin/index.html';
  return c.env.ASSETS.fetch(new Request(new URL(assetPath, c.req.url).toString(), c.req.raw));
});

// ── Webhooks & subscriptions (mounted after admin to avoid conflicts) ───
app.route('/', webhookApi);

// ── 404 fallback ─────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await Promise.allSettled(
      batch.messages.map(async (msg) => {
        const body = msg.body as { pieceName?: string; payload?: unknown };
        const { pieceName, payload } = body;
        if (!pieceName) {
          msg.ack();
          return;
        }
        const stored = getPiece(pieceName);
        if (!stored || stored.kind !== 'ap') {
          msg.ack();
          return;
        }
        await dispatchWebhook(pieceName, stored.piece, payload, env);
        msg.ack();
      }),
    );
  },
} satisfies ExportedHandler<Env>;
