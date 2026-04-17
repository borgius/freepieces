import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { resolveRuntimeRequestAuth, type RuntimeRequestCredentials } from './request-auth';
import { getEnvStr } from './env';
import type { Env } from '../framework/types';

/**
 * Hono middleware that resolves runtime request auth (Bearer token, X-User-Id,
 * X-Piece-Token, X-Piece-Auth) and stores the result in `c.var.credentials`.
 *
 * Supports three modes:
 *   1. Static API key (fp_sk_*) via RUN_API_KEY
 *   2. OpenAuth JWT verified against the embedded issuer
 *   3. Local-dev fallback when neither is configured
 *
 * Throws HTTPException(401) when authentication fails.
 */
export const runtimeAuth = createMiddleware<{
  Bindings: Env;
  Variables: { credentials: RuntimeRequestCredentials };
}>(async (c, next) => {
  const result = await resolveRuntimeRequestAuth(
    c.req.raw.headers,
    getEnvStr(c.env, 'RUN_API_KEY'),
    new URL(c.req.url).origin,
  );
  if (!result.ok) {
    throw new HTTPException(result.status, { message: result.error });
  }
  c.set('credentials', result.credentials);
  await next();
});
