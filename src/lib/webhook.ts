/**
 * Webhook subscription storage, dispatch, and signature verification.
 */

import { getTrigger } from '../framework/registry';
import { timingSafeEqual } from './admin-session';
import { resolveApRuntimeAuth } from './auth-resolve';
import { buildApTriggerContext } from './ap-context';
import type { Env, ApPiece } from '../framework/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookSubscription {
  id: string;
  trigger: string;
  propsValue: Record<string, unknown>;
  /** URL to POST matched events to. Must be HTTPS. Mutually exclusive with `queueName`. */
  callbackUrl?: string;
  /**
   * Cloudflare Queue name to deliver matched events to instead of an HTTP callback.
   * The queue producer binding must exist in wrangler.toml as `QUEUE_<UPPER_SNAKE>`.
   * For example, `queueName: "slack-new-message"` resolves to env binding `QUEUE_SLACK_NEW_MESSAGE`.
   * Mutually exclusive with `callbackUrl`.
   */
  queueName?: string;
  /** @deprecated Legacy single-field runtime auth from older subscription records. */
  bearerToken?: string;
  /** OAuth2 KV lookup key, when the trigger runs under a stored user token. */
  userId?: string;
  /** Direct runtime credential for API-key / CUSTOM_AUTH trigger execution. */
  pieceToken?: string;
  /** Per-subscription CUSTOM_AUTH prop overrides, captured from X-Piece-Auth at subscribe time. */
  pieceAuthProps?: Record<string, string>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// KV key helpers
// ---------------------------------------------------------------------------

/** KV key for a single subscription record. */
export const SUB_KEY = (piece: string, id: string): string => `sub:${piece}:${id}`;
/** KV list prefix for all subscriptions of a piece. */
export const SUB_PREFIX = (piece: string): string => `sub:${piece}:`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sameSubscriptionOwner(
  sub: Pick<WebhookSubscription, 'userId' | 'pieceToken'>,
  owner: { userId?: string; pieceToken?: string },
): boolean {
  const legacy = (sub as WebhookSubscription).bearerToken;
  const subUserId = sub.userId ?? legacy;
  const subPieceToken = sub.pieceToken ?? legacy;
  return subUserId === owner.userId && subPieceToken === owner.pieceToken;
}

/**
 * Verify a Slack (or compatible) HMAC-SHA256 request signature.
 * Rejects requests older than 5 minutes to prevent replay attacks.
 */
export async function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): Promise<boolean> {
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const baseStr = `v0:${timestamp}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseStr));
  const computed = 'v0=' + Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(computed, signature);
}

/** Load all subscriptions for a piece from KV. */
export async function listSubscriptions(kv: KVNamespace, piece: string): Promise<WebhookSubscription[]> {
  const { keys } = await kv.list({ prefix: SUB_PREFIX(piece) });
  const subs: WebhookSubscription[] = [];
  for (const key of keys) {
    const raw = await kv.get(key.name);
    if (raw) {
      try { subs.push(JSON.parse(raw) as WebhookSubscription); } catch { /* skip corrupt */ }
    }
  }
  return subs;
}

/**
 * Resolve a Cloudflare Queue producer binding from the environment.
 * Convention: `queueName` "slack-new-message" → env binding "QUEUE_SLACK_NEW_MESSAGE".
 */
export function resolveQueueBinding(env: Env, queueName: string): Queue | undefined {
  const bindingName = 'QUEUE_' + queueName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return env[bindingName] as Queue | undefined;
}

/**
 * Fan-out an inbound webhook payload to all active subscriptions for a piece.
 * For each subscription, runs the trigger's run() filter and delivers matched
 * events to the subscription's callbackUrl or Cloudflare Queue.  Best-effort:
 * individual delivery failures are logged but do not affect other subscriptions.
 */
export async function dispatchWebhook(
  pieceName: string,
  piece: ApPiece,
  payload: unknown,
  env: Env,
): Promise<void> {
  const subs = await listSubscriptions(env.TOKEN_STORE, pieceName);
  await Promise.allSettled(
    subs.map(async (sub) => {
      const triggerDef = getTrigger(pieceName, sub.trigger);
      if (!triggerDef) return;

      let auth = await resolveApRuntimeAuth(
        pieceName,
        piece,
        env,
        sub.userId ?? sub.bearerToken,
        sub.pieceToken ?? sub.bearerToken,
      );
      if (sub.pieceAuthProps) auth = { ...auth, ...sub.pieceAuthProps };

      let events: unknown[];
      try {
        const trigCtx = buildApTriggerContext(pieceName, piece, auth, sub.propsValue, payload, env);
        events = await (triggerDef as { run(ctx: unknown): Promise<unknown[]> }).run(trigCtx);
      } catch {
        return; // trigger filter threw — skip
      }

      if (events.length === 0) return;

      const eventPayload = { piece: pieceName, trigger: sub.trigger, events };

      // Deliver to Cloudflare Queue when queueName is set
      if (sub.queueName) {
        const queue = resolveQueueBinding(env, sub.queueName);
        if (!queue) {
          console.error(`[freepieces] Queue binding not found for "${sub.queueName}". Add [[queues.producers]] to wrangler.toml.`);
          return;
        }
        await queue.send(eventPayload).catch((err: unknown) => {
          console.error(`[freepieces] Queue delivery to "${sub.queueName}" failed:`, err);
        });
        return;
      }

      // POST matched events to the subscriber's callback URL (best-effort)
      if (sub.callbackUrl) {
        await fetch(sub.callbackUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(eventPayload),
        }).catch((err: unknown) => {
          console.error(`[freepieces] Delivery to ${sub.callbackUrl} failed:`, err);
        });
      }
    }),
  );
}
