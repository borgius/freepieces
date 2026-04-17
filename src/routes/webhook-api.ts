/**
 * Webhook route handlers: inbound webhooks and subscription management.
 * Mounted at / in the main worker (routes are /webhook/* and /subscriptions/*).
 */

import { Hono } from 'hono';
import { getPiece, getTrigger } from '../framework/registry';
import { runtimeAuth } from '../lib/runtime-auth-middleware';
import {
  dispatchWebhook,
  listSubscriptions,
  verifySlackSignature,
  resolveQueueBinding,
  sameSubscriptionOwner,
  SUB_KEY,
} from '../lib/webhook';
import type { WebhookSubscription } from '../lib/webhook';
import type { Env } from '../framework/types';
import type { RuntimeRequestCredentials } from '../lib/request-auth';
import { getEnvStr, requireKVBinding } from '../lib/env';

const webhookApi = new Hono<{
  Bindings: Env;
  Variables: { credentials: RuntimeRequestCredentials };
}>();

// ── Inbound webhook (Slack Events API and equivalents) ──────────────────
webhookApi.post('/webhook/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored || stored.kind !== 'ap') {
    return c.json({ error: 'Piece not found or not an AP piece' }, 404);
  }
  const { piece } = stored;

  // Read raw body text before parsing (needed for HMAC verification)
  const rawBody = await c.req.text();

  // Verify Slack signature when the signing secret is configured
  const signingSecretKey = `${pieceName.toUpperCase().replace(/-/g, '_')}_SIGNING_SECRET`;
  const signingSecret = getEnvStr(c.env, signingSecretKey);
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
webhookApi.use('/subscriptions/*', runtimeAuth);

// POST /subscriptions/:piece/:trigger
webhookApi.post('/subscriptions/:piece/:trigger', async (c) => {
  const pieceName = c.req.param('piece');
  const triggerName = c.req.param('trigger');

  const stored = getPiece(pieceName);
  if (!stored || stored.kind !== 'ap') {
    return c.json({ error: 'Piece not found or not an AP piece' }, 404);
  }
  if (!getTrigger(pieceName, triggerName)) {
    return c.json({ error: 'Trigger not found' }, 404);
  }

  const { userId, pieceToken, pieceAuthProps } = c.var.credentials;

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
  await requireKVBinding(c.env, 'TOKEN_STORE').put(SUB_KEY(pieceName, subId), JSON.stringify(sub));

  const webhookUrl = `${getEnvStr(c.env, 'PUBLIC_URL')}/webhook/${pieceName}`;
  return c.json({ ok: true, id: subId, webhookUrl }, 201);
});

// GET /subscriptions/:piece (returns only caller's subscriptions)
webhookApi.get('/subscriptions/:piece', async (c) => {
  const pieceName = c.req.param('piece');

  const allSubs = await listSubscriptions(requireKVBinding(c.env, 'TOKEN_STORE'), pieceName);
  const mine = allSubs
    .filter((s) => sameSubscriptionOwner(s, c.var.credentials))
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
webhookApi.delete('/subscriptions/:piece/:trigger/:id', async (c) => {
  const pieceName = c.req.param('piece');
  const subDelId = c.req.param('id');

  const rawSub = await requireKVBinding(c.env, 'TOKEN_STORE').get(SUB_KEY(pieceName, subDelId));
  if (!rawSub) return c.json({ error: 'Subscription not found' }, 404);

  const existingSub = JSON.parse(rawSub) as WebhookSubscription;
  if (!sameSubscriptionOwner(existingSub, c.var.credentials)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await requireKVBinding(c.env, 'TOKEN_STORE').delete(SUB_KEY(pieceName, subDelId));
  return c.json({ ok: true, id: subDelId });
});

export default webhookApi;
