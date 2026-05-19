/**
 * Webhook route handlers: inbound webhooks and subscription management.
 * Mounted at / in the main worker (routes are /webhook/* and /subscriptions/*).
 */

import { Hono } from 'hono';
import { getPiece, getTrigger, isTriggerWebhookCapable } from '../framework/registry';
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
import type { Env, PieceTrigger, ApTrigger } from '../framework/types';
import type { RuntimeRequestCredentials } from '../lib/request-auth';
import { getEnvStr, requireKVBinding } from '../lib/env';
import { buildNativeTriggerContext, buildApTriggerContext } from '../lib/ap-context';
import { resolveNativeRuntimeAuth, resolveApRuntimeAuth } from '../lib/auth-resolve';

const webhookApi = new Hono<{
  Bindings: Env;
  Variables: { credentials: RuntimeRequestCredentials };
}>();

// ---------------------------------------------------------------------------
// Lifecycle context builder
//
// Builds the right trigger context shape for onEnable/onDisable calls.
// Native pieces get PieceTriggerContext; AP pieces get an AP-shaped context.
// ---------------------------------------------------------------------------
async function buildLifecycleContext(
  pieceName: string,
  triggerName: string,
  stored: ReturnType<typeof getPiece>,
  userId: string | undefined,
  pieceToken: string | undefined,
  pieceAuthProps: Record<string, string> | undefined,
  propsValue: Record<string, unknown>,
  env: Env,
): Promise<unknown> {
  if (!stored) return {};

  if (stored.kind === 'native') {
    let auth = await resolveNativeRuntimeAuth(pieceName, stored.def.auth, env, userId, pieceToken);
    if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };
    return buildNativeTriggerContext(pieceName, triggerName, auth, propsValue, userId, env);
  }

  // AP piece
  let auth = await resolveApRuntimeAuth(pieceName, stored.piece, env, userId, pieceToken);
  if (pieceAuthProps) auth = { ...auth, ...pieceAuthProps };
  return buildApTriggerContext(pieceName, stored.piece, auth, propsValue, {}, env, userId);
}

// ── Inbound webhook (Slack Events API and equivalents) ──────────────────
webhookApi.post('/webhook/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored) {
    return c.json({ error: 'Piece not found' }, 404);
  }

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
    dispatchWebhook(pieceName, webhookBody, c.env).catch((err: unknown) =>
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
  if (!stored) {
    return c.json({ error: 'Piece not found' }, 404);
  }
  const triggerDef = getTrigger(pieceName, triggerName);
  if (!triggerDef) {
    return c.json({ error: 'Trigger not found' }, 404);
  }
  if (!isTriggerWebhookCapable(pieceName, triggerName)) {
    return c.json({ error: 'Trigger does not support webhook subscriptions (strategy is not WEBHOOK or APP_WEBHOOK)' }, 400);
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
  const webhookUrl = `${getEnvStr(c.env, 'PUBLIC_URL')}/webhook/${pieceName}`;
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

  // Invoke onEnable lifecycle hook (webhook registration with upstream provider)
  if (triggerDef.onEnable) {
    try {
      const enableCtx = await buildLifecycleContext(
        pieceName, triggerName, stored, userId, pieceToken, pieceAuthProps, propsValue, c.env,
      );
      await (triggerDef.onEnable as (ctx: unknown) => Promise<void>)(enableCtx);
    } catch (err) {
      console.error(`[freepieces] onEnable for ${pieceName}/${triggerName} failed:`, err);
    }
  }

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

  // Invoke onDisable lifecycle hook (webhook unregistration from upstream provider)
  const triggerDef = getTrigger(pieceName, existingSub.trigger);
  if (triggerDef?.onDisable) {
    const stored = getPiece(pieceName);
    const { userId, pieceToken, pieceAuthProps } = c.var.credentials;
    try {
      const disableCtx = await buildLifecycleContext(
        pieceName, existingSub.trigger, stored, userId, pieceToken, pieceAuthProps,
        existingSub.propsValue, c.env,
      );
      await (triggerDef.onDisable as (ctx: unknown) => Promise<void>)(disableCtx);
    } catch (err) {
      console.error(`[freepieces] onDisable for ${pieceName}/${existingSub.trigger} failed:`, err);
    }
  }

  return c.json({ ok: true, id: subDelId });
});

export default webhookApi;
