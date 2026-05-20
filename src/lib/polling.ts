/**
 * POLLING trigger runner.
 *
 * Called from the Cloudflare Worker `scheduled` handler (cron) and the
 * Linux server polling interval.  For every registered piece that has
 * POLLING triggers with active subscriptions, it runs the trigger's
 * `run()` method and delivers any returned events to the subscription's
 * callbackUrl or Cloudflare Queue — exactly like `dispatchWebhook` does
 * for WEBHOOK/APP_WEBHOOK triggers.
 */

import { listPieces, getPiece, getTrigger } from '../framework/registry';
import { listSubscriptions, resolveQueueBinding } from './webhook';
import { resolveApRuntimeAuth, resolveNativeRuntimeAuth } from './auth-resolve';
import { buildApTriggerContext, buildNativeTriggerContext } from './ap-context';
import { requireKVBinding } from './env';
import type { Env, PieceTriggerContext } from '../framework/types';

/** KV key for the per-subscription last-poll timestamp (ms epoch). */
const POLL_MS_KEY = (subId: string): string => `poll_ms:${subId}`;

/**
 * Run every POLLING trigger that has at least one active subscription.
 * Safe to call concurrently — each piece+trigger pair is independent.
 */
export async function runAllPollingTriggers(env: Env): Promise<void> {
  const kv = requireKVBinding(env, 'TOKEN_STORE');
  const pieces = listPieces();

  await Promise.allSettled(
    pieces.flatMap((entry) =>
      entry.triggers
        .filter((t) => t.type === 'POLLING')
        .map((t) => pollPieceTrigger(entry.name, t.name, kv, env)),
    ),
  );
}

async function pollPieceTrigger(
  pieceName: string,
  triggerName: string,
  kv: KVNamespace,
  env: Env,
): Promise<void> {
  const stored = getPiece(pieceName);
  if (!stored) return;
  const triggerDef = getTrigger(pieceName, triggerName);
  if (!triggerDef) return;

  const subs = (await listSubscriptions(kv, pieceName)).filter((s) => s.trigger === triggerName);
  if (subs.length === 0) return;

  await Promise.allSettled(
    subs.map(async (sub) => {
      // Restore per-subscription cursor
      const lastMsRaw = await kv.get(POLL_MS_KEY(sub.id));
      const lastPollMs = lastMsRaw ? Number(lastMsRaw) : 0;

      // Resolve auth
      let auth: Record<string, string> | undefined;
      try {
        auth =
          stored.kind === 'ap'
            ? await resolveApRuntimeAuth(pieceName, stored.piece, env, sub.userId, sub.pieceToken)
            : await resolveNativeRuntimeAuth(pieceName, stored.def.auth, env, sub.userId, sub.pieceToken);
        if (sub.pieceAuthProps) auth = { ...auth, ...sub.pieceAuthProps };
      } catch {
        return; // auth failed — skip this sub
      }

      // Build context and inject the cursor
      let ctx: PieceTriggerContext;
      if (stored.kind === 'ap') {
        const raw = buildApTriggerContext(
          pieceName,
          stored.piece,
          auth,
          sub.propsValue,
          null,
          env,
          sub.userId,
        ) as PieceTriggerContext;
        ctx = { ...raw, lastPollMs };
      } else {
        ctx = {
          ...buildNativeTriggerContext(
            pieceName,
            sub.trigger,
            auth,
            sub.propsValue,
            sub.userId,
            env,
          ),
          lastPollMs,
        };
      }

      // Run the trigger — returns new events since lastPollMs
      let events: unknown[];
      try {
        events = await (triggerDef as { run(ctx: unknown): Promise<unknown[]> }).run(ctx);
      } catch {
        return; // trigger threw — skip delivery but don't update cursor
      }

      // Advance the cursor regardless of whether there were events,
      // so the next run doesn't re-scan the same window.
      await kv.put(POLL_MS_KEY(sub.id), String(Date.now()));

      if (events.length === 0) return;

      const payload = { piece: pieceName, trigger: triggerName, events };

      if (sub.queueName) {
        const queue = resolveQueueBinding(env, sub.queueName);
        if (!queue) {
          console.error(
            `[freepieces] Poll: queue binding not found for "${sub.queueName}"`,
          );
          return;
        }
        await queue.send(payload).catch((err: unknown) => {
          console.error(`[freepieces] Poll: queue delivery failed:`, err);
        });
        return;
      }

      if (sub.callbackUrl) {
        await fetch(sub.callbackUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch((err: unknown) => {
          console.error(`[freepieces] Poll: HTTP delivery to ${sub.callbackUrl} failed:`, err);
        });
      }
    }),
  );
}
