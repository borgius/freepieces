/**
 * Admin API route handlers for the freepieces admin panel.
 *
 * Mounted at /admin/api in the main worker. All routes here are
 * protected by the admin session middleware (OpenAuth JWT verification).
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { listPieces, getPiece, getTrigger } from '../framework/registry';
import { resolveNativeRuntimeAuth, resolveApRuntimeAuth, forceRefreshNativeAuth } from '../lib/auth-resolve';
import { buildApContext } from '../lib/ap-context';
import { listStoredUserIds, deleteToken } from '../lib/token-store';
import { createAuthClient, subjects } from '../auth/client';
import { makeIssuerFetch, warmupIssuer } from '../lib/auth-issuer';
import { fastVerify } from '../lib/fast-verify';
import { verifyCfAccessJwt } from '../lib/cf-access';
import {
  GLOBAL_SECRET_DEFS,
  GLOBAL_SECRET_KEY_SET,
  PIECE_EXTRA_SECRET_GROUPS,
  PIECE_FLAG,
  isPieceEnabled,
  pieceHasAutoUserId,
  pieceSupportsStoredUsers,
} from '../lib/admin-config';
import type { Env } from '../framework/types';
import { requireEnvStr, requireKVBinding, getEnvBool } from '../lib/env';
import { listAllSubscriptions, SUB_KEY, resolveQueueBinding } from '../lib/webhook';
import type { WebhookSubscription } from '../lib/webhook';
import {
  isActionEnabledForUser,
  isActionEnabledInState,
  isTriggerEnabledForUser,
  isTriggerEnabledInState,
  loadUserToolState,
  setActionEnabledForUser,
  setTriggerEnabledForUser,
} from '../lib/user-tool-state';
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  profileToolOwner,
  regenerateProfileToken,
  renameProfile,
  revokeProfileToken,
  type Profile,
} from '../lib/profile-store';

/** Allow HTTPS everywhere; allow HTTP only for loopback (local dev). */
function isValidCallbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') {
      return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    }
    return false;
  } catch { return false; }
}

const authClientCache = new WeakMap<object, ReturnType<typeof createAuthClient>>();

/**
 * Returns a cached OpenAuth client per KV namespace instance (i.e. per isolate).
 * Reusing the client preserves the in-memory jwksCache and issuerCache inside
 * createClient(), so JWKS/well-known fetches happen only once per isolate lifetime
 * instead of on every authenticated request.
 */
function getAuthClient(env: Env, origin: string): ReturnType<typeof createAuthClient> {
  const kvKey = (env as Record<string, unknown>)['FREEPIECES_AUTH_STORE']
    ?? (env as Record<string, unknown>)['FP_AUTH_STORE']
    ?? (env as Record<string, unknown>)['AUTH_STORE']
    ?? env;
  let client = authClientCache.get(kvKey as object);
  if (!client) {
    client = createAuthClient(origin, makeIssuerFetch(env));
    authClientCache.set(kvKey as object, client);
  }
  return client;
}

const COOKIE_NAME = '__fp_admin';
const REFRESH_COOKIE = '__fp_admin_refresh';

const adminApi = new Hono<{
  Bindings: Env;
  Variables: { session: { sub: string; email: string } };
}>();

// ── Auth callback — exchanges OpenAuth code for tokens ──────────────────

