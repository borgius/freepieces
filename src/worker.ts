/**
 * Cloudflare Workers entrypoint for freepieces.
 *
 * Routes
 * ──────
 *   GET  /health                             → health check
 *   GET  /pieces                             → list registered pieces
 *   GET  /auth/login/:piece?userId=          → start OAuth2 flow
 *   GET  /auth/callback/:piece               → OAuth2 callback (code exchange + KV store)
 *   POST /auth/tokens/:piece                 → seed access+refresh tokens directly into KV (admin auth)
 *   POST /run/:piece/:action                 → execute an action
 *   POST /trigger/:piece/:trigger            → run trigger filter (receive webhook payload)
 *
 *   POST /webhook/:piece                      → global inbound webhook (Slack Events API Request URL)
 *   POST /subscriptions/:piece/:trigger        → register a webhook subscription (Bearer auth)
 *   GET  /subscriptions/:piece                 → list subscriptions for a piece (Bearer auth)
 *   DELETE /subscriptions/:piece/:trigger/:id  → remove a subscription (Bearer auth)
 *
 *   GET  /admin                              → admin SPA (served from ASSETS binding)
 *   POST /admin/api/login                    → issue admin session cookie
 *   POST /admin/api/logout                   → clear admin session cookie
 *   GET  /admin/api/me                       → current session info
 *   GET  /admin/api/pieces                   → list pieces + install status
 *   POST /admin/api/pieces/:name/install     → enable a piece
 *   DELETE /admin/api/pieces/:name           → disable a piece
 *   GET  /admin/api/secrets                  → global + per-piece secrets with set/missing status
 *
 * Security model
 * ──────────────
 *   • OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET  → Cloudflare Secrets
 *   • TOKEN_ENCRYPTION_KEY                   → Cloudflare Secret (32 bytes hex)
 *   • Per-user tokens                        → encrypted in KV (TOKEN_STORE)
 *   • Predefined tokens for script clients   → sent via  Authorization: Bearer <token>
 *   • ADMIN_USER / ADMIN_PASSWORD            → Cloudflare Secrets (or .env for local dev)
 *   • ADMIN_SIGNING_KEY                      → Cloudflare Secret (32 bytes hex)
 *   • Admin sessions                         → HMAC-signed cookie (__fp_admin)
 */

import { listPieces, getPiece, getTrigger } from './framework/registry';
import { buildCallbackUrl } from './framework/auth';
import { buildLoginUrl, handleCallback, refreshTokenIfNeeded } from './lib/oauth';
import { getToken, storeToken } from './lib/token-store';
import {
  createSessionToken,
  verifySessionToken,
  timingSafeEqual,
  parseCookie,
  COOKIE_NAME
} from './lib/admin-session';
import './pieces/index.js';
import type { Env, OAuth2AuthDefinition, ApPiece, PieceTriggerContext } from './framework/types';

