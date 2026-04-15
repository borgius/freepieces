/**
 * Runtime route handlers: action execution and trigger invocation.
 * Mounted at / in the main worker (routes are /run/* and /trigger/*).
 */

import { Hono } from 'hono';
import { getPiece, getTrigger } from '../framework/registry';
import { resolveRuntimeRequestAuth } from '../lib/request-auth';
import { buildApContext, buildApTriggerContext } from '../lib/ap-context';
import { resolveNativeRuntimeAuth, resolveApRuntimeAuth } from '../lib/auth-resolve';
import type { Env, PieceTriggerContext } from '../framework/types';

const runtimeApi = new Hono<{ Bindings: Env }>();

// ── Run action ───────────────────────────────────────────────────────────
runtimeApi.all('/run/:piece/:action', async (c) => {
  const pieceName = c.req.param('piece');
  const actionName = c.req.param('action');
  const stored = getPiece(pieceName);
  if (!stored) {
    return c.json({ error: 'Action not found' }, 404);
  }

  const authResult = resolveRuntimeRequestAuth(c.req.raw.headers, c.env.RUN_API_KEY);
  if (!authResult.ok) {
    return c.json({ error: authResult.error }, authResult.status);
  }
  const { userId, pieceToken, pieceAuthProps } = authResult.credentials;

  let auth: Record<string, string> | undefined;

  // Parse request body
  let props: Record<string, unknown> = {};
  if (c.req.method === 'POST') {
    try {
      props = await c.req.json();
    } catch {
      // non-JSON body is fine; props stay empty
    }
  }

  try {
    let result: unknown;

    if (stored.kind === 'native') {
      const piece = stored.def;
      const action = piece.actions.find((a) => a.name === actionName);
      if (!action) {
        return c.json({ error: 'Action not found' }, 404);
      }

      auth = await resolveNativeRuntimeAuth(pieceName, piece.auth, c.env, userId, pieceToken);
      if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };

      result = await action.run({ auth, props, env: c.env });

    } else {
      const { piece } = stored;
      const action = piece._actions[actionName];
      if (!action) {
        return c.json({ error: 'Action not found' }, 404);
      }

      auth = await resolveApRuntimeAuth(pieceName, piece, c.env, userId, pieceToken);
      if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };

      const apCtx = buildApContext(pieceName, piece, auth, props, c.env);
      result = await action.run(apCtx);
    }

    return c.json({ ok: true, result });
  } catch (err) {
    console.error(`[freepieces] Action ${pieceName}/${actionName} failed:`, err);
    return c.json({ ok: false, error: 'Action execution failed' }, 500);
  }
});

// ── Run trigger ─────────────────────────────────────────────────────────
runtimeApi.post('/trigger/:piece/:trigger', async (c) => {
  const pieceName = c.req.param('piece');
  const triggerName = c.req.param('trigger');

  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);

  const trigger = getTrigger(pieceName, triggerName);
  if (!trigger) return c.json({ error: 'Trigger not found' }, 404);

  let body: { payload?: unknown; propsValue?: Record<string, unknown> } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const authResult = resolveRuntimeRequestAuth(c.req.raw.headers, c.env.RUN_API_KEY);
  if (!authResult.ok) {
    return c.json({ error: authResult.error }, authResult.status);
  }
  const { userId, pieceToken, pieceAuthProps } = authResult.credentials;

  try {
    if (stored.kind === 'native') {
      const nativeTrigger = stored.def.triggers?.find((t) => t.name === triggerName);
      if (!nativeTrigger) return c.json({ error: 'Trigger not found' }, 404);

      let nativeAuth = await resolveNativeRuntimeAuth(pieceName, stored.def.auth, c.env, userId, pieceToken);
      if (pieceAuthProps) nativeAuth = { ...nativeAuth, ...pieceAuthProps };

      const nativeCtx: PieceTriggerContext = {
        auth: nativeAuth,
        props: body.propsValue ?? {},
        lastPollMs: typeof (body as Record<string, unknown>).lastPollMs === 'number'
          ? (body as Record<string, unknown>).lastPollMs as number
          : 0,
        env: c.env,
      };
      const events = await nativeTrigger.run(nativeCtx);
      return c.json({ ok: true, events });
    }

    if (stored.kind !== 'ap') {
      return c.json({ error: 'Piece does not support triggers' }, 400);
    }

    let auth = await resolveApRuntimeAuth(pieceName, stored.piece, c.env, userId, pieceToken);
    if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };
    const ctx = buildApTriggerContext(
      pieceName,
      stored.piece,
      auth,
      body.propsValue ?? {},
      body.payload ?? {},
      c.env,
    );
    const events = await (trigger as { run(ctx: unknown): Promise<unknown[]> }).run(ctx);
    return c.json({ ok: true, events });
  } catch (err) {
    console.error(`[freepieces] Trigger ${pieceName}/${triggerName} failed:`, err);
    return c.json({ ok: false, error: 'Trigger execution failed' }, 500);
  }
});

export default runtimeApi;
