/**
 * KV-backed per-user Profiles with scoped runtime API tokens.
 *
 * A single owning user identity may own multiple profiles. Each profile carries:
 *   - a stable id
 *   - the owning userId (the identity used for stored OAuth token lookups)
 *   - a human-readable name
 *   - an optional scoped runtime token (`fp_pt_<random>`)
 *
 * When a runtime client (MCP / /run / /trigger) presents a profile token, the
 * system resolves which profile — and therefore which owning user identity and
 * which enabled set of piece actions/triggers — the request runs as, without
 * needing a separate `X-User-Id` header.
 *
 * Key conventions (all under the shared TOKEN_STORE KV namespace):
 *   - Profile record:  __admin:profile:<userId>:<profileId>      → JSON Profile
 *   - Token index:     __admin:profile-token:<tokenHash>         → JSON ProfileTokenRef
 *
 * Tokens are never stored in plaintext: only the SHA-256 hash of the token is
 * persisted (as the index key and as `Profile.tokenHash`). The plaintext token
 * is returned exactly once, at generation time.
 *
 * Per-profile tool selection reuses the existing user-tool-state store, keyed by
 * the profile's tool owner (`profile:<profileId>`) instead of a plain userId.
 */

export interface Profile {
  version: 1;
  id: string;
  userId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** SHA-256 hash of the active scoped token, or null when no token is issued. */
  tokenHash: string | null;
}

export interface ProfileTokenRef {
  userId: string;
  profileId: string;
}

const PROFILE_VERSION = 1;
const PROFILE_PREFIX = '__admin:profile:';
const PROFILE_TOKEN_PREFIX = '__admin:profile-token:';
const TOOL_STATE_PREFIX = '__admin:user-tool-state:';

/** Runtime profile tokens are prefixed so they can be cheaply distinguished. */
export const PROFILE_TOKEN_PREFIX_VALUE = 'fp_pt_';

function profileKey(userId: string, profileId: string): string {
  return `${PROFILE_PREFIX}${userId}:${profileId}`;
}

function profileUserPrefix(userId: string): string {
  return `${PROFILE_PREFIX}${userId}:`;
}

function profileTokenKey(tokenHash: string): string {
  return `${PROFILE_TOKEN_PREFIX}${tokenHash}`;
}

/** Tool-state owner key for a profile (passed where a userId is otherwise used). */
export function profileToolOwner(profileId: string): string {
  return `profile:${profileId}`;
}

function toolStatePrefixForProfile(profileId: string): string {
  return `${TOOL_STATE_PREFIX}${profileToolOwner(profileId)}:`;
}

// ── Token helpers ──────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Generate a fresh opaque profile token (`fp_pt_<base64url(32 bytes)>`). */
export function generateProfileTokenValue(): string {
  const random = crypto.getRandomValues(new Uint8Array(32));
  return `${PROFILE_TOKEN_PREFIX_VALUE}${toBase64Url(random)}`;
}

/** SHA-256 hex digest of a token. Used as the lookup key and stored on the profile. */
export async function hashProfileToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

/** True when a bearer value looks like a profile token. */
export function isProfileToken(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.startsWith(PROFILE_TOKEN_PREFIX_VALUE);
}

// ── Serialisation ──────────────────────────────────────────────────────────

function normalizeProfile(value: unknown, userId: string, profileId: string): Profile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<Profile>;
  if (typeof record.name !== 'string') return null;

  return {
    version: PROFILE_VERSION,
    id: typeof record.id === 'string' ? record.id : profileId,
    userId: typeof record.userId === 'string' ? record.userId : userId,
    name: record.name,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    tokenHash: typeof record.tokenHash === 'string' ? record.tokenHash : null,
  };
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function getProfile(
  kv: KVNamespace,
  userId: string,
  profileId: string,
): Promise<Profile | null> {
  const raw = await kv.get(profileKey(userId, profileId));
  if (!raw) return null;
  try {
    return normalizeProfile(JSON.parse(raw), userId, profileId);
  } catch {
    return null;
  }
}

