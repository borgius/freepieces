import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { resolveRuntimeRequestAuth, type RuntimeRequestCredentials } from './request-auth';
import type { Env } from '../framework/types';

/**
 * Hono middleware that resolves runtime request auth (Bearer token, X-User-Id,
 * X-Piece-Token, X-Piece-Auth) and stores the result in `c.var.credentials`.
 * Throws HTTPException(401) when authentication fails.
 */
export const runtimeAuth = createMiddleware<{
  Bindings: Env;
  Variables: { credentials: RuntimeRequestCredentials };
}>(async (c, next) => {
  const result = resolveRuntimeRequestAuth(c.req.raw.headers, c.env.RUN_API_KEY);
  if (!result.ok) {
    throw new HTTPException(result.status, { message: result.error });
  }
  c.set('credentials', result.credentials);
  await next();
});
