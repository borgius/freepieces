/**
 * Webhook subscription storage, dispatch, and signature verification.
 */

import { getPiece, getTrigger } from '../framework/registry';
import { timingSafeEqual } from './admin-session';
import { resolveApRuntimeAuth, resolveNativeRuntimeAuth } from './auth-resolve';
import { buildApTriggerContext, buildNativeTriggerContext } from './ap-context';
import type { Env } from '../framework/types';
import { getEnvStr, requireKVBinding } from './env';
import { isTriggerEnabledInState, loadUserToolState } from './user-tool-state';
import { applyJq } from './jq';
import { isNodeRuntime } from './cli-hook';

// ---------------------------------------------------------------------------
// HTTP method whitelist for callback delivery
// ---------------------------------------------------------------------------

/** HTTP methods allowed for callback delivery. */
export const WEBHOOK_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'GET'] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

/** Narrow an arbitrary value to a supported {@link WebhookMethod}. */
export function isWebhookMethod(value: unknown): value is WebhookMethod {
  return typeof value === 'string' && (WEBHOOK_METHODS as readonly string[]).includes(value);
}

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
  /**
   * Shell-free CLI command to run for each matched event, delivering the
   * (optionally jq-transformed) payload as JSON on stdin. Only executed on the
   * self-hosted Node.js runtime. Mutually exclusive with `callbackUrl`/`queueName`.
   */
  command?: string;
  /** Arguments for `command`. Values may contain `${ENV}` references. */
  args?: string[];
  /** Working directory for `command`. */
  cwd?: string;
  /** Kill the spawned `command` after this many milliseconds. */
  timeoutMs?: number;
  /**
   * HTTP method for `callbackUrl` delivery. Defaults to POST.
   * One of {@link WEBHOOK_METHODS}.
   */
  method?: WebhookMethod;
  /**
   * Extra request headers for `callbackUrl` delivery. Header *values* may embed
   * `${ENV}` references that are resolved against the worker env at dispatch
   * time, so secrets are never persisted on the subscription record.
   */
  headers?: Record<string, string>;
  /**
   * Standard jq program applied to the outbound `{ piece, trigger, events }`
   * envelope before delivery. When the program errors, delivery is skipped.
   */
  jqTransform?: string;
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
/** Global KV list prefix for all subscription records across all pieces. */
export const ALL_SUBS_PREFIX = 'sub:';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sameSubscriptionOwner(
  sub: Pick<WebhookSubscription, 'userId' | 'pieceToken' | 'pieceAuthProps'>,
  owner: { userId?: string; pieceToken?: string; pieceAuthProps?: Record<string, string> },
): boolean {
  const legacy = (sub as WebhookSubscription).bearerToken;
  const subUserId = sub.userId ?? legacy;
  const subPieceToken = sub.pieceToken ?? legacy;
  if (subUserId !== owner.userId || subPieceToken !== owner.pieceToken) return false;
  // For CUSTOM_AUTH identities, also match on pieceAuthProps so two identities
  // sharing the same userId/pieceToken but different credentials don't collapse.
  const subProps = sub.pieceAuthProps;
  const ownerProps = owner.pieceAuthProps;
  if (!subProps && !ownerProps) return true;
  if (!subProps || !ownerProps) return false;
  const subKeys = Object.keys(subProps).sort();
  const ownerKeys = Object.keys(ownerProps).sort();
  if (subKeys.length !== ownerKeys.length) return false;
  return subKeys.every((k, i) => k === ownerKeys[i] && subProps[k] === ownerProps[k]);
}

// ---------------------------------------------------------------------------
// Env / secret injection
// ---------------------------------------------------------------------------

/** Matches `${NAME}` references where NAME is a valid env identifier. */
const ENV_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Replace every `${NAME}` reference in `value` with the resolved env var,
 * looked up through {@link getEnvStr} (so `FREEPIECES_`/`FP_`/bare variants all
 * work). Unknown references resolve to an empty string. Used to inject env vars
 * and secrets into header values and CLI arguments at dispatch time.
 */
export function interpolateEnvRefs(value: string, env: Env): string {
  if (typeof value !== 'string' || value.indexOf('${') === -1) return value;
  return value.replace(ENV_REF_RE, (_match, name: string) => getEnvStr(env, name) ?? '');
}

