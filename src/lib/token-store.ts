/**
 * KV-backed token store.
 *
 * Tokens are serialised as JSON, AES-GCM encrypted, and stored under
 * a namespaced key:  token:<pieceName>:<userId>
 *
 * The encryption key (TOKEN_ENCRYPTION_KEY) is a Cloudflare Secret — it
 * never appears in wrangler.toml or source code.
 */

import { encrypt, decrypt } from './crypto';
import type { OAuthTokenRecord } from '../framework/types';

function kvKey(pieceName: string, userId: string): string {
  return `token:${pieceName}:${userId}`;
}

/**
 * Persist an OAuth token record for a user+piece pair.
 * The record is JSON-serialised and AES-GCM encrypted before storage.
 */
export async function storeToken(
  kv: KVNamespace,
  pieceName: string,
  userId: string,
  record: OAuthTokenRecord,
  encryptionKey: string
): Promise<void> {
  const plaintext = JSON.stringify(record);
  const payload = await encrypt(plaintext, encryptionKey);
  await kv.put(kvKey(pieceName, userId), payload);
}

/**
 * Retrieve and decrypt a token record.
 * Returns `null` when no record exists for the user+piece pair.
 */
export async function getToken(
  kv: KVNamespace,
  pieceName: string,
  userId: string,
  encryptionKey: string
): Promise<OAuthTokenRecord | null> {
  const payload = await kv.get(kvKey(pieceName, userId));
  if (!payload) return null;
  const plaintext = await decrypt(payload, encryptionKey);
  return JSON.parse(plaintext) as OAuthTokenRecord;
}

/** Delete a stored token (e.g. on logout or revocation). */
export async function deleteToken(
  kv: KVNamespace,
  pieceName: string,
  userId: string
): Promise<void> {
  await kv.delete(kvKey(pieceName, userId));
}