export async function listProfiles(kv: KVNamespace, userId: string): Promise<Profile[]> {
  const prefix = profileUserPrefix(userId);
  const profiles: Profile[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    for (const key of page.keys) {
      const profileId = key.name.slice(prefix.length);
      if (!profileId) continue;
      const profile = await getProfile(kv, userId, profileId);
      if (profile) profiles.push(profile);
    }
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  profiles.sort((a, b) => a.createdAt - b.createdAt);
  return profiles;
}

export async function createProfile(
  kv: KVNamespace,
  userId: string,
  name: string,
): Promise<Profile> {
  const now = Date.now();
  const profile: Profile = {
    version: PROFILE_VERSION,
    id: crypto.randomUUID(),
    userId,
    name: name.trim(),
    createdAt: now,
    updatedAt: now,
    tokenHash: null,
  };
  await kv.put(profileKey(userId, profile.id), JSON.stringify(profile));
  return profile;
}

export async function renameProfile(
  kv: KVNamespace,
  userId: string,
  profileId: string,
  name: string,
): Promise<Profile | null> {
  const profile = await getProfile(kv, userId, profileId);
  if (!profile) return null;
  const next: Profile = { ...profile, name: name.trim(), updatedAt: Date.now() };
  await kv.put(profileKey(userId, profileId), JSON.stringify(next));
  return next;
}

/** Delete a profile, its token index entry, and its per-profile tool state. */
export async function deleteProfile(
  kv: KVNamespace,
  userId: string,
  profileId: string,
): Promise<boolean> {
  const profile = await getProfile(kv, userId, profileId);
  if (!profile) return false;

  if (profile.tokenHash) {
    await kv.delete(profileTokenKey(profile.tokenHash));
  }

  // Clean up per-profile tool selection so a recycled profile id can't inherit it.
  const prefix = toolStatePrefixForProfile(profileId);
  let cursor: string | undefined;
  while (true) {
    const page = await kv.list(cursor ? { prefix, cursor } : { prefix });
    await Promise.all(page.keys.map((key) => kv.delete(key.name)));
    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  await kv.delete(profileKey(userId, profileId));
  return true;
}

/**
 * (Re)generate the scoped token for a profile. Any previously issued token is
 * revoked. Returns the plaintext token (shown to the caller exactly once) along
 * with the updated profile, or null when the profile does not exist.
 */
export async function regenerateProfileToken(
  kv: KVNamespace,
  userId: string,
  profileId: string,
): Promise<{ token: string; profile: Profile } | null> {
  const profile = await getProfile(kv, userId, profileId);
  if (!profile) return null;

  if (profile.tokenHash) {
    await kv.delete(profileTokenKey(profile.tokenHash));
  }

  const token = generateProfileTokenValue();
  const tokenHash = await hashProfileToken(token);
  const ref: ProfileTokenRef = { userId, profileId };
  await kv.put(profileTokenKey(tokenHash), JSON.stringify(ref));

  const next: Profile = { ...profile, tokenHash, updatedAt: Date.now() };
  await kv.put(profileKey(userId, profileId), JSON.stringify(next));

  return { token, profile: next };
}

/** Revoke the scoped token for a profile, leaving the profile itself intact. */
export async function revokeProfileToken(
  kv: KVNamespace,
  userId: string,
  profileId: string,
): Promise<Profile | null> {
  const profile = await getProfile(kv, userId, profileId);
  if (!profile) return null;
  if (!profile.tokenHash) return profile;

  await kv.delete(profileTokenKey(profile.tokenHash));
  const next: Profile = { ...profile, tokenHash: null, updatedAt: Date.now() };
  await kv.put(profileKey(userId, profileId), JSON.stringify(next));
  return next;
}

/**
 * Resolve a runtime profile token to its owning user identity and profile id.
 *
 * Returns null for non-profile tokens, unknown tokens, or tokens whose index
 * entry no longer matches the live profile (defends against stale indexes).
 */
export async function resolveProfileToken(
  kv: KVNamespace,
  token: string,
): Promise<ProfileTokenRef | null> {
  if (!isProfileToken(token)) return null;

  const tokenHash = await hashProfileToken(token);
  const raw = await kv.get(profileTokenKey(tokenHash));
  if (!raw) return null;

  let ref: ProfileTokenRef;
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileTokenRef>;
    if (typeof parsed.userId !== 'string' || typeof parsed.profileId !== 'string') return null;
    ref = { userId: parsed.userId, profileId: parsed.profileId };
  } catch {
    return null;
  }

  const profile = await getProfile(kv, ref.userId, ref.profileId);
  if (!profile || profile.tokenHash !== tokenHash) return null;

  return ref;
}
