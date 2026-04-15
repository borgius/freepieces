/** Cloudflare Workers entrypoint for freepieces. */

import { Hono } from 'hono';
import { listPieces, getPiece, getTrigger } from './framework/registry';
import { buildCallbackUrl } from './framework/auth';
import {
  buildLoginUrl,
  handleCallback,
  resolveOAuthClientCredentials,
} from './lib/oauth';
import { storeToken } from './lib/token-store';
import { createSessionToken, timingSafeEqual } from './lib/admin-session';
import { resolveRuntimeRequestAuth } from './lib/request-auth';
import { buildApContext, buildApTriggerContext } from './lib/ap-context';
import { resolveNativeRuntimeAuth, resolveApRuntimeAuth } from './lib/auth-resolve';
import {
  dispatchWebhook,
  listSubscriptions,
  verifySlackSignature,
  resolveQueueBinding,
  sameSubscriptionOwner,
  SUB_KEY,
} from './lib/webhook';
import type { WebhookSubscription } from './lib/webhook';
import { buildCookie } from './lib/admin-config';
import adminApi from './routes/admin-api';
import './pieces/index.js';
import type { Env, OAuth2AuthDefinition, OAuthTokenRecord, PieceTriggerContext } from './framework/types';

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

// ── OAuth2 login start ───────────────────────────────────────────────────
app.get('/auth/login/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);
  if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
    return c.json({ error: 'Piece does not use OAuth2' }, 400);
  }

  const userId = c.req.query('userId');
  if (!userId) return c.json({ error: 'Missing userId query parameter' }, 400);

  const callbackUrl = buildCallbackUrl(c.env.FREEPIECES_PUBLIC_URL, pieceName);
  const authDef = stored.def.auth as OAuth2AuthDefinition;
  let clientId: string;
  try {
    ({ clientId } = resolveOAuthClientCredentials(authDef, c.env));
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'OAuth client credentials not configured' },
      503,
    );
  }
  const loginUrl = await buildLoginUrl(authDef, {
    pieceName,
    callbackUrl,
    clientId,
    encryptionKey: c.env.TOKEN_ENCRYPTION_KEY,
    userId,
  });

  return c.redirect(loginUrl, 302);
});

// ── OAuth2 callback ──────────────────────────────────────────────────────
app.get('/auth/callback/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);
  if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
    return c.json({ error: 'Piece does not use OAuth2' }, 400);
  }

  try {
    const url = new URL(c.req.url);
    const callbackUrl = buildCallbackUrl(c.env.FREEPIECES_PUBLIC_URL, pieceName);
    const { userId } = await handleCallback(
      url.searchParams,
      stored.def.auth as OAuth2AuthDefinition,
      c.env,
      callbackUrl,
    );
    return c.json({
      ok: true,
      message: 'Token stored successfully. You may close this window.',
      userId,
    });
  } catch (err) {
    console.error('[freepieces] OAuth callback error:', err);
    const status =
      err instanceof Error && err.message.startsWith('Missing OAuth client credentials')
        ? 503
        : 400;
    const isKnownError =
      err instanceof Error &&
      (err.message.startsWith('Missing') ||
        err.message.startsWith('Invalid') ||
        err.message.startsWith('Token exchange'));
    const message = isKnownError && err instanceof Error
      ? err.message
      : 'OAuth callback failed';
    return c.json({ error: message }, status);
  }
});