adminApi.get('/callback', async (c) => {
  // OpenAuth redirects here with ?error=... when something goes wrong (e.g. email send failure).
  // Redirect back to the login page rather than showing raw JSON.
  const oauthError = c.req.query('error');
  if (oauthError) {
    const desc = c.req.query('error_description') ?? oauthError;
    return c.redirect(`/admin/?auth_error=${encodeURIComponent(desc)}`);
  }

  const code = c.req.query('code');
  if (!code) return c.redirect('/admin/');

  const origin = new URL(c.req.url).origin;
  const redirectUri = `${origin}/admin/api/callback`;
  const client = getAuthClient(c.env, origin);
  const exchanged = await client.exchange(code, redirectUri);
  if (exchanged.err) {
    return c.json({ error: 'Token exchange failed' }, 401);
  }

  // Verify this is an admin token
  const verified = await client.verify(subjects, exchanged.tokens.access, {
    refresh: exchanged.tokens.refresh,
  });
  if (verified.err) {
    return c.json({ error: 'Token verification failed' }, 401);
  }
  if (verified.subject.type !== 'admin') {
    return c.json({ error: 'Insufficient permissions. Admin access required.' }, 403);
  }

  const secure = c.req.url.startsWith('https://');
  setCookie(c, COOKIE_NAME, exchanged.tokens.access, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/admin',
    maxAge: 86400,
  });
  setCookie(c, REFRESH_COOKIE, exchanged.tokens.refresh, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/admin',
    maxAge: 7 * 86400,
  });

  return c.redirect('/admin/');
});

adminApi.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/admin' });
  deleteCookie(c, REFRESH_COOKIE, { path: '/admin' });
  return c.json({ ok: true });
});

// ── Session middleware — protects all routes below ───────────────────────
adminApi.use('*', async (c, next) => {
  // Callback, logout, and login-url are unauthenticated
  if (c.req.path.endsWith('/callback') || c.req.path.endsWith('/logout') || c.req.path.endsWith('/login-url')) {
    return next();
  }

  // CF Access fast path: if a valid CF Access JWT is present, bypass the cookie
  // check. Validates the JWT directly so no internal trust header is required.
  const cfTeamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
  const cfAud = c.env.CF_ACCESS_AUD_FREEPIECES;
  if (cfTeamDomain && cfAud) {
    const cfIdentity = await verifyCfAccessJwt(c.req.raw, cfTeamDomain, cfAud);
    if (cfIdentity) {
      c.set('session', { sub: cfIdentity.sub || cfIdentity.email, email: cfIdentity.email });
      return next();
    }
  }

  // Local-dev auth bypass: skip admin session check when DISABLE_AUTH is set.
  // Admin auth and runtime API-key auth are independent, so RUN_API_KEY being
  // set does not override this flag.
  if (getEnvBool(c.env, 'DISABLE_AUTH')) {
    c.set('session', { sub: 'local', email: 'local@dev' });
    return next();
  }

  const accessToken = getCookie(c, COOKIE_NAME);
  const refreshToken = getCookie(c, REFRESH_COOKIE);
  if (!accessToken) {
    // Kick off the issuer crypto warmup in the background so the RSA
    // encryption key is loaded by the time the user clicks a login button.
    // The lazy() memoization in the OpenAuth issuer shares this in-flight
    // Promise with the real /oa/authorize request, cutting the user-visible
    // wait to whatever time remains after the warmup started.
    c.executionCtx.waitUntil(warmupIssuer(c.env, new URL(c.req.url).origin));
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const origin = new URL(c.req.url).origin;

  // Hot path: KV-cached JWKS + jose verify (no OpenAuth client construction).
  const t0 = Date.now();
  const fast = await fastVerify(c.env, origin, c.executionCtx, accessToken);
  const t1 = Date.now();
  console.log(`[admin-auth] fastVerify=${t1 - t0}ms ok=${fast.ok} expired=${fast.ok ? false : fast.expired} path=${c.req.path}`);

  let subject: { type: string; properties: Record<string, unknown> };

  if (fast.ok) {
    subject = fast.subject;
  } else if (fast.expired && refreshToken) {
    // Token expired and we have a refresh cookie → rotate via the OpenAuth client.
    const client = getAuthClient(c.env, origin);
    const verified = await client.verify(subjects, accessToken, { refresh: refreshToken });
    if (verified.err) return c.json({ error: 'Unauthorized' }, 401);
    if (verified.subject.type !== 'admin') return c.json({ error: 'Forbidden' }, 403);
    subject = { type: verified.subject.type, properties: verified.subject.properties as unknown as Record<string, unknown> };
    // If tokens were refreshed, update cookies
    if (verified.tokens) {
      const secure = c.req.url.startsWith('https://');
      setCookie(c, COOKIE_NAME, verified.tokens.access, {
        httpOnly: true,
        secure,
        sameSite: 'Lax',
        path: '/admin',
        maxAge: 86400,
      });
      setCookie(c, REFRESH_COOKIE, verified.tokens.refresh, {
        httpOnly: true,
        secure,
        sameSite: 'Lax',
        path: '/admin',
        maxAge: 7 * 86400,
      });
    }
  } else {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (subject.type !== 'admin') {
    return c.json({ error: 'Forbidden' }, 403);
  }

  c.set('session', {
    sub: subject.properties['userId'] as string,
    email: subject.properties['email'] as string,
  });
  await next();
});

// GET /admin/api/me
adminApi.get('/me', (c) => {
  return c.json({ userId: c.var.session.sub, email: c.var.session.email });
});

// ── Profiles ────────────────────────────────────────────────────────────
//
// A profile is owned by the authenticated admin user (session.sub). Each profile
// has its own scoped runtime token (`fp_pt_*`) and its own enabled tool set per
// piece. Runtime clients present the token instead of `Authorization` + `X-User-Id`.

/** Public profile DTO — never exposes the token hash. */
function toProfileDto(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    hasToken: profile.tokenHash !== null,
  };
}

// GET /admin/api/profiles → list the current user's profiles
adminApi.get('/profiles', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const profiles = await listProfiles(kv, c.var.session.sub);
  return c.json({ profiles: profiles.map(toProfileDto) });
});

