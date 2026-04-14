/**
 * Cloudflare Workers entrypoint for freepieces.
 *
 * Routes
 * ──────
 *   GET  /health                             → health check
 *   GET  /pieces                             → list registered pieces
 *   GET  /auth/login/:piece?userId=          → start OAuth2 flow
 *   GET  /auth/callback/:piece               → OAuth2 callback (code exchange + KV store)
 *   POST /run/:piece/:action                 → execute an action
 *
 *   GET  /admin                              → admin SPA (served from ASSETS binding)
 *   POST /admin/api/login                    → issue admin session cookie
 *   POST /admin/api/logout                   → clear admin session cookie
 *   GET  /admin/api/me                       → current session info
 *   GET  /admin/api/pieces                   → list pieces + install status
 *   POST /admin/api/pieces/:name/install     → enable a piece
 *   DELETE /admin/api/pieces/:name           → disable a piece
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

import { registerPiece, listPieces, getPiece } from './framework/registry';
import { buildCallbackUrl } from './framework/auth';
import { buildLoginUrl, handleCallback } from './lib/oauth';
import { getToken } from './lib/token-store';
import {
  createSessionToken,
  verifySessionToken,
  timingSafeEqual,
  parseCookie,
  COOKIE_NAME
} from './lib/admin-session';
// @fp:imports:start
import { exampleOAuthPiece } from './pieces/example-oauth';
import { exampleApiKeyPiece } from './pieces/example-apikey';
import { gmailPiece } from './pieces/gmail';
import { slackPiece } from './pieces/npm-slack.js';
// @fp:imports:end
import type { Env, OAuth2AuthDefinition } from './framework/types';

// ---------------------------------------------------------------------------
// Register pieces
// ---------------------------------------------------------------------------
// @fp:register:start
registerPiece(exampleOAuthPiece);
registerPiece(exampleApiKeyPiece);
registerPiece(gmailPiece);
registerPiece(slackPiece);
// @fp:register:end

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------
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
  async fetch(request: Request, env: Env): Promise<Response> {
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
          }))
        }))
      );
    }

    // ── OAuth2 login start ───────────────────────────────────────────────────
    if (pathname.startsWith('/auth/login/')) {
      const pieceName = pathname.slice('/auth/login/'.length);
      const piece = getPiece(pieceName);
      if (!piece) return json({ error: 'Piece not found' }, { status: 404 });
      if (piece.auth.type !== 'oauth2') {
        return json({ error: 'Piece does not use OAuth2' }, { status: 400 });
      }

      const userId = url.searchParams.get('userId');
      if (!userId) return json({ error: 'Missing userId query parameter' }, { status: 400 });

      const callbackUrl = buildCallbackUrl(env.FREEPIECES_PUBLIC_URL, pieceName);
      const authDef = piece.auth as OAuth2AuthDefinition;
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
      const piece = getPiece(pieceName);
      if (!piece) return json({ error: 'Piece not found' }, { status: 404 });
      if (piece.auth.type !== 'oauth2') {
        return json({ error: 'Piece does not use OAuth2' }, { status: 400 });
      }

      try {
        const callbackUrl = buildCallbackUrl(env.FREEPIECES_PUBLIC_URL, pieceName);
        const { userId } = await handleCallback(
          url.searchParams,
          piece.auth as OAuth2AuthDefinition,
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
      const piece = getPiece(pieceName);
      const action = piece?.actions.find((a) => a.name === actionName);

      if (!piece || !action) {
        return json({ error: 'Action not found' }, { status: 404 });
      }

      // Resolve auth
      const authHeader = request.headers.get('authorization');
      const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

      let auth: Record<string, string> | undefined;

      if (bearerToken) {
        if (piece.auth.type === 'oauth2') {
          // Try to load a stored OAuth token; fall back to treating the bearer
          // value as a raw access token (useful for predefined / script tokens).
          const storedRecord = env.TOKEN_STORE
            ? await getToken(env.TOKEN_STORE, pieceName, bearerToken, env.TOKEN_ENCRYPTION_KEY).catch((err) => {
                console.error('[freepieces] Failed to retrieve token from KV:', err);
                return null;
              })
            : null;

          if (storedRecord) {
            auth = {
              accessToken: storedRecord.accessToken,
              ...(storedRecord.refreshToken ? { refreshToken: storedRecord.refreshToken } : {}),
              ...(storedRecord.scope ? { scope: storedRecord.scope } : {})
            };
          } else {
            auth = { token: bearerToken, accessToken: bearerToken };
          }
        } else {
          auth = { token: bearerToken };
        }
      }

      let props: Record<string, unknown> = {};
      if (request.method === 'POST') {
        try {
          props = (await request.json()) as Record<string, unknown>;
        } catch {
          // non-JSON body is fine; props stay empty
        }
      }

      try {
        const result = await action.run({ auth, props, env });
        return json({ ok: true, result });
      } catch (err) {
        // Log the real error server-side; never expose internal details to callers.
        console.error(`[freepieces] Action ${pieceName}/${actionName} failed:`, err);
        return json({ ok: false, error: 'Action execution failed' }, { status: 500 });
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
              description: a.description ?? null
            })),
            enabled: await isPieceEnabled(env.TOKEN_STORE, p.name)
          }))
        );
        return json(result);
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

    return json({ error: 'Not found' }, { status: 404 });
  }
} satisfies ExportedHandler<Env>;