// ---------------------------------------------------------------------------
// Activepieces context builder
// ---------------------------------------------------------------------------

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
function buildApContext(
  pieceName: string,
  piece: ApPiece,
  auth: Record<string, string> | undefined,
  props: Record<string, unknown>,
  env: Env,
): unknown {
  const envRecord = env as Record<string, string>;
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
      const propKeys = Object.keys(authDef.props ?? {});
      const authProps: Record<string, string> = {};
      for (const key of propKeys) {
        const envKey = `${envPrefix}_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
        authProps[key] =
          auth?.[key] ??
          envRecord[envKey] ??
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
      apAuth = auth?.token ?? envRecord[`${envPrefix}_TOKEN`] ?? '';
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
        username: envRecord[`${envPrefix}_USERNAME`] ?? '',
        password: envRecord[`${envPrefix}_PASSWORD`] ?? '',
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
      apiUrl: env.FREEPIECES_PUBLIC_URL ?? '',
      publicUrl: env.FREEPIECES_PUBLIC_URL ?? '',
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
 * Build the execution context for an AP trigger's run() call.
 * Mirrors buildApContext and adds the `payload` and `app` fields expected
 * by APP_WEBHOOK, WEBHOOK, and POLLING triggers.
 *
 * @param payload - The raw incoming webhook body (already parsed from JSON).
 */
function buildApTriggerContext(
  pieceName: string,
  piece: ApPiece,
  auth: Record<string, string> | undefined,
  propsValue: Record<string, unknown>,
  payload: unknown,
  env: Env,
): unknown {
  const base = buildApContext(pieceName, piece, auth, propsValue, env) as Record<string, unknown>;
  return {
    ...base,
    payload: {
      body: payload,
      headers: {},
      method: 'POST',
    },
    app: {
      /** No-op: freepieces doesn't manage webhook registration lifecycle. */
      createListeners: () => undefined,
    },
  };
}
function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...((init.headers as Record<string, string>) ?? {})
    }
  });
}

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

/** KV key prefix for admin piece-enabled flags. */
const PIECE_FLAG = (name: string) => `__admin:enabled:${name}`;

/**
 * Global infrastructure secrets shown in the Settings › Secrets panel.
 * These keys are filtered OUT of per-piece secret groups in the pieces API.
 */
const GLOBAL_SECRET_DEFS = [
  {
    key: 'FREEPIECES_PUBLIC_URL',
    displayName: 'Public URL',
    description: 'Base URL for OAuth callbacks and webhook routes. Set as a [vars] entry in wrangler.toml.',
    required: true,
    command: 'Set FREEPIECES_PUBLIC_URL in wrangler.toml [vars]',
  },
  {
    key: 'TOKEN_STORE',
    displayName: 'Token Store (KV Namespace)',
    description: 'KV namespace binding for storing OAuth tokens and admin state.',
    required: true,
    command: 'Configure [[kv_namespaces]] in wrangler.toml',
  },
  {
    key: 'TOKEN_ENCRYPTION_KEY',
    displayName: 'Token Encryption Key',
    description: 'AES-GCM 32-byte key for encrypting stored OAuth tokens. Generate: openssl rand -hex 32',
    required: true,
    command: 'wrangler secret put TOKEN_ENCRYPTION_KEY',
  },
  {
    key: 'ADMIN_USER',
    displayName: 'Admin Username',
    description: 'Username for the admin panel.',
    required: true,
    command: 'wrangler secret put ADMIN_USER',
  },
  {
    key: 'ADMIN_PASSWORD',
    displayName: 'Admin Password',
    description: 'Password for the admin panel.',
    required: true,
    command: 'wrangler secret put ADMIN_PASSWORD',
  },
  {
    key: 'ADMIN_SIGNING_KEY',
    displayName: 'Admin Session Signing Key',
    description: 'HMAC key for signing admin session tokens. Generate: openssl rand -hex 32',
    required: true,
    command: 'wrangler secret put ADMIN_SIGNING_KEY',
  },
  {
    key: 'OAUTH_CLIENT_ID',
    displayName: 'OAuth Client ID',
    description: 'OAuth app client ID for native OAuth pieces using shared credentials.',
    required: false,
    command: 'wrangler secret put OAUTH_CLIENT_ID',
  },
  {
    key: 'OAUTH_CLIENT_SECRET',
    displayName: 'OAuth Client Secret',
    description: 'OAuth app client secret for native OAuth pieces using shared credentials.',
    required: false,
    command: 'wrangler secret put OAUTH_CLIENT_SECRET',
  },
] as const;

/** Keys that belong to global config — filtered out of per-piece secret groups. */
const GLOBAL_SECRET_KEY_SET = new Set<string>(GLOBAL_SECRET_DEFS.map((d) => d.key));

/**
 * Extra secret groups that are not derivable from AP auth definitions but are
 * needed for specific pieces (e.g. webhook signature verification).
 * Keyed by piece name.
 */
const PIECE_EXTRA_SECRET_GROUPS: Record<string, Array<{ authType: string; displayName: string; secrets: Array<{ key: string; displayName: string; description: string; required: boolean; command: string }> }>> = {
  slack: [
    {
      authType: 'WEBHOOK_SECURITY',
      displayName: 'Webhook Security',
      secrets: [
        {
          key: 'SLACK_SIGNING_SECRET',
          displayName: 'Slack Signing Secret',
          description: 'Used to verify incoming Slack Event API webhook request signatures. Found in Slack app → Basic Information → Signing Secret.',
          required: false,
          command: 'wrangler secret put SLACK_SIGNING_SECRET',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Webhook subscription helpers
// ---------------------------------------------------------------------------

/** KV key for a single subscription record. */
const SUB_KEY = (piece: string, id: string) => `sub:${piece}:${id}`;
/** KV list prefix for all subscriptions of a piece. */
const SUB_PREFIX = (piece: string) => `sub:${piece}:`;

interface WebhookSubscription {
  id: string;
  trigger: string;
  propsValue: Record<string, unknown>;
  /** URL to POST matched events to. Must be HTTPS. */
  callbackUrl: string;
  /** Bearer token to use when running the trigger filter. */
  bearerToken: string | undefined;
  createdAt: string;
}

/**
 * Verify a Slack (or compatible) HMAC-SHA256 request signature.
 * Rejects requests older than 5 minutes to prevent replay attacks.
 */
async function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string,
  signature: string,
): Promise<boolean> {
  // Reject stale requests
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
async function listSubscriptions(kv: KVNamespace, piece: string): Promise<WebhookSubscription[]> {
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
 * Fan-out an inbound webhook payload to all active subscriptions for a piece.
 * For each subscription, runs the trigger's run() filter and POSTs any matched
 * events to the subscription's callbackUrl.  Best-effort: individual delivery
 * failures are logged but do not affect other subscriptions.
 */
async function dispatchWebhook(
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

      const auth: Record<string, string> | undefined = sub.bearerToken
        ? { token: sub.bearerToken }
        : undefined;

      let events: unknown[];
      try {
        const trigCtx = buildApTriggerContext(pieceName, piece, auth, sub.propsValue, payload, env);
        events = await (triggerDef as { run(ctx: unknown): Promise<unknown[]> }).run(trigCtx);
      } catch {
        return; // trigger filter threw — skip
      }

      if (events.length === 0) return;

      // POST matched events to the subscriber's callback URL (best-effort)
      await fetch(sub.callbackUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ piece: pieceName, trigger: sub.trigger, events }),
      }).catch((err: unknown) => {
        console.error(`[freepieces] Delivery to ${sub.callbackUrl} failed:`, err);
      });
    }),
  );
}

/** Returns true when the piece is enabled (default: all bundled pieces are enabled). */
async function isPieceEnabled(kv: KVNamespace, name: string): Promise<boolean> {
  const flag = await kv.get(PIECE_FLAG(name));
  return flag !== 'false';
}

/** Validate the session cookie and return the payload, or null if missing/invalid. */
async function requireAdminSession(
  request: Request,
  env: Env
): Promise<{ sub: string } | null> {
  if (!env.ADMIN_SIGNING_KEY) return null;
  const token = parseCookie(request.headers.get('cookie'), COOKIE_NAME);
  if (!token) return null;
  return verifySessionToken(token, env.ADMIN_SIGNING_KEY);
}

/** Build a Set-Cookie header value for the admin session. */
function buildCookie(token: string, isSecure: boolean, maxAge: number): string {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/admin',
    `Max-Age=${maxAge}`
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // ── Health ──────────────────────────────────────────────────────────────
    if (pathname === '/health') {
      return json({ ok: true, service: 'freepieces', version: '0.1.0' });
    }

    // ── List pieces ─────────────────────────────────────────────────────────
    if (pathname === '/pieces') {
      return json(
        listPieces().map((p) => ({
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          version: p.version,
          auth: p.auth,
          actions: p.actions.map((a) => ({
            name: a.name,
            displayName: a.displayName,
            description: a.description
          })),
          triggers: p.triggers.map((t) => ({
            name: t.name,
            displayName: t.displayName,
            description: t.description,
            type: t.type,
          })),
        }))
      );
    }

    // ── OAuth2 login start ───────────────────────────────────────────────────
    if (pathname.startsWith('/auth/login/')) {
      const pieceName = pathname.slice('/auth/login/'.length);
      const stored = getPiece(pieceName);
      if (!stored) return json({ error: 'Piece not found' }, { status: 404 });
      if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
        return json({ error: 'Piece does not use OAuth2' }, { status: 400 });
      }

      const userId = url.searchParams.get('userId');
      if (!userId) return json({ error: 'Missing userId query parameter' }, { status: 400 });

      const callbackUrl = buildCallbackUrl(env.FREEPIECES_PUBLIC_URL, pieceName);
      const authDef = stored.def.auth as OAuth2AuthDefinition;
      const clientId = (env[authDef.clientIdEnvKey ?? 'OAUTH_CLIENT_ID'] as string) ?? '';
      const loginUrl = await buildLoginUrl(authDef, {
        pieceName,
        callbackUrl,
        clientId,
        encryptionKey: env.TOKEN_ENCRYPTION_KEY,
        userId
      });

      return Response.redirect(loginUrl, 302);
    }

    // ── OAuth2 callback ──────────────────────────────────────────────────────
    if (pathname.startsWith('/auth/callback/')) {
      const pieceName = pathname.slice('/auth/callback/'.length);
      const stored = getPiece(pieceName);
      if (!stored) return json({ error: 'Piece not found' }, { status: 404 });
      if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
        return json({ error: 'Piece does not use OAuth2' }, { status: 400 });
      }

      try {
        const callbackUrl = buildCallbackUrl(env.FREEPIECES_PUBLIC_URL, pieceName);
        const { userId } = await handleCallback(
          url.searchParams,
          stored.def.auth as OAuth2AuthDefinition,
          env,
          callbackUrl
        );
        return json({
          ok: true,
          message: 'Token stored successfully. You may close this window.',
          userId
        });
      } catch (err) {
        // Log internally; return a safe, non-leaking message to the caller.
        console.error('[freepieces] OAuth callback error:', err);
        const isKnownError =
          err instanceof Error &&
          (err.message.startsWith('Missing') ||
            err.message.startsWith('Invalid') ||
            err.message.startsWith('Token exchange'));
        const message = isKnownError && err instanceof Error
          ? err.message
          : 'OAuth callback failed';
        return json({ error: message }, { status: 400 });
      }
    }

    // ── Run action ───────────────────────────────────────────────────────────
    if (pathname.startsWith('/run/')) {
      const segments = pathname.slice('/run/'.length).split('/');
      if (segments.length < 2) {
        return json({ error: 'Expected /run/:piece/:action' }, { status: 400 });
      }
      const [pieceName, actionName] = segments;
      const stored = getPiece(pieceName);
      if (!stored) {
        return json({ error: 'Action not found' }, { status: 404 });
      }

      // Resolve auth from the Authorization header
      const authHeader = request.headers.get('authorization');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

      // Security gate: if RUN_API_KEY is configured the bearer token must match
      // it exactly (timing-safe comparison). The userId for KV lookups then comes
      // from the X-User-Id header instead.
      // When RUN_API_KEY is absent (local dev), the bearer token IS the userId.
      //
      // Convention (adopted from Activepieces): API keys should be prefixed with
      // "fp_sk_" so they are recognisable in logs and distinct from OAuth tokens.
      // The worker accepts any value but the CLI/SDK generate fp_sk_<hex32> keys.
      if (env.RUN_API_KEY) {
        if (!bearerToken || !timingSafeEqual(bearerToken, env.RUN_API_KEY)) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }
      }
      const userId = env.RUN_API_KEY
        ? (request.headers.get('x-user-id') ?? undefined)
        : bearerToken;

      let auth: Record<string, string> | undefined;

      // Parse request body
      let props: Record<string, unknown> = {};
      if (request.method === 'POST') {
        try {
          props = (await request.json()) as Record<string, unknown>;
        } catch {
          // non-JSON body is fine; props stay empty
        }
      }

      try {
        let result: unknown;

        if (stored.kind === 'native') {
          // ── Freepieces native piece ─────────────────────────────────────
          const piece = stored.def;
          const action = piece.actions.find((a) => a.name === actionName);
          if (!action) {
            return json({ error: 'Action not found' }, { status: 404 });
          }

          if (userId) {
            if (piece.auth.type === 'oauth2') {
              const storedRecord = env.TOKEN_STORE
                ? await getToken(env.TOKEN_STORE, pieceName, userId, env.TOKEN_ENCRYPTION_KEY).catch((err) => {
                    console.error('[freepieces] Failed to retrieve token from KV:', err);
                    return null;
                  })
                : null;

              if (storedRecord) {
                // Refresh the token if it's expired or near expiry (15-min window).
                // Works for Slack token rotation and any piece that uses OAuth2.
                const liveRecord = await refreshTokenIfNeeded(
                  storedRecord,
                  stored.def.auth as OAuth2AuthDefinition,
                  env,
                  pieceName,
                  userId,
                ).catch((err) => {
                  console.error('[freepieces] Token refresh error:', err);
                  return storedRecord;
                });
                auth = {
                  accessToken: liveRecord.accessToken,
                  ...(liveRecord.refreshToken ? { refreshToken: liveRecord.refreshToken } : {}),
                  ...(liveRecord.scope ? { scope: liveRecord.scope } : {}),
                };
              } else {
                auth = { token: userId, accessToken: userId };
              }
            } else {
              auth = { token: userId };
            }
          }

          result = await action.run({ auth, props, env });

        } else {
          // ── Activepieces native piece ───────────────────────────────────
          const { piece } = stored;
          const action = piece._actions[actionName];
          if (!action) {
            return json({ error: 'Action not found' }, { status: 404 });
          }

          if (userId) {
            // Try KV lookup first — userId may be a key for stored OAuth2 tokens.
            const storedRecord = env.TOKEN_STORE
              ? await getToken(env.TOKEN_STORE, pieceName, userId, env.TOKEN_ENCRYPTION_KEY).catch((err) => {
                  console.error('[freepieces] KV lookup failed for AP piece:', err);
                  return null;
                })
              : null;

            if (storedRecord) {
              // Attempt token refresh using the AP piece's OAUTH2 auth definition (if any).
              const authDefs = Array.isArray(piece.auth) ? piece.auth : piece.auth ? [piece.auth] : [];
              const apOAuth2 = authDefs.find((a) => a.type === 'OAUTH2');
              let liveRecord = storedRecord;
              if (apOAuth2?.tokenUrl) {
                const envPrefix = pieceName.toUpperCase().replace(/-/g, '_');
                const oauth2Def: OAuth2AuthDefinition = {
                  type: 'oauth2',
                  authorizationUrl: apOAuth2.authUrl ?? '',
                  tokenUrl: apOAuth2.tokenUrl,
                  scopes: apOAuth2.scope ?? [],
                  clientIdEnvKey: `${envPrefix}_CLIENT_ID`,
                  clientSecretEnvKey: `${envPrefix}_CLIENT_SECRET`,
                };
                liveRecord = await refreshTokenIfNeeded(
                  storedRecord,
                  oauth2Def,
                  env,
                  pieceName,
                  userId,
                ).catch((err) => {
                  console.error('[freepieces] AP piece token refresh error:', err);
                  return storedRecord;
                });
              }
              auth = {
                accessToken: liveRecord.accessToken,
                token: liveRecord.accessToken,
                ...(liveRecord.refreshToken ? { refreshToken: liveRecord.refreshToken } : {}),
                ...(liveRecord.scope ? { scope: liveRecord.scope } : {}),
              };
            } else {
              auth = { token: userId };
            }
          }

          const apCtx = buildApContext(pieceName, piece, auth, props, env);
          result = await action.run(apCtx);
        }

        return json({ ok: true, result });
      } catch (err) {
        // Log the real error server-side; never expose internal details to callers.
        console.error(`[freepieces] Action ${pieceName}/${actionName} failed:`, err);
        return json({ ok: false, error: 'Action execution failed' }, { status: 500 });
      }
    }

    // ── Run trigger (receive webhook payload, invoke trigger filter) ─────────
    if (pathname.startsWith('/trigger/')) {
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, { status: 405 });
      }
      const segments = pathname.slice('/trigger/'.length).split('/');
      if (segments.length < 2) {
        return json({ error: 'Expected /trigger/:piece/:trigger' }, { status: 400 });
      }
      const [pieceName, triggerName] = segments;

      const stored = getPiece(pieceName);
      if (!stored) return json({ error: 'Piece not found' }, { status: 404 });

      const trigger = getTrigger(pieceName, triggerName);
      if (!trigger) return json({ error: 'Trigger not found' }, { status: 404 });

      let body: { payload?: unknown; propsValue?: Record<string, unknown> } = {};
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const authHeader = request.headers.get('authorization');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const auth: Record<string, string> | undefined = bearerToken ? { token: bearerToken } : undefined;

      try {
        // ── Native piece trigger ────────────────────────────────────────────
        if (stored.kind === 'native') {
          const nativeTrigger = stored.def.triggers?.find((t) => t.name === triggerName);
          if (!nativeTrigger) return json({ error: 'Trigger not found' }, { status: 404 });

          let nativeAuth: Record<string, string> | undefined;
          if (bearerToken && stored.def.auth.type === 'oauth2') {
            const storedRecord = env.TOKEN_STORE
              ? await getToken(env.TOKEN_STORE, pieceName, bearerToken, env.TOKEN_ENCRYPTION_KEY).catch(() => null)
              : null;
            if (storedRecord) {
              const liveRecord = await refreshTokenIfNeeded(
                storedRecord, stored.def.auth as OAuth2AuthDefinition, env, pieceName, bearerToken,
              ).catch(() => storedRecord);
              nativeAuth = { accessToken: liveRecord.accessToken, ...(liveRecord.refreshToken ? { refreshToken: liveRecord.refreshToken } : {}) };
            } else {
              nativeAuth = { token: bearerToken, accessToken: bearerToken };
            }
          } else if (bearerToken) {
            nativeAuth = { token: bearerToken };
          }

          const nativeCtx: PieceTriggerContext = {
            auth: nativeAuth,
            props: body.propsValue ?? {},
            lastPollMs: typeof (body as Record<string, unknown>).lastPollMs === 'number'
              ? (body as Record<string, unknown>).lastPollMs as number
              : 0,
            env,
          };
          const events = await nativeTrigger.run(nativeCtx);
          return json({ ok: true, events });
        }

        // ── AP piece trigger ────────────────────────────────────────────────
        if (stored.kind !== 'ap') {
          return json({ error: 'Piece does not support triggers' }, { status: 400 });
        }

        const ctx = buildApTriggerContext(
          pieceName,
          stored.piece,
          auth,
          body.propsValue ?? {},
          body.payload ?? {},
          env,
        );
        const events = await (trigger as { run(ctx: unknown): Promise<unknown[]> }).run(ctx);
        return json({ ok: true, events });
      } catch (err) {
        console.error(`[freepieces] Trigger ${pieceName}/${triggerName} failed:`, err);
        return json({ ok: false, error: 'Trigger execution failed' }, { status: 500 });
      }
    }

    // ── Admin SPA ────────────────────────────────────────────────────────────
    // Redirect bare /admin → /admin/ so asset-relative paths resolve correctly.
    if (pathname === '/admin') {
      return Response.redirect(new URL('/admin/', request.url).toString(), 301);
    }

    // Serve the React admin SPA shell for all non-API admin paths.
    if (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/api/')) {
      if (!env.ASSETS) {
        return json({ error: 'Admin assets not configured. Run: npm run build:admin' }, { status: 503 });
      }
      // Rewrite unknown deep paths to index.html for client-side SPA routing.
      const assetPath = pathname.startsWith('/admin/assets/')
        ? pathname
        : '/admin/index.html';
      return env.ASSETS.fetch(new Request(new URL(assetPath, request.url).toString(), request));
    }

    // ── Admin API – unauthenticated ──────────────────────────────────────────
    if (pathname === '/admin/api/login' && request.method === 'POST') {
      if (!env.ADMIN_USER || !env.ADMIN_PASSWORD || !env.ADMIN_SIGNING_KEY) {
        return json({ error: 'Admin credentials not configured' }, { status: 503 });
      }
      let body: { username?: string; password?: string };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      const { username = '', password = '' } = body;
      const validUser = timingSafeEqual(username, env.ADMIN_USER);
      const validPass = timingSafeEqual(password, env.ADMIN_PASSWORD);
      if (!validUser || !validPass) {
        return json({ error: 'Invalid credentials' }, { status: 401 });
      }
      const token = await createSessionToken(username, env.ADMIN_SIGNING_KEY);
      const isSecure = request.url.startsWith('https://');
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': buildCookie(token, isSecure, 86400)
        }
      });
    }

    if (pathname === '/admin/api/logout' && request.method === 'POST') {
      const isSecure = request.url.startsWith('https://');
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'set-cookie': buildCookie('', isSecure, 0)
        }
      });
    }

    // ── Admin API – authenticated ────────────────────────────────────────────
    if (pathname.startsWith('/admin/api/')) {
      const session = await requireAdminSession(request, env);
      if (!session) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }

      // GET /admin/api/me
      if (pathname === '/admin/api/me' && request.method === 'GET') {
        return json({ username: session.sub });
      }

      // GET /admin/api/pieces
      if (pathname === '/admin/api/pieces' && request.method === 'GET') {
        const all = listPieces();
        const envRecord = env as Record<string, unknown>;
        const result = await Promise.all(
          all.map(async (p) => ({
            name: p.name,
            displayName: p.displayName,
            description: p.description ?? null,
            version: p.version,
            auth: p.auth,
            actions: p.actions.map((a) => ({
              name: a.name,
              displayName: a.displayName,
              description: a.description ?? null,
              props: a.props ?? null,
            })),
            triggers: p.triggers.map((t) => ({
              name: t.name,
              displayName: t.displayName,
              description: t.description ?? null,
              type: t.type,
              props: t.props ?? null,
            })),
            secrets: [
                ...p.secrets,
                ...(PIECE_EXTRA_SECRET_GROUPS[p.name] ?? []),
              ]
              .map((group) => ({
                ...group,
                secrets: group.secrets
                  .filter((s) => !GLOBAL_SECRET_KEY_SET.has(s.key))
                  .map((s) => ({ ...s, isSet: Boolean(envRecord[s.key]) })),
              }))
              .filter((group) => group.secrets.length > 0),
            enabled: await isPieceEnabled(env.TOKEN_STORE, p.name)
          }))
        );
        return json(result);
      }

      // GET /admin/api/secrets
      if (pathname === '/admin/api/secrets' && request.method === 'GET') {
        const envRecord = env as Record<string, unknown>;
        const global = GLOBAL_SECRET_DEFS.map((def) => ({
          key: def.key,
          displayName: def.displayName,
          description: def.description,
          required: def.required,
          command: def.command,
          isSet: Boolean(envRecord[def.key]),
        }));
        const pieces = listPieces()
          .map((p) => ({
            name: p.name,
            displayName: p.displayName,
            groups: [
                ...p.secrets,
                ...(PIECE_EXTRA_SECRET_GROUPS[p.name] ?? []),
              ]
              .map((group) => ({
                ...group,
                secrets: group.secrets
                  .filter((s) => !GLOBAL_SECRET_KEY_SET.has(s.key))
                  .map((s) => ({ ...s, isSet: Boolean(envRecord[s.key]) })),
              }))
              .filter((group) => group.secrets.length > 0),
          }))
          .filter((p) => p.groups.length > 0);
        return json({ global, pieces });
      }

      // POST /admin/api/pieces/:name/install  → enable
      const installMatch = /^\/admin\/api\/pieces\/([^/]+)\/install$/.exec(pathname);
      if (installMatch && request.method === 'POST') {
        const name = installMatch[1];
        if (!getPiece(name)) return json({ error: 'Piece not found' }, { status: 404 });
        await env.TOKEN_STORE.put(PIECE_FLAG(name), 'true');
        return json({ ok: true, name, enabled: true });
      }

      // DELETE /admin/api/pieces/:name  → disable
      const deleteMatch = /^\/admin\/api\/pieces\/([^/]+)$/.exec(pathname);
      if (deleteMatch && request.method === 'DELETE') {
        const name = deleteMatch[1];
        if (!getPiece(name)) return json({ error: 'Piece not found' }, { status: 404 });
        await env.TOKEN_STORE.put(PIECE_FLAG(name), 'false');
        return json({ ok: true, name, enabled: false });
      }

      return json({ error: 'Not found' }, { status: 404 });
    }

    // ── Seed tokens (admin-protected) ───────────────────────────────────────
    // POST /auth/tokens/:piece
    // Body: { userId, accessToken, refreshToken?, expiresIn? }
    //
    // Use this to store an OAuth2 access+refresh pair directly into KV without
    // going through the browser OAuth flow.  Requires admin credentials via
    // Basic auth (Authorization: Basic base64(user:pass)).
    //
    // Example (from slack-example.ts --seed-tokens):
    //   curl -u admin:password -X POST /auth/tokens/slack \
    //     -d '{ "userId": "alice", "accessToken": "xoxe-...", "refreshToken": "xoxe-r-...", "expiresIn": 43200 }'
    //
    // After seeding, use "Bearer alice" in subsequent /run calls to look up
    // the stored token.
    if (pathname.startsWith('/auth/tokens/') && request.method === 'POST') {
      // Require Basic auth — same user/pass as admin panel.
      if (!env.ADMIN_USER || !env.ADMIN_PASSWORD) {
        return json({ error: 'Admin credentials not configured' }, { status: 503 });
      }
      const authHeader = request.headers.get('authorization') ?? '';
      let authed = false;
      if (authHeader.startsWith('Basic ')) {
        const decoded = atob(authHeader.slice(6));
        const colonIdx = decoded.indexOf(':');
        if (colonIdx > 0) {
          const user = decoded.slice(0, colonIdx);
          const pass = decoded.slice(colonIdx + 1);
          authed = timingSafeEqual(user, env.ADMIN_USER) && timingSafeEqual(pass, env.ADMIN_PASSWORD);
        }
      }
      if (!authed) return json({ error: 'Unauthorized' }, { status: 401 });

      const pieceName = pathname.slice('/auth/tokens/'.length);
      if (!getPiece(pieceName)) return json({ error: 'Piece not found' }, { status: 404 });

      let body: { userId?: string; accessToken?: string; refreshToken?: string; expiresIn?: number };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }
      const { userId, accessToken, refreshToken, expiresIn } = body;
      if (!userId || !accessToken) {
        return json({ error: 'Missing required fields: userId, accessToken' }, { status: 400 });
      }

      const record: import('./framework/types').OAuthTokenRecord = {
        accessToken,
        refreshToken,
        expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
        tokenType: 'Bearer',
      };
      await storeToken(env.TOKEN_STORE, pieceName, userId, record, env.TOKEN_ENCRYPTION_KEY);
      return json({ ok: true, piece: pieceName, userId });
    }

    // ── Inbound webhook (Slack Events API Request URL and equivalents) ────────
    //
    // Point Slack → Event Subscriptions → Request URL to:
    //   https://freepieces.example.workers.dev/webhook/slack
    //
    // Handles:
    //   • Slack URL verification challenge (responds synchronously)
    //   • Slack request signature verification (when SLACK_SIGNING_SECRET is set)
    //   • Fan-out to all registered subscriptions via ctx.waitUntil()
    //
    const webhookMatch = /^\/webhook\/([^/]+)$/.exec(pathname);
    if (webhookMatch && request.method === 'POST') {
      const pieceName = decodeURIComponent(webhookMatch[1]);
      const stored = getPiece(pieceName);
      if (!stored || stored.kind !== 'ap') {
        return json({ error: 'Piece not found or not an AP piece' }, { status: 404 });
      }
      const { piece } = stored;

      // Read raw body text before parsing (needed for HMAC verification)
      const rawBody = await request.text();

      // Verify Slack signature when the signing secret is configured
      const envRecord2 = env as Record<string, string>;
      const signingSecretKey = `${pieceName.toUpperCase().replace(/-/g, '_')}_SIGNING_SECRET`;
      const signingSecret = envRecord2[signingSecretKey] as string | undefined;
      if (signingSecret) {
        const timestamp = request.headers.get('x-slack-request-timestamp') ?? '';
        const signature = request.headers.get('x-slack-signature') ?? '';
        const valid = await verifySlackSignature(signingSecret, rawBody, timestamp, signature);
        if (!valid) {
          return json({ error: 'Invalid signature' }, { status: 401 });
        }
      }

      let webhookBody: Record<string, unknown>;
      try {
        webhookBody = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      // Slack URL verification — must reply synchronously with the challenge value
      if (webhookBody['type'] === 'url_verification') {
        return json({ challenge: webhookBody['challenge'] });
      }

      // Fan out asynchronously so we can return 200 within Slack's 3-second window
      ctx.waitUntil(
        dispatchWebhook(pieceName, piece, webhookBody, env).catch((err: unknown) =>
          console.error('[freepieces] dispatchWebhook error:', err),
        ),
      );
      return new Response('OK', { status: 200 });
    }

    // ── Webhook subscriptions ─────────────────────────────────────────────────

    // POST /subscriptions/:piece/:trigger
    //   Body: { callbackUrl: string, propsValue?: Record<string,unknown> }
    //   Auth: Bearer <token>   (stored with the subscription for future trigger dispatch)
    //   Returns: { ok, id, webhookUrl }
    const subCreateMatch = /^\/subscriptions\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (subCreateMatch && request.method === 'POST') {
      const pieceName = decodeURIComponent(subCreateMatch[1]);
      const triggerName = decodeURIComponent(subCreateMatch[2]);

      const stored = getPiece(pieceName);
      if (!stored || stored.kind !== 'ap') {
        return json({ error: 'Piece not found or not an AP piece' }, { status: 404 });
      }
      if (!getTrigger(pieceName, triggerName)) {
        return json({ error: 'Trigger not found' }, { status: 404 });
      }

      const subAuthHeader = request.headers.get('authorization');
      const subBearerToken = subAuthHeader?.startsWith('Bearer ') ? subAuthHeader.slice(7) : undefined;

      let subBody: { callbackUrl?: string; propsValue?: Record<string, unknown> };
      try {
        subBody = (await request.json()) as typeof subBody;
      } catch {
        return json({ error: 'Invalid JSON body' }, { status: 400 });
      }

      const { callbackUrl, propsValue = {} } = subBody;
      if (!callbackUrl) {
        return json({ error: 'Missing required field: callbackUrl' }, { status: 400 });
      }
      // Require HTTPS to mitigate SSRF to non-TLS endpoints
      try {
        const parsed = new URL(callbackUrl);
        if (parsed.protocol !== 'https:') throw new Error();
      } catch {
        return json({ error: 'callbackUrl must be a valid HTTPS URL' }, { status: 400 });
      }

      const subId = crypto.randomUUID();
      const sub: WebhookSubscription = {
        id: subId,
        trigger: triggerName,
        propsValue,
        callbackUrl,
        bearerToken: subBearerToken,
        createdAt: new Date().toISOString(),
      };
      await env.TOKEN_STORE.put(SUB_KEY(pieceName, subId), JSON.stringify(sub));

      const webhookUrl = `${env.FREEPIECES_PUBLIC_URL}/webhook/${pieceName}`;
      return json({ ok: true, id: subId, webhookUrl }, { status: 201 });
    }

    // GET /subscriptions/:piece
    //   Auth: Bearer <token>  (returns only subscriptions associated with this token)
    const subListMatch = /^\/subscriptions\/([^/]+)$/.exec(pathname);
    if (subListMatch && request.method === 'GET') {
      const pieceName = decodeURIComponent(subListMatch[1]);

      const listAuthHeader = request.headers.get('authorization');
      const listBearer = listAuthHeader?.startsWith('Bearer ') ? listAuthHeader.slice(7) : undefined;
      if (!listBearer) return json({ error: 'Bearer token required' }, { status: 401 });

      const allSubs = await listSubscriptions(env.TOKEN_STORE, pieceName);
      const mine = allSubs
        .filter((s) => s.bearerToken === listBearer)
        .map((s) => ({
          id: s.id,
          trigger: s.trigger,
          propsValue: s.propsValue,
          callbackUrl: s.callbackUrl,
          createdAt: s.createdAt,
        }));
      return json({ ok: true, subscriptions: mine });
    }

    // DELETE /subscriptions/:piece/:trigger/:id
    //   Auth: Bearer <token>  (must match the token used to create the subscription)
    const subDeleteMatch = /^\/subscriptions\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (subDeleteMatch && request.method === 'DELETE') {
      const pieceName = decodeURIComponent(subDeleteMatch[1]);
      const subDelId = decodeURIComponent(subDeleteMatch[3]);

      const delAuthHeader = request.headers.get('authorization');
      const delBearer = delAuthHeader?.startsWith('Bearer ') ? delAuthHeader.slice(7) : undefined;
      if (!delBearer) return json({ error: 'Bearer token required' }, { status: 401 });

      const rawSub = await env.TOKEN_STORE.get(SUB_KEY(pieceName, subDelId));
      if (!rawSub) return json({ error: 'Subscription not found' }, { status: 404 });

      const existingSub = JSON.parse(rawSub) as WebhookSubscription;
      if (existingSub.bearerToken !== delBearer) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }

      await env.TOKEN_STORE.delete(SUB_KEY(pieceName, subDelId));
      return json({ ok: true, id: subDelId });
    }

    return json({ error: 'Not found' }, { status: 404 });
  }
} satisfies ExportedHandler<Env>;
