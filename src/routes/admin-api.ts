/**
 * Admin API route handlers for the freepieces admin panel.
 *
 * Mounted at /admin/api in the main worker. All routes here are
 * protected by the admin session middleware.
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import { listPieces, getPiece } from '../framework/registry';
import { listStoredUserIds } from '../lib/token-store';
import { COOKIE_NAME, createSessionToken, verifySessionToken, timingSafeEqual } from '../lib/admin-session';
import {
  GLOBAL_SECRET_DEFS,
  GLOBAL_SECRET_KEY_SET,
  PIECE_EXTRA_SECRET_GROUPS,
  PIECE_FLAG,
  isPieceEnabled,
  pieceSupportsStoredUsers,
} from '../lib/admin-config';
import type { Env } from '../framework/types';

const adminApi = new Hono<{
  Bindings: Env;
  Variables: { session: { sub: string } };
}>();

// ── Unauthenticated routes (before session middleware) ───────────────────

adminApi.post('/login', async (c) => {
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
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: c.req.url.startsWith('https://'),
    sameSite: 'Strict',
    path: '/admin',
    maxAge: 86400,
  });
  return c.json({ ok: true });
});

adminApi.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/admin' });
  return c.json({ ok: true });
});

// ── Session middleware — protects all routes below ───────────────────────
adminApi.use('*', async (c, next) => {
  // Login and logout are unauthenticated — skip session check
  if (c.req.path.endsWith('/login') || c.req.path.endsWith('/logout')) {
    return next();
  }
  if (!c.env.ADMIN_SIGNING_KEY) return c.json({ error: 'Unauthorized' }, 401);
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return c.json({ error: 'Unauthorized' }, 401);
  const session = await verifySessionToken(token, c.env.ADMIN_SIGNING_KEY);
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  c.set('session', session);
  await next();
});

// GET /admin/api/me
adminApi.get('/me', (c) => {
  return c.json({ username: c.var.session.sub });
});

// GET /admin/api/pieces
adminApi.get('/pieces', async (c) => {
  const all = listPieces();
  const envRecord = c.env as Record<string, unknown>;
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
      supportsUsers: pieceSupportsStoredUsers(p.auth),
      enabled: await isPieceEnabled(c.env.TOKEN_STORE, p.name),
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

  const users = (await listStoredUserIds(c.env.TOKEN_STORE, name)).map((userId) => ({
    userId,
    displayName: userId,
  }));

  return c.json({ users });
});

// GET /admin/api/secrets
adminApi.get('/secrets', (c) => {
  const envRecord = c.env as Record<string, unknown>;
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
  return c.json({ global, pieces });
});

// POST /admin/api/pieces/:name/install → enable
adminApi.post('/pieces/:name/install', async (c) => {
  const name = c.req.param('name');
  if (!getPiece(name)) return c.json({ error: 'Piece not found' }, 404);
  await c.env.TOKEN_STORE.put(PIECE_FLAG(name), 'true');
  return c.json({ ok: true, name, enabled: true });
});

// DELETE /admin/api/pieces/:name → disable
adminApi.delete('/pieces/:name', async (c) => {
  const name = c.req.param('name');
  if (!getPiece(name)) return c.json({ error: 'Piece not found' }, 404);
  await c.env.TOKEN_STORE.put(PIECE_FLAG(name), 'false');
  return c.json({ ok: true, name, enabled: false });
});

// Catch-all for unmatched admin API paths
adminApi.all('*', (c) => c.json({ error: 'Not found' }, 404));

export default adminApi;
