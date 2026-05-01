/**
 * Admin API route handlers for the freepieces admin panel.
 *
 * Mounted at /admin/api in the main worker. All routes here are
 * protected by the admin session middleware (OpenAuth JWT verification).
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { listPieces, getPiece } from '../framework/registry';
import { listStoredUserIds, deleteToken } from '../lib/token-store';
import { createAuthClient, subjects } from '../auth/client';
import { makeIssuerFetch } from '../lib/auth-issuer';
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
import { requireEnvStr, requireKVBinding } from '../lib/env';

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
  const redirectUri = `${requireEnvStr(c.env, 'PUBLIC_URL')}/admin/api/callback`;
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

  const accessToken = getCookie(c, COOKIE_NAME);
  const refreshToken = getCookie(c, REFRESH_COOKIE);
  if (!accessToken) return c.json({ error: 'Unauthorized' }, 401);

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
  return c.json({ email: c.var.session.email });
});

// GET /admin/api/login-url — returns the OpenAuth authorization URL
adminApi.get('/login-url', (c) => {
  const redirectUri = `${requireEnvStr(c.env, 'PUBLIC_URL')}/admin/api/callback`;
  const provider = c.req.query('provider') ?? 'code';
  const issuerUrl = `${requireEnvStr(c.env, 'PUBLIC_URL')}/oa`;
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
  const result = await Promise.all(
    all.map(async (p) => ({
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
            .map((s) => ({ ...s, isSet: Boolean(envRecord[s.key]), command: withWorkerName(s.command, workerName) })),
        }))
        .filter((group) => group.secrets.length > 0),
      supportsUsers: pieceSupportsStoredUsers(p.auth),
      hasAutoUserId: pieceHasAutoUserId(p.auth),
      enabled: await isPieceEnabled(requireKVBinding(c.env, 'TOKEN_STORE'), p.name),
    })),
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

// Catch-all for unmatched admin API paths
adminApi.all('*', (c) => c.json({ error: 'Not found' }, 404));

export default adminApi;
