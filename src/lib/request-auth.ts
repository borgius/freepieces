import { timingSafeEqual } from './admin-session';
import { createAuthClient, subjects } from '../auth/client';
import { isProfileToken, profileToolOwner, type ProfileTokenRef } from './profile-store';

// Per-isolate cache for the OpenAuth client. createClient() keeps an internal
// jwksCache + issuerCache; reusing the same instance across requests lets the
// JWKS/well-known lookup happen once per isolate instead of on every JWT
// verification (which otherwise triggers KV scans + jose key imports — ~15-30s
// on cold reads).
const authClientCache = new Map<string, ReturnType<typeof createAuthClient>>();

function getCachedAuthClient(publicUrl: string, issuerFetch?: typeof fetch) {
  const key = new URL(publicUrl).origin;
  let client = authClientCache.get(key);
  if (!client) {
    client = createAuthClient(publicUrl, issuerFetch);
    authClientCache.set(key, client);
  }
  return client;
}

export interface RuntimeRequestCredentials {
  userId?: string;
  /**
   * Owner key used to scope per-piece tool selection (enabled actions/triggers).
   * Defaults to `userId` for header/key/JWT auth; for profile-token auth this is
   * `profile:<profileId>` so each profile carries its own enabled tool set.
   */
  toolOwnerId?: string;
  pieceToken?: string;
  /**
   * Per-request CUSTOM_AUTH prop overrides parsed from `X-Piece-Auth`.
   * Value must be a JSON object where every value is a string, e.g.
   *   X-Piece-Auth: {"botToken":"xoxb-…","botToken2":"xoxb-…"}
   * These override env secrets for each matching CUSTOM_AUTH prop name.
   */
  pieceAuthProps?: Record<string, string>;
}

export type RuntimeRequestAuthResult =
  | { ok: true; credentials: RuntimeRequestCredentials }
  | { ok: false; status: 401; error: 'Unauthorized' };

/**
 * Parse the `X-Piece-Auth` header value as a flat JSON string map.
 * Non-string values and malformed JSON are silently dropped.
 */
function parsePieceAuthHeader(value: string | null): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') result[k] = v;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve caller auth for runtime endpoints (/run, /trigger, /subscriptions).
 *
 * Modes (in priority order):
 *
 * 0. Scoped profile token (`fp_pt_*` bearer, `resolveProfile` provided):
 *    - Authorization carries the `fp_pt_<token>` value ← resolves the owning
 *      user identity and the profile's enabled tool set; no X-User-Id required
 *    - X-Piece-Token / X-Piece-Auth          ← optional as in mode 1
 *
 * 1. Static API key (`RUN_API_KEY` set, bearer matches `fp_sk_*` pattern):
 *    - Authorization: Bearer <RUN_API_KEY>   ← authenticates the caller
 *    - X-User-Id: <userId>                   ← KV lookup key for stored OAuth2 tokens
 *    - X-Piece-Token: <token>                ← direct runtime credential (single-prop CUSTOM_AUTH)
 *    - X-Piece-Auth: {"prop":"val",…}        ← direct runtime credentials (multi-prop CUSTOM_AUTH)
 *
 * 2. OpenAuth JWT (bearer is a JWT, `publicUrl` provided):
 *    - Authorization: Bearer <access_token>  ← verified against OpenAuth issuer
 *    - userId resolved from JWT subject      ← can be overridden by X-User-Id
 *    - X-Piece-Token / X-Piece-Auth          ← optional as in mode 1
 *
 * 3. Local-dev / legacy mode (`RUN_API_KEY` absent, no valid JWT):
 *    - Authorization: Bearer <token-or-userId>
 *    - Optional X-User-Id / X-Piece-Token / X-Piece-Auth may still override the bearer fallback
 */
export async function resolveRuntimeRequestAuth(
  headers: Headers,
  runApiKey?: string,
  publicUrl?: string,
  issuerFetch?: typeof fetch,
  disableAuth?: boolean,
  resolveProfile?: (token: string) => Promise<ProfileTokenRef | null>,
): Promise<RuntimeRequestAuthResult> {
  const authHeader = headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  // Mode 0: Scoped profile token. Checked first so it works regardless of
  // RUN_API_KEY / DISABLE_AUTH, and so a profile token can never be mistaken
  // for a user id in the fallback modes. A well-formed but unknown/revoked
  // profile token is rejected rather than falling through.
  if (bearerToken && resolveProfile && isProfileToken(bearerToken)) {
    const ref = await resolveProfile(bearerToken);
    if (!ref) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return {
      ok: true,
      credentials: {
        userId: ref.userId,
        toolOwnerId: profileToolOwner(ref.profileId),
        pieceToken: headers.get('x-piece-token') ?? undefined,
        pieceAuthProps: parsePieceAuthHeader(headers.get('x-piece-auth')),
      },
    };
  }

  // Local-dev auth bypass: only honoured when RUN_API_KEY is not configured.
  if (disableAuth && !runApiKey) {
    return {
      ok: true,
      credentials: {
        userId: headers.get('x-user-id') ?? undefined,
        pieceToken: headers.get('x-piece-token') ?? undefined,
        pieceAuthProps: parsePieceAuthHeader(headers.get('x-piece-auth')),
      },
    };
  }

  // Mode 1: Static API key
  if (runApiKey && bearerToken && timingSafeEqual(bearerToken, runApiKey)) {
    return {
      ok: true,
      credentials: {
        userId: headers.get('x-user-id') ?? undefined,
        pieceToken: headers.get('x-piece-token') ?? undefined,
        pieceAuthProps: parsePieceAuthHeader(headers.get('x-piece-auth')),
      },
    };
  }

  // Mode 2: OpenAuth JWT verification
  if (bearerToken && publicUrl) {
    try {
      const client = getCachedAuthClient(publicUrl, issuerFetch);
      const verified = await client.verify(subjects, bearerToken);
      if (!verified.err) {
        const jwtUserId = verified.subject.properties.userId ?? verified.subject.properties.email;
        return {
          ok: true,
          credentials: {
            userId: headers.get('x-user-id') ?? jwtUserId ?? undefined,
            pieceToken: headers.get('x-piece-token') ?? undefined,
            pieceAuthProps: parsePieceAuthHeader(headers.get('x-piece-auth')),
          },
        };
      }
    } catch {
      // JWT verification failed — fall through to mode 3
    }
  }

  // Require authentication when RUN_API_KEY is configured
  if (runApiKey) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  // Mode 3: Local-dev / legacy mode
  return {
    ok: true,
    credentials: {
      userId: headers.get('x-user-id') ?? bearerToken ?? undefined,
      pieceToken: headers.get('x-piece-token') ?? bearerToken ?? undefined,
      pieceAuthProps: parsePieceAuthHeader(headers.get('x-piece-auth')),
    },
  };
}
