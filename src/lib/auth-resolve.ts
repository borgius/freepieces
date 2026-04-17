/**
 * Runtime auth resolution for native and AP pieces.
 *
 * Resolves the auth credentials for an action or trigger invocation
 * from KV-stored tokens, env secrets, or request headers.
 */

import { getToken } from './token-store';
import { refreshTokenIfNeeded } from './oauth';
import { getKVBinding, getEnvStr } from './env';
import type { Env, OAuth2AuthDefinition, ApPiece } from '../framework/types';

/**
 * Resolve runtime auth for a freepieces native piece.
 * Returns a credentials map or undefined when no auth is available.
 */
export async function resolveNativeRuntimeAuth(
  pieceName: string,
  authDef: { type: string },
  env: Env,
  userId?: string,
  pieceToken?: string,
): Promise<Record<string, string> | undefined> {
  if (authDef.type === 'oauth2') {
    const lookupKey = userId;
    const directToken = pieceToken ?? lookupKey;
    const tokenStore = getKVBinding(env, 'TOKEN_STORE');
    const encryptionKey = getEnvStr(env, 'TOKEN_ENCRYPTION_KEY');
    const storedRecord = lookupKey && tokenStore && encryptionKey
      ? await getToken(tokenStore, pieceName, lookupKey, encryptionKey).catch((err) => {
          console.error('[freepieces] Failed to retrieve token from KV:', err);
          return null;
        })
      : null;

    if (storedRecord) {
      const lookupUserId = lookupKey;
      if (!lookupUserId) return undefined;
      const liveRecord = await refreshTokenIfNeeded(
        storedRecord,
        authDef as OAuth2AuthDefinition,
        env,
        pieceName,
        lookupUserId,
      ).catch((err) => {
        console.error('[freepieces] Token refresh error:', err);
        return storedRecord;
      });
      return {
        accessToken: liveRecord.accessToken,
        ...(liveRecord.refreshToken ? { refreshToken: liveRecord.refreshToken } : {}),
        ...(liveRecord.scope ? { scope: liveRecord.scope } : {}),
      };
    }

    return directToken
      ? { token: directToken, accessToken: directToken }
      : undefined;
  }

  return pieceToken ? { token: pieceToken } : undefined;
}

/**
 * Resolve runtime auth for an Activepieces native piece.
 * Handles KV token lookup, optional refresh, and direct-token fallback.
 */
export async function resolveApRuntimeAuth(
  pieceName: string,
  piece: ApPiece,
  env: Env,
  userId?: string,
  pieceToken?: string,
): Promise<Record<string, string> | undefined> {
  const tokenStore = getKVBinding(env, 'TOKEN_STORE');
  const encryptionKey = getEnvStr(env, 'TOKEN_ENCRYPTION_KEY');
  const storedRecord = userId && tokenStore && encryptionKey
    ? await getToken(tokenStore, pieceName, userId, encryptionKey).catch((err) => {
        console.error('[freepieces] KV lookup failed for AP piece:', err);
        return null;
      })
    : null;

  if (storedRecord) {
    const authDefs = Array.isArray(piece.auth) ? piece.auth : piece.auth ? [piece.auth] : [];
    const apOAuth2 = authDefs.find((a) => a.type === 'OAUTH2');
    let liveRecord = storedRecord;
    if (apOAuth2?.tokenUrl) {
      const envPrefix = pieceName.toUpperCase().replace(/-/g, '_');
      const oauth2Def: OAuth2AuthDefinition = {
        type: 'oauth2',
        authorizationUrl: apOAuth2.authUrl ?? '',
        tokenUrl: apOAuth2.tokenUrl,
        scopes: apOAuth2.scope ?? [],
        clientIdEnvKey: `${envPrefix}_CLIENT_ID`,
        clientSecretEnvKey: `${envPrefix}_CLIENT_SECRET`,
      };
      const lookupUserId = userId;
      if (!lookupUserId) return undefined;
      liveRecord = await refreshTokenIfNeeded(
        storedRecord,
        oauth2Def,
        env,
        pieceName,
        lookupUserId,
      ).catch((err) => {
        console.error('[freepieces] AP piece token refresh error:', err);
        return storedRecord;
      });
    }
    return {
      accessToken: liveRecord.accessToken,
      token: liveRecord.accessToken,
      ...(liveRecord.refreshToken ? { refreshToken: liveRecord.refreshToken } : {}),
      ...(liveRecord.scope ? { scope: liveRecord.scope } : {}),
    };
  }

  const directToken = pieceToken ?? userId;
  return directToken ? { token: directToken } : undefined;
}