// POST /admin/api/profiles → create a profile { name }
adminApi.post('/profiles', async (c) => {
  let body: { name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const profile = await createProfile(kv, c.var.session.sub, name);
  return c.json({ profile: toProfileDto(profile) }, 201);
});

// PATCH /admin/api/profiles/:id → rename { name }
adminApi.patch('/profiles/:id', async (c) => {
  let body: { name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const name = body.name?.trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const profile = await renameProfile(kv, c.var.session.sub, c.req.param('id'), name);
  if (!profile) return c.json({ error: 'Profile not found' }, 404);
  return c.json({ profile: toProfileDto(profile) });
});

// DELETE /admin/api/profiles/:id
adminApi.delete('/profiles/:id', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const deleted = await deleteProfile(kv, c.var.session.sub, c.req.param('id'));
  if (!deleted) return c.json({ error: 'Profile not found' }, 404);
  return c.json({ ok: true });
});

// POST /admin/api/profiles/:id/token → (re)generate the scoped token (shown once)
adminApi.post('/profiles/:id/token', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const issued = await regenerateProfileToken(kv, c.var.session.sub, c.req.param('id'));
  if (!issued) return c.json({ error: 'Profile not found' }, 404);
  return c.json({ token: issued.token, profile: toProfileDto(issued.profile) });
});

// DELETE /admin/api/profiles/:id/token → revoke the scoped token
adminApi.delete('/profiles/:id/token', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const profile = await revokeProfileToken(kv, c.var.session.sub, c.req.param('id'));
  if (!profile) return c.json({ error: 'Profile not found' }, 404);
  return c.json({ profile: toProfileDto(profile) });
});

// GET /admin/api/profiles/:id/pieces → per-piece tool selection for the profile
adminApi.get('/profiles/:id/pieces', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const profile = await getProfile(kv, c.var.session.sub, c.req.param('id'));
  if (!profile) return c.json({ error: 'Profile not found' }, 404);

  const owner = profileToolOwner(profile.id);
  const pieces = await Promise.all(
    listPieces().map(async (p) => {
      const toolState = await loadUserToolState(kv, owner, p.name);
      return {
        name: p.name,
        displayName: p.displayName,
        actions: p.actions.map((a) => ({
          name: a.name,
          displayName: a.displayName,
          enabled: isActionEnabledInState(toolState, a.name),
        })),
        triggers: p.triggers.map((t) => ({
          name: t.name,
          displayName: t.displayName,
          enabled: isTriggerEnabledInState(toolState, t.name),
        })),
      };
    }),
  );
  return c.json({ pieces });
});

