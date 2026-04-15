/**
 * Signed session token utilities for the freepieces admin UI.
 *
 * Token format:  <header>.<payload>.<signature>
 *   header    – base64url({"alg":"HS256"})
 *   payload   – base64url({"sub":"<username>","exp":<unix-ms>})
 *   signature – base64url(HMAC-SHA256(header + "." + payload, signingKey))
 *
 * The signing key is stored as the ADMIN_SIGNING_KEY Cloudflare Secret.
 */

const HEADER_B64 = urlBase64Encode(JSON.stringify({ alg: 'HS256' }));
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const COOKIE_NAME = '__fp_admin';

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function urlBase64Encode(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function urlBase64Decode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  return atob(padded + '='.repeat(pad));
}

function bytesToBase64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  return Uint8Array.from(atob(padded + '='.repeat(pad)), (c) => c.charCodeAt(0));
}

// ---------------------------------------------------------------------------
// HMAC key import
// ---------------------------------------------------------------------------

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a signed session token valid for 24 hours. */
export async function createSessionToken(username: string, signingKey: string): Promise<string> {
  const payload = urlBase64Encode(
    JSON.stringify({ sub: username, exp: Date.now() + SESSION_TTL_MS })
  );
  const unsigned = `${HEADER_B64}.${payload}`;
  const key = await importHmacKey(signingKey);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${bytesToBase64url(sig)}`;
}

/** Verify a session token; returns the payload or null if invalid/expired. */
export async function verifySessionToken(
  token: string,
  signingKey: string
): Promise<{ sub: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts;
  const unsigned = `${header}.${payload}`;
  try {
    const key = await importHmacKey(signingKey);
    const sigBytes = base64urlToBytes(sig);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(unsigned)
    );
    if (!valid) return null;
    const { sub, exp } = JSON.parse(urlBase64Decode(payload)) as {
      sub: string;
      exp: number;
    };
    if (Date.now() > exp) return null;
    return { sub };
  } catch {
    return null;
  }
}

/**
 * Timing-safe string comparison to prevent timing side-channel attacks on
 * credential checks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let result = a.length ^ b.length;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