/** Apply {@link interpolateEnvRefs} to every value of a headers map. */
export function resolveHeaderInjections(
  headers: Record<string, string> | undefined,
  env: Env,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  for (const [key, raw] of Object.entries(headers)) {
    out[key] = interpolateEnvRefs(raw, env);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Slack signature verification
// ---------------------------------------------------------------------------

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

/** Load all subscriptions for a piece from KV. Pages through all keys, fetches in parallel. */
export async function listSubscriptions(kv: KVNamespace, piece: string): Promise<WebhookSubscription[]> {
  const prefix = SUB_PREFIX(piece);
  const names: string[] = [];
  let cursor: string | undefined;

  // Walk every page so callers don't silently miss subs past the first KV list page.
  while (true) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    for (const key of page.keys) names.push(key.name);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  // Fetch all records in parallel instead of sequentially.
  const raws = await Promise.all(names.map((name) => kv.get(name)));
  const subs: WebhookSubscription[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try { subs.push(JSON.parse(raw) as WebhookSubscription); } catch { /* skip corrupt */ }
  }
  return subs;
}

/** A subscription record annotated with the piece name derived from its KV key. */
export interface AnnotatedSubscription {
  pieceName: string;
  sub: WebhookSubscription;
}

/**
 * Enumerate every subscription record across all pieces.
 * Derives `pieceName` from the KV key (`sub:{piece}:{id}`).
 * Pages through all KV keys and fetches records in parallel.
 */
export async function listAllSubscriptions(kv: KVNamespace): Promise<AnnotatedSubscription[]> {
  const prefix = ALL_SUBS_PREFIX;
  const names: string[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    for (const key of page.keys) names.push(key.name);
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  const raws = await Promise.all(names.map((name) => kv.get(name)));
  const result: AnnotatedSubscription[] = [];
  for (let i = 0; i < names.length; i++) {
    const raw = raws[i];
    if (!raw) continue;
    try {
      const sub = JSON.parse(raw) as WebhookSubscription;
      // Key format: sub:{piece}:{id}
      const parts = names[i].split(':');
      const pieceName = parts[1] ?? '';
      if (pieceName) result.push({ pieceName, sub });
    } catch { /* skip corrupt */ }
  }
  return result;
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
 * Works for both AP pieces and native pieces with WEBHOOK/APP_WEBHOOK triggers.
 * For each subscription, runs the trigger's run() filter and delivers matched
 * events to the subscription's callbackUrl or Cloudflare Queue.  Best-effort:
 * individual delivery failures are logged but do not affect other subscriptions.
 */
export async function dispatchWebhook(
  pieceName: string,
  payload: unknown,
  env: Env,
): Promise<void> {
  const stored = getPiece(pieceName);
  if (!stored) return;
  // Capture after null-check so nested closures see the narrowed StoredPiece type.
  const storedEntry = stored;
  const kv = requireKVBinding(env, 'TOKEN_STORE');

  const subs = await listSubscriptions(kv, pieceName);

  // Cache auth resolution per (userId, pieceToken) pair so 100 subs from the
  // same user don't each trigger a KV read + AES-GCM decrypt + refresh check.
  const authCache = new Map<string, Promise<Record<string, string> | undefined>>();
  const authFor = (userId: string | undefined, pieceToken: string | undefined): Promise<Record<string, string> | undefined> => {
    const key = `${userId ?? ''}|${pieceToken ?? ''}`;
    const cached = authCache.get(key);
    if (cached) return cached;
    const pending = storedEntry.kind === 'ap'
      ? resolveApRuntimeAuth(pieceName, storedEntry.piece, env, userId, pieceToken)
      : resolveNativeRuntimeAuth(pieceName, storedEntry.def.auth, env, userId, pieceToken);
    authCache.set(key, pending);
    return pending;
  };

  const toolStateCache = new Map<string, ReturnType<typeof loadUserToolState>>();
  function stateFor(userId: string | undefined): ReturnType<typeof loadUserToolState> {
    const key = userId ?? '';
    const cached = toolStateCache.get(key);
    if (cached) {
      return cached;
    }

    const pending = loadUserToolState(kv, userId, pieceName);
    toolStateCache.set(key, pending);
    return pending;
  }

  await Promise.allSettled(
    subs.map(async (sub) => {
      const triggerDef = getTrigger(pieceName, sub.trigger);
      if (!triggerDef) return;

      if (!isTriggerEnabledInState(await stateFor(sub.userId), sub.trigger)) {
        return;
      }

      const baseAuth = await authFor(
        sub.userId ?? sub.bearerToken,
        sub.pieceToken ?? sub.bearerToken,
      );
      const auth = sub.pieceAuthProps ? { ...baseAuth, ...sub.pieceAuthProps } : baseAuth;

      let events: unknown[];
      try {
        let trigCtx: unknown;
        if (storedEntry.kind === 'ap') {
          trigCtx = buildApTriggerContext(pieceName, storedEntry.piece, auth, sub.propsValue, payload, env, sub.userId);
        } else {
          trigCtx = buildNativeTriggerContext(pieceName, sub.trigger, auth, sub.propsValue, sub.userId, env);
          // Attach the inbound payload as context for native WEBHOOK/APP_WEBHOOK runs
          (trigCtx as Record<string, unknown>)['payload'] = payload;
        }
        events = await (triggerDef as { run(ctx: unknown): Promise<unknown[]> }).run(trigCtx);
      } catch {
        return; // trigger filter threw — skip
      }

      if (events.length === 0) return;

      const baseEnvelope = { piece: pieceName, trigger: sub.trigger, events };

      // Apply optional jq transform to the outbound payload. On any jq error,
      // skip delivery rather than sending the untransformed payload.
      let eventPayload: unknown = baseEnvelope;
      if (sub.jqTransform && sub.jqTransform.trim() !== '') {
        try {
          eventPayload = await applyJq(baseEnvelope, sub.jqTransform);
        } catch (err: unknown) {
          console.error(`[freepieces] jq transform failed for sub "${sub.id}":`, err);
          return;
        }
      }

      // Run a CLI command (Node runtime only)
      if (sub.command) {
        if (!isNodeRuntime()) {
          console.error(`[freepieces] CLI hook "${sub.command}" skipped: not supported on this runtime.`);
          return;
        }
        try {
          const { runCliHook } = await import('./cli-hook.js');
          await runCliHook({
            command: sub.command,
            args: (sub.args ?? []).map((a) => interpolateEnvRefs(a, env)),
            cwd: sub.cwd,
            timeoutMs: sub.timeoutMs,
            stdin: JSON.stringify(eventPayload),
          });
        } catch (err: unknown) {
          console.error(`[freepieces] CLI hook "${sub.command}" failed:`, err);
        }
        return;
      }

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
        const method = isWebhookMethod(sub.method) ? sub.method : 'POST';
        const headers: Record<string, string> = {
          'content-type': 'application/json',
          ...resolveHeaderInjections(sub.headers, env),
        };
        await fetch(sub.callbackUrl, {
          method,
          headers,
          body: JSON.stringify(eventPayload),
        }).catch((err: unknown) => {
          console.error(`[freepieces] Delivery to ${sub.callbackUrl} failed:`, err);
        });
      }
    }),
  );
}
