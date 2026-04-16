/**
 * Auth route handlers: OAuth2 login/callback and token seeding.
 * Mounted at /auth in the main worker.
 */

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { getPiece } from '../framework/registry';
import { buildCallbackUrl } from '../framework/auth';
import {
  buildLoginUrl,
  handleCallback,
  resolveOAuthClientCredentials,
} from '../lib/oauth';
import { storeToken } from '../lib/token-store';
import { createAuthClient, subjects } from '../auth/client';
import type { Env, OAuth2AuthDefinition, OAuthTokenRecord } from '../framework/types';

const authApi = new Hono<{ Bindings: Env }>();

// ── OAuth2 login start ───────────────────────────────────────────────────
authApi.get('/login/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);
  if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
    return c.json({ error: 'Piece does not use OAuth2' }, 400);
  }

  const userId = c.req.query('userId');
  const authDef = stored.def.auth as OAuth2AuthDefinition;

  // userId is optional when the piece has userInfoUrl — resolved from the provider on callback
  const resolvedUserId = userId || (authDef.userInfoUrl ? '_auto_' : '');
  if (!resolvedUserId) return c.json({ error: 'Missing userId query parameter' }, 400);

  const returnUrl = c.req.query('returnUrl');

  const callbackUrl = buildCallbackUrl(c.env.FREEPIECES_PUBLIC_URL, pieceName);
  let clientId: string;
  try {
    ({ clientId } = resolveOAuthClientCredentials(authDef, c.env));
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'OAuth client credentials not configured' },
      503,
    );
  }
  const loginUrl = await buildLoginUrl(authDef, {
    pieceName,
    callbackUrl,
    clientId,
    encryptionKey: c.env.TOKEN_ENCRYPTION_KEY,
    userId: resolvedUserId,
    returnUrl,
  });

  return c.redirect(loginUrl, 302);
});

// ── OAuth2 callback ──────────────────────────────────────────────────────
authApi.get('/callback/:piece', async (c) => {
  const pieceName = c.req.param('piece');
  const stored = getPiece(pieceName);
  if (!stored) return c.json({ error: 'Piece not found' }, 404);
  if (stored.kind !== 'native' || stored.def.auth.type !== 'oauth2') {
    return c.json({ error: 'Piece does not use OAuth2' }, 400);
  }

  try {
    const url = new URL(c.req.url);
    const callbackUrl = buildCallbackUrl(c.env.FREEPIECES_PUBLIC_URL, pieceName);
    const { userId, returnUrl } = await handleCallback(
      url.searchParams,
      stored.def.auth as OAuth2AuthDefinition,
      c.env,
      callbackUrl,
    );

    // If a same-origin returnUrl was provided, redirect back to the admin UI
    if (returnUrl) {
      const target = new URL(returnUrl, c.env.FREEPIECES_PUBLIC_URL);
      const origin = new URL(c.env.FREEPIECES_PUBLIC_URL).origin;
      if (target.origin === origin) {
        return c.redirect(target.toString(), 302);
      }
    }

    return c.json({
      ok: true,
      message: 'Token stored successfully. You may close this window.',
      userId,
    });
  } catch (err) {
    console.error('[freepieces] OAuth callback error:', err);
    const status =
      err instanceof Error && err.message.startsWith('Missing OAuth client credentials')
        ? 503
        : 400;
    const message =
      err instanceof Error &&
      (err.message.startsWith('Missing') ||
        err.message.startsWith('Invalid') ||
        err.message.startsWith('Token exchange'))
        ? err.message
        : 'OAuth callback failed';
    return c.json({ error: message }, status);
  }
});

// ── Seed tokens (admin-protected via OpenAuth) ─────────────────────────
authApi.post(
  '/tokens/:piece',
  async (c, next) => {
    // Check for admin session via cookie or Bearer token
    const accessToken =
      getCookie(c, '__fp_admin') ??
      c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    if (!accessToken) return c.json({ error: 'Unauthorized' }, 401);

    const client = createAuthClient(c.env.FREEPIECES_PUBLIC_URL);
    const verified = await client.verify(subjects, accessToken);
    if (verified.err || verified.subject.type !== 'admin') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  },
  async (c) => {
    const pieceName = c.req.param('piece');
    if (!getPiece(pieceName)) return c.json({ error: 'Piece not found' }, 404);

    let body: { userId?: string; accessToken?: string; refreshToken?: string; expiresIn?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const { userId, accessToken, refreshToken, expiresIn } = body;
    if (!userId || !accessToken) {
      return c.json({ error: 'Missing required fields: userId, accessToken' }, 400);
    }

    const record: OAuthTokenRecord = {
      accessToken,
      refreshToken,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
      tokenType: 'Bearer',
    };
    await storeToken(c.env.TOKEN_STORE, pieceName, userId, record, c.env.TOKEN_ENCRYPTION_KEY);
    return c.json({ ok: true, piece: pieceName, userId });
  },
);

export default authApi;