// PATCH /admin/api/profiles/:id/pieces/:piece/:kind/:name → toggle a tool for the profile
adminApi.patch('/profiles/:id/pieces/:piece/:kind/:name', async (c) => {
  const kind = c.req.param('kind');
  if (kind !== 'action' && kind !== 'trigger') {
    return c.json({ error: 'kind must be "action" or "trigger"' }, 400);
  }

  const pieceName = c.req.param('piece');
  const itemName = c.req.param('name');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);

  const itemExists = kind === 'action'
    ? (stored.kind === 'native'
      ? stored.def.actions.some((action) => action.name === itemName)
      : Boolean(stored.piece._actions[itemName]))
    : Boolean(getTrigger(pieceName, itemName));
  if (!itemExists) {
    return c.json({ error: `${kind === 'action' ? 'Action' : 'Trigger'} not found` }, 404);
  }

  let body: { enabled?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }

  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const profile = await getProfile(kv, c.var.session.sub, c.req.param('id'));
  if (!profile) return c.json({ error: 'Profile not found' }, 404);

  const owner = profileToolOwner(profile.id);
  if (kind === 'action') {
    await setActionEnabledForUser(kv, owner, pieceName, itemName, body.enabled);
  } else {
    await setTriggerEnabledForUser(kv, owner, pieceName, itemName, body.enabled);
  }

  return c.json({ ok: true, profileId: profile.id, pieceName, kind, name: itemName, enabled: body.enabled });
});

// GET /admin/api/login-url — returns the OpenAuth authorization URL
adminApi.get('/login-url', (c) => {
  const origin = new URL(c.req.url).origin;
  const redirectUri = `${origin}/admin/api/callback`;
  const provider = c.req.query('provider') ?? 'code';
  const issuerUrl = `${origin}/oa`;
  const authorizationUrl = new URL(`${issuerUrl}/authorize`);
  authorizationUrl.searchParams.set('client_id', 'freepieces-worker');
  authorizationUrl.searchParams.set('redirect_uri', redirectUri);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('provider', provider);
  return c.json({ url: authorizationUrl.toString() });
});

// GET /admin/api/pieces
adminApi.get('/pieces', async (c) => {
  const all = listPieces();
  const envRecord = c.env as Record<string, unknown>;
  const workerName = resolveWorkerName(c.env);
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const currentUserId = c.var.session.sub;
  const result = await Promise.all(
    all.map(async (p) => {
      const [pieceEnabled, toolState] = await Promise.all([
        isPieceEnabled(kv, p.name),
        loadUserToolState(kv, currentUserId, p.name),
      ]);

      return {
        name: p.name,
        displayName: p.displayName,
        description: p.description ?? null,
        version: p.version,
        auth: p.auth,
        mcpEndpoint: p.mcpEndpoint,
        actions: p.actions.map((a) => ({
          name: a.name,
          displayName: a.displayName,
          description: a.description ?? null,
          props: a.props ?? null,
          enabled: isActionEnabledInState(toolState, a.name),
        })),
        triggers: p.triggers.map((t) => ({
          name: t.name,
          displayName: t.displayName,
          description: t.description ?? null,
          type: t.type,
          props: t.props ?? null,
          enabled: isTriggerEnabledInState(toolState, t.name),
        })),
        secrets: [
            ...p.secrets,
            ...(PIECE_EXTRA_SECRET_GROUPS[p.name] ?? []),
          ]
          .map((group) => ({
            ...group,
            secrets: group.secrets
              .filter((s) => !GLOBAL_SECRET_KEY_SET.has(s.key))
              .map((s) => ({ ...s, isSet: Boolean(envRecord[s.key]), command: withWorkerName(s.command, workerName) })),
          }))
          .filter((group) => group.secrets.length > 0),
        supportsUsers: pieceSupportsStoredUsers(p.auth),
        hasAutoUserId: pieceHasAutoUserId(p.auth),
        enabled: pieceEnabled,
      };
    }),
  );
  return c.json(result);
});

