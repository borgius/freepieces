/**
 * Cloudflare Workers entrypoint for freepieces.
 *
 * Routes
 * ──────
 *   GET  /health                      → health check
 *   GET  /pieces                      → list registered pieces
 *   GET  /auth/login/:piece?userId=   → start OAuth2 flow
 *   GET  /auth/callback/:piece        → OAuth2 callback (code exchange + KV store)
 *   POST /run/:piece/:action          → execute an action
 *
 * Security model
 * ──────────────
 *   • OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET  → Cloudflare Secrets
 *   • TOKEN_ENCRYPTION_KEY                   → Cloudflare Secret (32 bytes hex)
 *   • Per-user tokens                        → encrypted in KV (TOKEN_STORE)
 *   • Predefined tokens for script clients   → sent via  Authorization: Bearer <token>
 */

import { registerPiece, listPieces, getPiece } from './framework/registry';
import { buildCallbackUrl } from './framework/auth';
import { buildLoginUrl, handleCallback } from './lib/oauth';
import { getToken } from './lib/token-store';
import { exampleOAuthPiece } from './pieces/example-oauth';
import { exampleApiKeyPiece } from './pieces/example-apikey';
import type { Env, OAuth2AuthDefinition } from './framework/types';

// ---------------------------------------------------------------------------
// Register pieces
// ---------------------------------------------------------------------------
registerPiece(exampleOAuthPiece);
registerPiece(exampleApiKeyPiece);

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
      const loginUrl = await buildLoginUrl(piece.auth as OAuth2AuthDefinition, {
        pieceName,
        callbackUrl,
        clientId: env.OAUTH_CLIENT_ID,
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
            ? await getToken(env.TOKEN_STORE, pieceName, bearerToken, env.TOKEN_ENCRYPTION_KEY).catch(() => null)
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

    return json({ error: 'Not found' }, { status: 404 });
  }
} satisfies ExportedHandler<Env>;
