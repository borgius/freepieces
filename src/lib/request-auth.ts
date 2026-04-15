import { timingSafeEqual } from './admin-session';

export interface RuntimeRequestCredentials {
  userId?: string;
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
 * Modes:
 * - Secured mode (`RUN_API_KEY` set):
 *   - Authorization: Bearer <RUN_API_KEY>   ← authenticates the caller
 *   - X-User-Id: <userId>                   ← KV lookup key for stored OAuth2 tokens
 *   - X-Piece-Token: <token>                ← direct runtime credential (single-prop CUSTOM_AUTH)
 *   - X-Piece-Auth: {"prop":"val",…}        ← direct runtime credentials (multi-prop CUSTOM_AUTH)
 *
 * - Local-dev / legacy mode (`RUN_API_KEY` absent):
 *   - Authorization: Bearer <token-or-userId>
 *   - Optional X-User-Id / X-Piece-Token / X-Piece-Auth may still override the bearer fallback
 */
export function resolveRuntimeRequestAuth(
  headers: Headers,
  runApiKey?: string,
): RuntimeRequestAuthResult {
  const authHeader = headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : undefined;

  if (runApiKey) {
    if (!bearerToken || !timingSafeEqual(bearerToken, runApiKey)) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    return {
      ok: true,
      credentials: {
        userId: headers.get('x-user-id') ?? undefined,
        pieceToken: headers.get('x-piece-token') ?? undefined,
        pieceAuthProps: parsePieceAuthHeader(headers.get('x-piece-auth')),
      },
    };
  }

  return {
    ok: true,
    credentials: {
      userId: headers.get('x-user-id') ?? bearerToken ?? undefined,
      pieceToken: headers.get('x-piece-token') ?? bearerToken ?? undefined,
      pieceAuthProps: parsePieceAuthHeader(headers.get('x-piece-auth')),
    },
  };
}