// GET /admin/api/pieces/:name/users
adminApi.get('/pieces/:name/users', async (c) => {
  const name = c.req.param('name');
  const piece = listPieces().find((entry) => entry.name === name);
  if (!piece) return c.json({ error: 'Piece not found' }, 404);
  if (!pieceSupportsStoredUsers(piece.auth)) {
    return c.json({ error: 'Piece does not store user tokens' }, 400);
  }

  const users = (await listStoredUserIds(requireKVBinding(c.env, 'TOKEN_STORE'), name)).map((userId) => ({
    userId,
    displayName: userId,
  }));

  return c.json({ users });
});

// DELETE /admin/api/pieces/:name/users/:userId
adminApi.delete('/pieces/:name/users/:userId', async (c) => {
  const name = c.req.param('name');
  const userId = c.req.param('userId');
  const piece = listPieces().find((entry) => entry.name === name);
  if (!piece) return c.json({ error: 'Piece not found' }, 404);
  if (!pieceSupportsStoredUsers(piece.auth)) {
    return c.json({ error: 'Piece does not store user tokens' }, 400);
  }
  await deleteToken(requireKVBinding(c.env, 'TOKEN_STORE'), name, userId);
  return c.json({ ok: true });
});

/** Append `--name <worker>` to a `wrangler secret put X` command when the name is known. */
function withWorkerName(command: string, workerName: string | undefined): string {
  if (!workerName || !command.startsWith('wrangler secret put ')) return command;
  return `${command} --name ${workerName}`;
}

/** Derive worker name: explicit env var first, then extract subdomain from PUBLIC_URL. */
function resolveWorkerName(env: Env): string | undefined {
  const explicit = env.FREEPIECES_WORKER_NAME ?? env.FP_WORKER_NAME;
  if (explicit) return explicit;
  const publicUrl = env.FREEPIECES_PUBLIC_URL ?? env.FP_PUBLIC_URL ?? env.PUBLIC_URL;
  if (!publicUrl) return undefined;
  try {
    const host = new URL(publicUrl).hostname; // e.g. my-worker.workers.dev
    return host.split('.')[0]; // e.g. my-worker
  } catch {
    return undefined;
  }
}

// GET /admin/api/secrets
adminApi.get('/secrets', (c) => {
  const envRecord = c.env as Record<string, unknown>;
  const workerName = resolveWorkerName(c.env);
  const global = GLOBAL_SECRET_DEFS.map((def) => ({
    key: def.key,
    displayName: def.displayName,
    description: def.description,
    required: def.required,
    command: withWorkerName(def.command, workerName),
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
            .map((s) => ({ ...s, isSet: Boolean(envRecord[s.key]), command: withWorkerName(s.command, workerName) })),
        }))
        .filter((group) => group.secrets.length > 0),
    }))
    .filter((p) => p.groups.length > 0);
  return c.json({ global, pieces });
});

// POST /admin/api/pieces/:name/install → enable
adminApi.post('/pieces/:name/install', async (c) => {
  const name = c.req.param('name');
  if (!getPiece(name)) return c.json({ error: 'Piece not found' }, 404);
  await requireKVBinding(c.env, 'TOKEN_STORE').put(PIECE_FLAG(name), 'true');
  return c.json({ ok: true, name, enabled: true });
});

// DELETE /admin/api/pieces/:name → disable
adminApi.delete('/pieces/:name', async (c) => {
  const name = c.req.param('name');
  if (!getPiece(name)) return c.json({ error: 'Piece not found' }, 404);
  await requireKVBinding(c.env, 'TOKEN_STORE').put(PIECE_FLAG(name), 'false');
  return c.json({ ok: true, name, enabled: false });
});

