/**
 * Worker factory — creates a freepieces Hono app without any global side-effect
 * piece registrations.  Piece registration is the caller's responsibility:
 * import (or call) your piece file(s) before calling createFreepiecesWorker().
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { listPieces, getPiece } from '../framework/registry.js';
import { dispatchWebhook } from '../lib/webhook.js';
import adminApi from '../routes/admin-api.js';
import authApi from '../routes/auth-api.js';
import openauthApi from '../routes/openauth-api.js';
import runtimeApi from '../routes/runtime-api.js';
import webhookApi from '../routes/webhook-api.js';
import type { Env } from '../framework/types.js';

export interface FreepiecesWorker {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
  queue: (batch: MessageBatch, env: Env) => Promise<void>;
}

/**
 * Build the freepieces Hono application and return the worker export object.
 *
 * Pieces must be registered **before** this factory is called (or before the
 * first request is handled) using `registerPiece` / `registerApPiece` from
 * `freepieces/framework`.
 *
 * @example
 * ```ts
 * import { createFreepiecesWorker } from 'freepieces/worker';
 * import './pieces/index.js'; // registers your pieces as a side effect
 * export default createFreepiecesWorker();
 * ```
 */
export function createFreepiecesWorker(): FreepiecesWorker {
  const app = new Hono<{ Bindings: Env }>();

  // ── Security headers ────────────────────────────────────────────────────
  app.use(secureHeaders());

  // ── Error handling ──────────────────────────────────────────────────────
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      if (err.res) return err.getResponse();
      return c.json({ error: err.message }, err.status);
    }
    console.error('[freepieces] Unhandled error:', err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // ── Health ──────────────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ ok: true, service: 'freepieces', version: '0.1.0' }));

  // ── List pieces ─────────────────────────────────────────────────────────
  app.get('/pieces', (c) => {
    const res = c.json(
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
    );
    // Piece metadata only changes on deploy. Short cache lets repeated
    // client polls (admin UI, discovery) skip the full serialization path.
    res.headers.set('cache-control', 'public, max-age=60');
    return res;
  });

  // ── Domain sub-apps ─────────────────────────────────────────────────────
  app.route('/', openauthApi);
  app.route('/auth', authApi);
  app.route('/', runtimeApi);

  // ── Admin SPA redirect ──────────────────────────────────────────────────
  app.get('/', (c) => c.redirect('/admin/', 301));
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

  return {
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
}
