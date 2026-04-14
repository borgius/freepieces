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
 * • OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET are Cloudflare Secrets only.
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

  // Exchange code for tokens
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl,
    client_id: env.OAUTH_CLIENT_ID,
    client_secret: env.OAUTH_CLIENT_SECRET
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