// ── Seed tokens (admin-protected, Basic auth) ─────────────────────────
app.post('/auth/tokens/:piece', async (c) => {
  if (!c.env.ADMIN_USER || !c.env.ADMIN_PASSWORD) {
    return c.json({ error: 'Admin credentials not configured' }, 503);
  }
  const authHeader = c.req.header('authorization') ?? '';
  let authed = false;
  if (authHeader.startsWith('Basic ')) {
    const decoded = atob(authHeader.slice(6));
    const colonIdx = decoded.indexOf(':');
    if (colonIdx > 0) {
      const user = decoded.slice(0, colonIdx);
      const pass = decoded.slice(colonIdx + 1);
      authed = timingSafeEqual(user, c.env.ADMIN_USER) && timingSafeEqual(pass, c.env.ADMIN_PASSWORD);
    }
  }
  if (!authed) return c.json({ error: 'Unauthorized' }, 401);

  const pieceName = c.req.param('piece');
  if (!getPiece(pieceName)) return c.json({ error: 'Piece not found' }, 404);

  let body: { userId?: string; accessToken?: string; refreshToken?: string; expiresIn?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { userId, accessToken, refreshToken, expiresIn } = body;
  if (!userId || !accessToken) {
    return c.json({ error: 'Missing required fields: userId, accessToken' }, 400);
  }

  const record: OAuthTokenRecord = {
    accessToken,
    refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    tokenType: 'Bearer',
  };
  await storeToken(c.env.TOKEN_STORE, pieceName, userId, record, c.env.TOKEN_ENCRYPTION_KEY);
  return c.json({ ok: true, piece: pieceName, userId });
});

// ── Run action ───────────────────────────────────────────────────────────
app.all('/run/:piece/:action', async (c) => {
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
app.post('/trigger/:piece/:trigger', async (c) => {
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

// ── Admin SPA redirect ──────────────────────────────────────────────────
app.get('/admin', (c) => c.redirect('/admin/', 301));

// ── Admin API – unauthenticated ──────────────────────────────────────────
app.post('/admin/api/login', async (c) => {
  if (!c.env.ADMIN_USER || !c.env.ADMIN_PASSWORD || !c.env.ADMIN_SIGNING_KEY) {
    return c.json({ error: 'Admin credentials not configured' }, 503);
  }
  let body: { username?: string; password?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { username = '', password = '' } = body;
  const validUser = timingSafeEqual(username, c.env.ADMIN_USER);
  const validPass = timingSafeEqual(password, c.env.ADMIN_PASSWORD);
  if (!validUser || !validPass) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }
  const token = await createSessionToken(username, c.env.ADMIN_SIGNING_KEY);
  const isSecure = c.req.url.startsWith('https://');
  c.header('set-cookie', buildCookie(token, isSecure, 86400));
  return c.json({ ok: true });
});

app.post('/admin/api/logout', (c) => {
  const isSecure = c.req.url.startsWith('https://');
  c.header('set-cookie', buildCookie('', isSecure, 0));
  return c.json({ ok: true });
});

// ── Admin API – authenticated (sub-app with session middleware) ──────────
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

// ── Inbound webhook (Slack Events API and equivalents) ──────────────────
app.post('/webhook/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored || stored.kind !== 'ap') {
    return c.json({ error: 'Piece not found or not an AP piece' }, 404);
  }
  const { piece } = stored;

  // Read raw body text before parsing (needed for HMAC verification)
  const rawBody = await c.req.text();

  // Verify Slack signature when the signing secret is configured
  const envRecord = c.env as Record<string, string>;
  const signingSecretKey = `${pieceName.toUpperCase().replace(/-/g, '_')}_SIGNING_SECRET`;
  const signingSecret = envRecord[signingSecretKey] as string | undefined;
  if (signingSecret) {
    const timestamp = c.req.header('x-slack-request-timestamp') ?? '';
    const signature = c.req.header('x-slack-signature') ?? '';
    const valid = await verifySlackSignature(signingSecret, rawBody, timestamp, signature);
    if (!valid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }
  }

  let webhookBody: Record<string, unknown>;
  try {
    webhookBody = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Slack URL verification — must reply synchronously with the challenge value
  if (webhookBody['type'] === 'url_verification') {
    return c.json({ challenge: webhookBody['challenge'] });
  }

  // Fan out asynchronously so we can return 200 within Slack's 3-second window
  c.executionCtx.waitUntil(
    dispatchWebhook(pieceName, piece, webhookBody, c.env).catch((err: unknown) =>
      console.error('[freepieces] dispatchWebhook error:', err),
    ),
  );
  return c.text('OK', 200);
});

// ── Webhook subscriptions ─────────────────────────────────────────────────

// POST /subscriptions/:piece/:trigger
app.post('/subscriptions/:piece/:trigger', async (c) => {
  const pieceName = c.req.param('piece');
  const triggerName = c.req.param('trigger');

  const stored = getPiece(pieceName);
  if (!stored || stored.kind !== 'ap') {
    return c.json({ error: 'Piece not found or not an AP piece' }, 404);
  }
  if (!getTrigger(pieceName, triggerName)) {
    return c.json({ error: 'Trigger not found' }, 404);
  }

  const authResult = resolveRuntimeRequestAuth(c.req.raw.headers, c.env.RUN_API_KEY);
  if (!authResult.ok) {
    return c.json({ error: authResult.error }, authResult.status);
  }
  const { userId, pieceToken, pieceAuthProps } = authResult.credentials;

  let subBody: { callbackUrl?: string; queueName?: string; propsValue?: Record<string, unknown> };
  try {
    subBody = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { callbackUrl, queueName, propsValue = {} } = subBody;

  // Exactly one delivery target required
  if (callbackUrl && queueName) {
    return c.json({ error: 'Provide either callbackUrl or queueName, not both' }, 400);
  }
  if (!callbackUrl && !queueName) {
    return c.json({ error: 'Missing required field: callbackUrl or queueName' }, 400);
  }

  // Validate callbackUrl (HTTPS only to mitigate SSRF)
  if (callbackUrl) {
    try {
      const parsed = new URL(callbackUrl);
      if (parsed.protocol !== 'https:') throw new Error();
    } catch {
      return c.json({ error: 'callbackUrl must be a valid HTTPS URL' }, 400);
    }
  }

  // Validate queueName binding exists in env
  if (queueName) {
    if (!resolveQueueBinding(c.env, queueName)) {
      return c.json(
        { error: `Queue binding not found for "${queueName}". Add a [[queues.producers]] entry to wrangler.toml.` },
        400,
      );
    }
  }

  const subId = crypto.randomUUID();
  const sub: WebhookSubscription = {
    id: subId,
    trigger: triggerName,
    propsValue,
    ...(callbackUrl ? { callbackUrl } : { queueName }),
    userId,
    pieceToken,
    ...(pieceAuthProps ? { pieceAuthProps } : {}),
    createdAt: new Date().toISOString(),
  };
  await c.env.TOKEN_STORE.put(SUB_KEY(pieceName, subId), JSON.stringify(sub));

  const webhookUrl = `${c.env.FREEPIECES_PUBLIC_URL}/webhook/${pieceName}`;
  return c.json({ ok: true, id: subId, webhookUrl }, 201);
});

// GET /subscriptions/:piece (returns only caller's subscriptions)
app.get('/subscriptions/:piece', async (c) => {
  const pieceName = c.req.param('piece');

  const authResult = resolveRuntimeRequestAuth(c.req.raw.headers, c.env.RUN_API_KEY);
  if (!authResult.ok) {
    return c.json({ error: authResult.error }, authResult.status);
  }

  const allSubs = await listSubscriptions(c.env.TOKEN_STORE, pieceName);
  const mine = allSubs
    .filter((s) => sameSubscriptionOwner(s, authResult.credentials))
    .map((s) => ({
      id: s.id,
      trigger: s.trigger,
      propsValue: s.propsValue,
      ...(s.callbackUrl ? { callbackUrl: s.callbackUrl } : {}),
      ...(s.queueName ? { queueName: s.queueName } : {}),
      createdAt: s.createdAt,
    }));
  return c.json({ ok: true, subscriptions: mine });
});

// DELETE /subscriptions/:piece/:trigger/:id (must match creation identity)
app.delete('/subscriptions/:piece/:trigger/:id', async (c) => {
  const pieceName = c.req.param('piece');
  const subDelId = c.req.param('id');

  const authResult = resolveRuntimeRequestAuth(c.req.raw.headers, c.env.RUN_API_KEY);
  if (!authResult.ok) {
    return c.json({ error: authResult.error }, authResult.status);
  }

  const rawSub = await c.env.TOKEN_STORE.get(SUB_KEY(pieceName, subDelId));
  if (!rawSub) return c.json({ error: 'Subscription not found' }, 404);

  const existingSub = JSON.parse(rawSub) as WebhookSubscription;
  if (!sameSubscriptionOwner(existingSub, authResult.credentials)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.TOKEN_STORE.delete(SUB_KEY(pieceName, subDelId));
  return c.json({ ok: true, id: subDelId });
});

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