// PATCH /admin/api/pieces/:piece/:kind/:name → toggle action/trigger state
adminApi.patch('/pieces/:piece/:kind/:name', async (c) => {
  const pieceName = c.req.param('piece');
  const kind = c.req.param('kind');
  const itemName = c.req.param('name');
  const stored = getPiece(pieceName);

  if (!stored) {
    return c.json({ error: 'Piece not found' }, 404);
  }

  if (kind !== 'action' && kind !== 'trigger') {
    return c.json({ error: 'kind must be "action" or "trigger"' }, 400);
  }

  const itemExists = kind === 'action'
    ? (stored.kind === 'native'
      ? stored.def.actions.some((action) => action.name === itemName)
      : Boolean(stored.piece._actions[itemName]))
    : Boolean(getTrigger(pieceName, itemName));

  if (!itemExists) {
    return c.json({ error: `${kind === 'action' ? 'Action' : 'Trigger'} not found` }, 404);
  }

  let body: { enabled?: boolean; userId?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }

  const effectiveUserId = body.userId?.trim() || c.var.session.sub;
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');

  if (kind === 'action') {
    await setActionEnabledForUser(kv, effectiveUserId, pieceName, itemName, body.enabled);
  } else {
    await setTriggerEnabledForUser(kv, effectiveUserId, pieceName, itemName, body.enabled);
  }

  return c.json({
    ok: true,
    pieceName,
    kind,
    name: itemName,
    enabled: body.enabled,
    userId: effectiveUserId,
  });
});

// POST /admin/api/subscriptions/:piece/:trigger — admin-privileged subscription creation
adminApi.post('/subscriptions/:piece/:trigger', async (c) => {
  const pieceName = c.req.param('piece');
  const triggerName = c.req.param('trigger');

  if (!getPiece(pieceName)) return c.json({ error: 'Piece not found' }, 404);
  if (!getTrigger(pieceName, triggerName)) return c.json({ error: 'Trigger not found' }, 404);

  let body: { callbackUrl?: string; queueName?: string; pieceToken?: string; userId?: string; propsValue?: Record<string, unknown> };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { callbackUrl, queueName, pieceToken, userId, propsValue = {} } = body;
  const effectiveUserId = userId?.trim() || c.var.session.sub;

  if (callbackUrl && queueName) return c.json({ error: 'Provide either callbackUrl or queueName, not both' }, 400);
  if (!callbackUrl && !queueName) return c.json({ error: 'Missing callbackUrl or queueName' }, 400);

  if (callbackUrl && !isValidCallbackUrl(callbackUrl)) {
    return c.json({ error: 'callbackUrl must be a valid HTTPS URL (or http://localhost / http://127.0.0.1 for local dev)' }, 400);
  }

  if (queueName && !resolveQueueBinding(c.env, queueName)) {
    return c.json({ error: `Queue binding not found for "${queueName}"` }, 400);
  }

  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  if (!(await isTriggerEnabledForUser(kv, effectiveUserId, pieceName, triggerName))) {
    return c.json({ error: 'Trigger not found' }, 404);
  }

  const subId = crypto.randomUUID();
  const sub: WebhookSubscription = {
    id: subId,
    trigger: triggerName,
    propsValue,
    ...(callbackUrl ? { callbackUrl } : { queueName }),
    ...(effectiveUserId ? { userId: effectiveUserId } : {}),
    ...(pieceToken ? { pieceToken } : {}),
    createdAt: new Date().toISOString(),
  };
  await kv.put(SUB_KEY(pieceName, subId), JSON.stringify(sub));
  return c.json({ ok: true, id: subId }, 201);
});

