/**
 * Admin API route handlers for the freepieces admin panel.
 *
 * All routes under /admin/api/ are handled here after the session
 * has been validated by the caller (worker.ts).
 */

import { listPieces, getPiece } from '../framework/registry';
import { listStoredUserIds } from '../lib/token-store';
import {
  GLOBAL_SECRET_DEFS,
  GLOBAL_SECRET_KEY_SET,
  PIECE_EXTRA_SECRET_GROUPS,
  PIECE_FLAG,
  isPieceEnabled,
  pieceSupportsStoredUsers,
} from '../lib/admin-config';
import type { Env } from '../framework/types';

type JsonFn = (data: unknown, init?: ResponseInit) => Response;

/**
 * Handle authenticated admin API requests.
 * Returns a Response, or null if the path didn't match any admin API route.
 */
export async function handleAdminApi(
  pathname: string,
  request: Request,
  env: Env,
  json: JsonFn,
): Promise<Response | null> {
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
        supportsUsers: pieceSupportsStoredUsers(p.auth),
        enabled: await isPieceEnabled(env.TOKEN_STORE, p.name),
      })),
    );
    return json(result);
  }

  // GET /admin/api/pieces/:name/users
  const usersMatch = /^\/admin\/api\/pieces\/([^/]+)\/users$/.exec(pathname);
  if (usersMatch && request.method === 'GET') {
    const name = decodeURIComponent(usersMatch[1]);
    const piece = listPieces().find((entry) => entry.name === name);
    if (!piece) return json({ error: 'Piece not found' }, { status: 404 });
    if (!pieceSupportsStoredUsers(piece.auth)) {
      return json({ error: 'Piece does not store user tokens' }, { status: 400 });
    }

    const users = (await listStoredUserIds(env.TOKEN_STORE, name)).map((userId) => ({
      userId,
      displayName: userId,
    }));

    return json({ users });
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

  return null;
}
