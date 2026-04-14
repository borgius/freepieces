/**
 * AES-GCM encryption helpers for the Web Crypto API available in
 * Cloudflare Workers.
 *
 * Key material is a 32-byte (256-bit) value stored as a 64-char hex string
 * in the TOKEN_ENCRYPTION_KEY Cloudflare Secret.
 *
 * Storage format (base64url-encoded, colon-delimited):
 *   <iv_base64url>:<ciphertext_base64url>
 */

const ALG = { name: 'AES-GCM', length: 256 } as const;

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function importKey(hexKey: string): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars). Generate with: openssl rand -hex 32');
  // Slice to a plain ArrayBuffer so Workers types accept it as BufferSource.
  const rawBuf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey('raw', rawBuf, ALG, false, ['encrypt', 'decrypt']);
}

/** Encrypt a plaintext string.  Returns "<iv>:<ciphertext>" in base64url. */
export async function encrypt(plaintext: string, hexKey: string): Promise<string> {
  const key = await importKey(hexKey);
  const ivArr = crypto.getRandomValues(new Uint8Array(12));
  const iv = ivArr.buffer.slice(ivArr.byteOffset, ivArr.byteOffset + ivArr.byteLength) as ArrayBuffer;
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const ivB64 = toBase64Url(ivArr);
  const ctB64 = toBase64Url(new Uint8Array(cipherBuffer));
  return `${ivB64}:${ctB64}`;
}

/** Decrypt a "<iv>:<ciphertext>" base64url string back to plaintext. */
export async function decrypt(payload: string, hexKey: string): Promise<string> {
  const parts = payload.split(':');
  if (parts.length !== 2) throw new Error('Invalid encrypted payload format');
  const [ivB64, ctB64] = parts;
  const key = await importKey(hexKey);
  const ivArr = fromBase64Url(ivB64);
  const iv = ivArr.buffer.slice(ivArr.byteOffset, ivArr.byteOffset + ivArr.byteLength) as ArrayBuffer;
  const ct = fromBase64Url(ctB64);
  const ctBuf = ct.buffer.slice(ct.byteOffset, ct.byteOffset + ct.byteLength) as ArrayBuffer;
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ctBuf);
  return new TextDecoder().decode(plainBuffer);
}

// ---------------------------------------------------------------------------
// Base64url helpers (no external deps, works in Workers runtime)
// ---------------------------------------------------------------------------
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