// PATCH /admin/api/subscriptions/:piece/:id — update endpoint for one subscription
adminApi.patch('/subscriptions/:piece/:id', async (c) => {
  const pieceName = c.req.param('piece');
  const subId = c.req.param('id');
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');

  const raw = await kv.get(SUB_KEY(pieceName, subId));
  if (!raw) return c.json({ error: 'Subscription not found' }, 404);

  let body: { callbackUrl?: string; queueName?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const { callbackUrl, queueName } = body;
  if (callbackUrl && queueName) return c.json({ error: 'Provide either callbackUrl or queueName, not both' }, 400);
  if (!callbackUrl && !queueName) return c.json({ error: 'Missing callbackUrl or queueName' }, 400);

  if (callbackUrl && !isValidCallbackUrl(callbackUrl)) {
    return c.json({ error: 'callbackUrl must be a valid HTTPS URL (or http://localhost / http://127.0.0.1 for local dev)' }, 400);
  }

  if (queueName && !resolveQueueBinding(c.env, queueName)) {
    return c.json({ error: `Queue binding not found for "${queueName}"` }, 400);
  }

  const existing = JSON.parse(raw) as WebhookSubscription;
  const { callbackUrl: _cb, queueName: _qn, ...rest } = existing;
  const updated: WebhookSubscription = {
    ...rest,
    ...(callbackUrl ? { callbackUrl } : { queueName }),
  };
  await kv.put(SUB_KEY(pieceName, subId), JSON.stringify(updated));
  return c.json({ ok: true });
});

// DELETE /admin/api/subscriptions/:piece/:id — admin-privileged deletion
adminApi.delete('/subscriptions/:piece/:id', async (c) => {
  const pieceName = c.req.param('piece');
  const subId = c.req.param('id');
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');

  const raw = await kv.get(SUB_KEY(pieceName, subId));
  if (!raw) return c.json({ error: 'Subscription not found' }, 404);

  await kv.delete(SUB_KEY(pieceName, subId));
  return c.json({ ok: true });
});

// GET /admin/api/triggers/groups — global grouped trigger delivery read model
adminApi.get('/triggers/groups', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const publicUrl = (c.env.FREEPIECES_PUBLIC_URL ?? c.env.FP_PUBLIC_URL ?? c.env.PUBLIC_URL ?? '').replace(/\/$/, '');

  const all = await listAllSubscriptions(kv);
  const pieceSummaries = listPieces();

  // Group by delivery target: callbackUrl or queueName
  const groupMap = new Map<string, {
    endpointType: 'callbackUrl' | 'queueName';
    endpointValue: string;
    members: Array<{
      subscriptionId: string;
      pieceName: string;
      pieceDisplayName: string;
      triggerName: string;
      triggerDisplayName: string;
      triggerType: string;
      providerWebhookUrl: string;
      createdAt: string;
      owner: { kind: string; label: string; ownerKey: string };
      deliveryTarget: { type: string; value: string };
    }>;
  }>();

  for (const { pieceName, sub } of all) {
    const endpointType = sub.queueName ? 'queueName' : 'callbackUrl';
    const endpointValue = sub.queueName ?? sub.callbackUrl ?? '';
    if (!endpointValue) continue;

    const endpointKey = `${endpointType}:${endpointValue}`;

    if (!groupMap.has(endpointKey)) {
      groupMap.set(endpointKey, { endpointType, endpointValue, members: [] });
    }

    // Derive display metadata from registry
    const pieceSummary = pieceSummaries.find((p) => p.name === pieceName);
    const triggerDef = getTrigger(pieceName, sub.trigger);

    const pieceDisplayName = pieceSummary?.displayName ?? pieceName;
    const triggerDisplayName = triggerDef?.displayName ?? sub.trigger;
    const triggerType = triggerDef?.type ?? 'WEBHOOK';
    const providerWebhookUrl = `${publicUrl}/webhook/${encodeURIComponent(pieceName)}`;

    // Build redacted owner summary — never return raw pieceToken or pieceAuthProps
    let owner: { kind: string; label: string; ownerKey: string };
    if (sub.userId) {
      owner = { kind: 'stored-user', label: sub.userId, ownerKey: `oauth:${sub.userId}` };
    } else if (sub.pieceToken) {
      // Redact: expose only that a direct token is used, not the token itself
      owner = { kind: 'direct-token', label: 'API key / direct token', ownerKey: `token:${sub.id}` };
    } else if (sub.pieceAuthProps) {
      owner = { kind: 'custom-auth', label: 'Custom auth props', ownerKey: `custom:${sub.id}` };
    } else if ((sub as { bearerToken?: string }).bearerToken) {
      owner = { kind: 'legacy-bearer', label: 'Legacy bearer token', ownerKey: `legacy:${sub.id}` };
    } else {
      owner = { kind: 'unknown', label: 'Unknown', ownerKey: `unknown:${sub.id}` };
    }

    groupMap.get(endpointKey)!.members.push({
      subscriptionId: sub.id,
      pieceName,
      pieceDisplayName,
      triggerName: sub.trigger,
      triggerDisplayName,
      triggerType,
      providerWebhookUrl,
      createdAt: sub.createdAt,
      owner,
      deliveryTarget: { type: endpointType, value: endpointValue },
    });
  }

  const groups = Array.from(groupMap.entries()).map(([endpointKey, group]) => ({
    endpointKey,
    endpointType: group.endpointType,
    endpointValue: group.endpointValue,
    memberCount: group.members.length,
    members: group.members,
  }));

  return c.json({ groups });
});

