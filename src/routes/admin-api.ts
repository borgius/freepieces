/**
 * Admin API route handlers for the freepieces admin panel.
 *
 * Mounted at /admin/api in the main worker. All routes here are
 * protected by the admin session middleware.
 */

import { Hono } from 'hono';
import { listPieces, getPiece } from '../framework/registry';
import { listStoredUserIds } from '../lib/token-store';
import {
  GLOBAL_SECRET_DEFS,
  GLOBAL_SECRET_KEY_SET,
  PIECE_EXTRA_SECRET_GROUPS,
  PIECE_FLAG,
  isPieceEnabled,
  pieceSupportsStoredUsers,
  requireAdminSession,
} from '../lib/admin-config';
import type { Env } from '../framework/types';

const adminApi = new Hono<{
  Bindings: Env;
  Variables: { session: { sub: string } };
}>();

// Admin session auth middleware — applied to all routes in this sub-app
adminApi.use('*', async (c, next) => {
  const session = await requireAdminSession(c.req.raw, c.env);
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
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
