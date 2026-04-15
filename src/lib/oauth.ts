/**
 * OAuth 2.0 flow helpers for Cloudflare Workers.
 *
 * Design notes
 * ─────────────
 * • State parameter: base64url-encoded JSON containing { pieceName, userId,
 *   nonce } — signed with HMAC-SHA256 using TOKEN_ENCRYPTION_KEY so the
 *   callback can verify it was not tampered with.
 * • Token exchange uses the standard authorization-code flow.
 * • The resulting token is stored encrypted in KV (see token-store.ts).
 * • Each OAuth piece declares its own client-id and client-secret env keys.
 */

import type { OAuth2AuthDefinition, OAuthTokenRecord, Env } from '../framework/types';
import { storeToken } from './token-store';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

interface OAuthState {
  pieceName: string;
  userId: string;
  nonce: string;
}

async function hmacSign(message: string, hexKey: string): Promise<string> {
  const keyBytes = hexToBytes(hexKey);
  const keyBuf = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

async function hmacVerify(message: string, sig: string, hexKey: string): Promise<boolean> {
  const expected = await hmacSign(message, hexKey);
  return expected === sig;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}

/** Encode an OAuthState into a URL-safe opaque string with an HMAC signature. */
export async function encodeState(state: OAuthState, hexKey: string): Promise<string> {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(state)));
  const sig = await hmacSign(payload, hexKey);
  return `${payload}.${sig}`;
}

/**
 * Decode and verify a state parameter.
 * Returns null if the signature is invalid (CSRF protection).
 */
export async function decodeState(
  raw: string,
  hexKey: string
): Promise<OAuthState | null> {
  const dotIdx = raw.lastIndexOf('.');
  if (dotIdx < 0) return null;
  const payload = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  if (!(await hmacVerify(payload, sig, hexKey))) return null;
  try {
    return JSON.parse(fromBase64Url(payload)) as OAuthState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Login URL builder
// ---------------------------------------------------------------------------

/**
 * Build a full OAuth2 authorization URL, including a signed state parameter.
 *
 * @param auth    The OAuth2 auth definition from the piece.
 * @param options Runtime parameters: callbackUrl, clientId, encryptionKey, userId.
 */
export async function buildLoginUrl(
  auth: OAuth2AuthDefinition,
  options: {
    pieceName: string;
    callbackUrl: string;
    clientId: string;
    encryptionKey: string;
    userId: string;
  }
): Promise<string> {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const state = await encodeState(
    { pieceName: options.pieceName, userId: options.userId, nonce },
    options.encryptionKey
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: options.clientId,
    redirect_uri: options.callbackUrl,
    scope: auth.scopes.join(' '),
    state
  });

  return `${auth.authorizationUrl}?${params.toString()}`;
}

/** Resolve the piece-specific OAuth client credentials from env. */
export function resolveOAuthClientCredentials(
  auth: OAuth2AuthDefinition,
  env: Env,
): { clientId: string; clientSecret: string } {
  const envRecord = env as Record<string, unknown>;
  const clientId = envRecord[auth.clientIdEnvKey];
  const clientSecret = envRecord[auth.clientSecretEnvKey];

  const missing = [
    typeof clientId === 'string' && clientId.length > 0 ? null : auth.clientIdEnvKey,
    typeof clientSecret === 'string' && clientSecret.length > 0 ? null : auth.clientSecretEnvKey,
  ].filter((key): key is string => key !== null);

  if (missing.length > 0) {
    throw new Error(`Missing OAuth client credentials: ${missing.join(', ')}`);
  }

  return {
    clientId: clientId as string,
    clientSecret: clientSecret as string,
  };
}

// ---------------------------------------------------------------------------
// Callback / token exchange
// ---------------------------------------------------------------------------

/**
 * Handle an OAuth2 callback: verify state, exchange code for tokens, store
 * encrypted in KV, return the token record.
 */
export async function handleCallback(
  searchParams: URLSearchParams,
  auth: OAuth2AuthDefinition,
  env: Env,
  callbackUrl: string
): Promise<{ userId: string; record: OAuthTokenRecord }> {
  const code = searchParams.get('code');
  const rawState = searchParams.get('state');

  if (!code) throw new Error('Missing code parameter in callback');
  if (!rawState) throw new Error('Missing state parameter in callback');

  const state = await decodeState(rawState, env.TOKEN_ENCRYPTION_KEY);
  if (!state) throw new Error('Invalid or tampered state parameter — possible CSRF attempt');

  const { clientId, clientSecret } = resolveOAuthClientCredentials(auth, env);

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(auth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString()
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token exchange failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  const record: OAuthTokenRecord = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope,
    tokenType: data.token_type ?? 'Bearer'
  };

  await storeToken(env.TOKEN_STORE, state.pieceName, state.userId, record, env.TOKEN_ENCRYPTION_KEY);

  return { userId: state.userId, record };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/** Refresh threshold: refresh if token expires within 15 minutes. */
const REFRESH_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * If the stored token is expired (or within 15 minutes of expiry) and has a
 * refresh_token, exchange it for a new access token, persist the updated
 * record to KV, and return the fresh record.
 *
 * Returns the original record unchanged when:
 *   • no expiresAt is stored (non-expiring token, e.g. plain bot token)
 *   • token is still valid and not near expiry
 *   • no refresh_token is present (token is simply gone — caller must re-auth)
 */
export async function refreshTokenIfNeeded(
  record: OAuthTokenRecord,
  auth: OAuth2AuthDefinition,
  env: Env,
  pieceName: string,
  userId: string
): Promise<OAuthTokenRecord> {
  if (!record.expiresAt) return record;                              // non-expiring
  if (Date.now() + REFRESH_THRESHOLD_MS < record.expiresAt) return record; // still fresh
  if (!record.refreshToken) return record;                           // can't refresh

  const { clientId, clientSecret } = resolveOAuthClientCredentials(auth, env);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: record.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(auth.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });

  if (!resp.ok) {
    // Log but don't throw — let the caller attempt to use the old token.
    console.error(`[freepieces] Token refresh for ${pieceName}/${userId} failed (${resp.status})`);
    return record;
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };

  const fresh: OAuthTokenRecord = {
    accessToken: data.access_token,
    // Slack may not rotate the refresh token — keep the old one if absent.
    refreshToken: data.refresh_token ?? record.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    scope: data.scope ?? record.scope,
    tokenType: data.token_type ?? record.tokenType ?? 'Bearer',
  };

  await storeToken(env.TOKEN_STORE, pieceName, userId, fresh, env.TOKEN_ENCRYPTION_KEY);
  return fresh;
}