// GET /admin/api/test-events — list recently received test webhook payloads
const TEST_EVENT_PREFIX = 'test_event:';

adminApi.get('/test-events', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const { keys } = await kv.list({ prefix: TEST_EVENT_PREFIX });
  const sorted = [...keys].sort((a, b) => b.name.localeCompare(a.name)); // newest first
  const events = await Promise.all(
    sorted.map(async (k) => {
      const raw = await kv.get(k.name);
      return raw ? (JSON.parse(raw) as unknown) : null;
    })
  );
  return c.json({ events: events.filter(Boolean) });
});

// DELETE /admin/api/test-events — clear all stored test events
adminApi.delete('/test-events', async (c) => {
  const kv = requireKVBinding(c.env, 'TOKEN_STORE');
  const { keys } = await kv.list({ prefix: TEST_EVENT_PREFIX });
  await Promise.all(keys.map((k) => kv.delete(k.name)));
  return c.json({ ok: true, deleted: keys.length });
});

// POST /admin/api/run/:piece/:action — admin-privileged action execution (Try it)
adminApi.post('/run/:piece/:action', async (c) => {
  const pieceName = c.req.param('piece');
  const actionName = c.req.param('action');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);

  let body: { userId?: string; pieceToken?: string; props?: Record<string, unknown> } = {};
  try { body = await c.req.json(); } catch { /* empty body is fine */ }

  const { userId, pieceToken, props = {} } = body;
  const effectiveUserId = userId?.trim() || c.var.session.sub;

  if (!(await isActionEnabledForUser(requireKVBinding(c.env, 'TOKEN_STORE'), effectiveUserId, pieceName, actionName))) {
    return c.json({ error: 'Action not found' }, 404);
  }

  try {
    let result: unknown;

    if (stored.kind === 'native') {
      const piece = stored.def;
      const action = piece.actions.find((a) => a.name === actionName);
      if (!action) return c.json({ error: 'Action not found' }, 404);

      const auth = await resolveNativeRuntimeAuth(pieceName, piece.auth, c.env, userId, pieceToken);
      result = await action.run({
        auth,
        props,
        env: c.env,
        refreshAuth: async () => {
          const refreshed = await forceRefreshNativeAuth(pieceName, piece.auth, c.env, userId);
          return refreshed ?? undefined;
        },
      });
    } else {
      const { piece } = stored;
      const action = piece._actions[actionName];
      if (!action) return c.json({ error: 'Action not found' }, 404);

      const auth = await resolveApRuntimeAuth(pieceName, piece, c.env, userId, pieceToken);
      const apCtx = buildApContext(pieceName, piece, auth, props, c.env);
      result = await action.run(apCtx);
    }

    return c.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Action execution failed';
    return c.json({ ok: false, error: message }, 500);
  }
});

// Catch-all for unmatched admin API paths
adminApi.all('*', (c) => c.json({ error: 'Not found' }, 404));

export default adminApi;
