import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { resolveRuntimeRequestAuth, type RuntimeRequestCredentials } from './request-auth';
import { getEnvBool, getEnvStr } from './env';
import { createAuthIssuer } from '../auth/issuer';
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

// Cache the issuer app per KV namespace instance to avoid re-scanning signing
// keys from KV on every request.
const issuerAppCache = new WeakMap<object, ReturnType<typeof createAuthIssuer>>();

export const runtimeAuth = createMiddleware<{
  Bindings: Env;
  Variables: { credentials: RuntimeRequestCredentials };
}>(async (c, next) => {
  const kvKey = c.env.FREEPIECES_AUTH_STORE ?? c.env.FP_AUTH_STORE ?? c.env.AUTH_STORE ?? c.env;
  let issuerApp = issuerAppCache.get(kvKey as object);
  if (!issuerApp) {
    issuerApp = createAuthIssuer(c.env);
    issuerAppCache.set(kvKey as object, issuerApp);
  }
  const issuerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    issuerApp!.fetch(new Request(input, init))) as typeof fetch;

  const result = await resolveRuntimeRequestAuth(
    c.req.raw.headers,
    getEnvStr(c.env, 'RUN_API_KEY'),
    new URL(c.req.url).origin,
    issuerFetch,
    getEnvBool(c.env, 'DISABLE_AUTH'),
  );
  if (!result.ok) {
    throw new HTTPException(result.status, { message: result.error });
  }
  c.set('credentials', result.credentials);
  await next();
});
