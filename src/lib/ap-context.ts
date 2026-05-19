/**
 * Activepieces execution-context builders.
 *
 * Constructs the context objects expected by AP action.run() and trigger.run()
 * from freepieces request data.
 */

import type { Env, ApPiece, PieceTriggerContext, TriggerStore } from '../framework/types';
import { getEnvStr, requireKVBinding } from './env';

/**
 * Build the execution context expected by @activepieces/pieces-framework
 * action.run() from the freepieces request data.
 *
 * Auth mapping by AP auth type:
 *   SECRET_TEXT  → the raw token string
 *   CUSTOM_AUTH  → object keyed by prop names, filled from env secrets
 *                  (env key = PIECENAME_PROPNAME, e.g. SLACK_BOT_TOKEN)
 *   OAUTH2       → { access_token, ... } from bearer / KV
 *   BASIC_AUTH   → { username, password } from env (PIECENAME_USERNAME, _PASSWORD)
 */
export function buildApContext(
  pieceName: string,
  piece: ApPiece,
  auth: Record<string, string> | undefined,
  props: Record<string, unknown>,
  env: Env,
): unknown {
  const envPrefix = pieceName.toUpperCase().replace(/-/g, '_');

  // Determine which auth type to use.  When auth is an array (multiple options),
  // prefer CUSTOM_AUTH when reading from env secrets (no bearer token present),
  // and prefer OAUTH2 when a bearer/access token has been passed in directly.
  const authDefs: Array<{ type: string; props?: Record<string, unknown> }> =
    Array.isArray(piece.auth) ? piece.auth : piece.auth ? [piece.auth] : [];

  // When the caller provides a token (via Bearer or KV lookup), OAUTH2 is the
  // natural fit.  When there is no runtime token, env-based CUSTOM_AUTH props
  // (e.g. SLACK_BOT_TOKEN) should take priority over an empty OAUTH2 slot.
  const hasToken = !!(auth?.accessToken || auth?.token);
  const sortedAuthDefs = hasToken
    ? authDefs // OAUTH2 wins if it comes first in the piece's auth array
    : [...authDefs].sort((a, b) => {
        if (a.type === 'CUSTOM_AUTH') return -1;
        if (b.type === 'CUSTOM_AUTH') return 1;
        return 0;
      });

  let apAuth: unknown = auth?.token ?? '';

  for (const authDef of sortedAuthDefs) {
    if (authDef.type === 'CUSTOM_AUTH') {
      // Build the auth object from env secrets, with optional request-time override.
      // camelCase prop names are converted to SCREAMING_SNAKE_CASE for env lookup
      // e.g. botToken → SLACK_BOT_TOKEN, apiKey → SLACK_API_KEY
      // Env lookup checks FREEPIECES_<KEY>, FP_<KEY>, then <KEY> (via getEnvStr).
      const propKeys = Object.keys(authDef.props ?? {});
      const authProps: Record<string, string> = {};
      for (const key of propKeys) {
        const envKey = `${envPrefix}_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
        authProps[key] =
          auth?.[key] ??
          getEnvStr(env, envKey) ??
          '';
      }
      // If a Bearer token was supplied and the first prop is the primary token
      // (e.g. botToken), map it in directly so callers only need SLACK_BOT_TOKEN.
      if (auth?.token && propKeys.length > 0) {
        authProps[propKeys[0]] = auth.token;
      }
      apAuth = { type: 'CUSTOM_AUTH', props: authProps };
      break;
    }
    if (authDef.type === 'SECRET_TEXT') {
      const secret = auth?.token ?? getEnvStr(env, `${envPrefix}_TOKEN`) ?? '';
      apAuth = { secret_text: secret };
      break;
    }
    if (authDef.type === 'OAUTH2') {
      const accessToken = auth?.accessToken ?? auth?.token ?? '';
      apAuth = {
        type: 'OAUTH2',
        access_token: accessToken,
        token_type: 'Bearer',
        // Populate authed_user so pieces that call requireUserToken() also work.
        // When the caller only has a user token, it serves as both bot and user token.
        data: {
          authed_user: {
            access_token: auth?.userToken ?? accessToken,
          },
        },
      };
      break;
    }
    if (authDef.type === 'BASIC_AUTH') {
      apAuth = {
        username: getEnvStr(env, `${envPrefix}_USERNAME`) ?? '',
        password: getEnvStr(env, `${envPrefix}_PASSWORD`) ?? '',
      };
      break;
    }
  }

  return {
    auth: apAuth,
    propsValue: props,
    store: {
      get: async () => null,
      put: async () => undefined,
      delete: async () => undefined,
    },
    files: {
      write: async () => '',
    },
    server: {
      apiUrl: getEnvStr(env, 'PUBLIC_URL') ?? '',
      publicUrl: getEnvStr(env, 'PUBLIC_URL') ?? '',
      token: '',
    },
    connections: { get: async () => null },
    project: { id: 'freepieces', externalId: async () => undefined },
    flows: {
      list: async () => ({ data: [], next: null, previous: null }),
      current: { id: 'fp-flow', version: { id: 'fp-flow-version' } },
    },
    step: { name: 'fp-step' },
    tags: { add: async () => undefined },
    output: { update: async () => undefined },
    agent: { tools: async () => ({}) },
    executionType: 'BEGIN',
    run: {
      id: 'fp-run',
      stop: () => undefined,
      respond: () => undefined,
      pause: () => undefined,
      createWaitpoint: async () => ({
        id: '',
        resumeUrl: '',
        buildResumeUrl: () => '',
      }),
      waitForWaitpoint: () => undefined,
    },
    variables: {},
    /** @deprecated — kept for older AP actions that still read generateResumeUrl */
    generateResumeUrl: () => '',
  };
}

/**
 * Build a KV-backed trigger state store scoped to a piece/trigger/owner tuple.
 *
 * Keys are namespaced as `trigstate:{piece}:{trigger}:{userId}:{key}` so each
 * subscription gets its own isolated persistent state (for example a poll
 * cursor or webhook registration ID).
 */
export function buildTriggerStore(
  env: Env,
  piece: string,
  trigger: string,
  userId: string | undefined,
): TriggerStore {
  // Gracefully degrade when TOKEN_STORE is not configured (e.g. in test mocks
  // that do not provision a KV namespace for trigger state).
  let kv: KVNamespace | null = null;
  try {
    kv = requireKVBinding(env, 'TOKEN_STORE');
  } catch {
    kv = null;
  }

  const ns = `trigstate:${piece}:${trigger}:${userId ?? '_'}`;

  return {
    async get(key: string): Promise<unknown> {
      if (!kv) return null;
      const raw = await kv.get(`${ns}:${key}`);
      if (!raw) return null;
      try { return JSON.parse(raw) as unknown; } catch { return raw; }
    },
    async put(key: string, value: unknown): Promise<void> {
      if (!kv) return;
      await kv.put(`${ns}:${key}`, JSON.stringify(value));
    },
    async delete(key: string): Promise<void> {
      if (!kv) return;
      await kv.delete(`${ns}:${key}`);
    },
  };
}

/**
 * Build a `PieceTriggerContext` for a native trigger with a real KV-backed
 * store and the correct `webhookUrl` for this piece.  Use for WEBHOOK and
 * APP_WEBHOOK lifecycle calls (`onEnable`, `onDisable`) and for POLLING
 * triggers that need persistent cursor state.
 */
export function buildNativeTriggerContext(
  piece: string,
  trigger: string,
  auth: Record<string, string> | undefined,
  props: Record<string, unknown>,
  userId: string | undefined,
  env: Env,
  refreshAuth?: () => Promise<Record<string, string> | undefined>,
): PieceTriggerContext {
  const publicUrl = getEnvStr(env, 'PUBLIC_URL') ?? '';
  return {
    auth,
    props,
    lastPollMs: 0,
    env,
    refreshAuth,
    store: buildTriggerStore(env, piece, trigger, userId),
    webhookUrl: `${publicUrl}/webhook/${piece}`,
  };
}

/**
 * Build the execution context for an AP trigger's run() call.
 * Mirrors buildApContext and adds the `payload`, `app`, real KV-backed `store`,
 * and `webhookUrl` fields expected by APP_WEBHOOK, WEBHOOK, and POLLING triggers.
 */
export function buildApTriggerContext(
  pieceName: string,
  piece: ApPiece,
  auth: Record<string, string> | undefined,
  propsValue: Record<string, unknown>,
  payload: unknown,
  env: Env,
  userId?: string,
): unknown {
  const base = buildApContext(pieceName, piece, auth, propsValue, env) as Record<string, unknown>;
  const publicUrl = getEnvStr(env, 'PUBLIC_URL') ?? '';

  // Replace the no-op store from buildApContext with a real KV-backed store.
  const kvStore = buildTriggerStore(env, pieceName, String(propsValue['__trigger'] ?? ''), userId);

  return {
    ...base,
    store: {
      get: (key: string) => kvStore.get(key),
      put: (key: string, value: unknown) => kvStore.put(key, value),
      delete: (key: string) => kvStore.delete(key),
    },
    webhookUrl: `${publicUrl}/webhook/${pieceName}`,
    payload: {
      body: payload,
      headers: {},
      method: 'POST',
    },
    app: {
      /** No-op: freepieces doesn't manage webhook registration lifecycle via AP app context. */
      createListeners: () => undefined,
    },
  };
}
