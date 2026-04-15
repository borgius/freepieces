import { timingSafeEqual } from './admin-session';

export interface RuntimeRequestCredentials {
  userId?: string;
  pieceToken?: string;
}

export type RuntimeRequestAuthResult =
  | { ok: true; credentials: RuntimeRequestCredentials }
  | { ok: false; status: 401; error: 'Unauthorized' };

/**
 * Resolve caller auth for runtime endpoints (/run, /trigger, /subscriptions).
 *
 * Modes:
 * - Secured mode (`RUN_API_KEY` set):
 *   - Authorization: Bearer <RUN_API_KEY>   ← authenticates the caller
 *   - X-User-Id: <userId>                   ← KV lookup key for stored OAuth2 tokens
 *   - X-Piece-Token: <token>                ← direct runtime API key / bot token / access token
 *
 * - Local-dev / legacy mode (`RUN_API_KEY` absent):
 *   - Authorization: Bearer <token-or-userId>
 *   - Optional X-User-Id / X-Piece-Token may still override the bearer fallback
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
      },
    };
  }

  return {
    ok: true,
    credentials: {
      userId: headers.get('x-user-id') ?? bearerToken ?? undefined,
      pieceToken: headers.get('x-piece-token') ?? bearerToken ?? undefined,
    },
  };
}
