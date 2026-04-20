/**
 * Fast JWT verify path for freepieces.
 *
 * The OpenAuth `client.verify()` cold path costs ~20–25s on a fresh isolate
 * because it lazy-loads every signing key from KV (sequential KV gets +
 * importPKCS8 + importSPKI + exportJWK per key — and the issuer can have
 * 200+ keys after long uptime).
 *
 * Verifying a JWT only needs the *public* JWKS. We cache the full public
 * JWKS under a single KV key (`jwks:public`); the first cold isolate computes
 * it once via the issuer app's own `/.well-known/jwks.json` handler and writes
 * to KV. Subsequent isolates do a single KV get (~50–150ms cold) +
 * `jose.jwtVerify` (~1ms).
 */

import { createLocalJWKSet, jwtVerify, errors as joseErrors } from 'jose';
import { subjects } from '../auth/client';
import { getIssuerApp } from './auth-issuer';
import type { Env } from '../framework/types';

const JWKS_KV_KEY = 'jwks:public';
const JWKS_KV_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

type JWKSData = { keys: Array<Record<string, unknown>> };

let jwksSetPromise: Promise<ReturnType<typeof createLocalJWKSet>> | null = null;

function getKV(env: Env): KVNamespace {
  const e = env as unknown as Record<string, KVNamespace | undefined>;
  const kv = e['FREEPIECES_AUTH_STORE'] ?? e['FP_AUTH_STORE'] ?? e['AUTH_STORE'];
  if (!kv) throw new Error('No auth KV binding (FREEPIECES_AUTH_STORE/FP_AUTH_STORE/AUTH_STORE)');
  return kv;
}

async function loadJWKSet(env: Env, origin: string, ctx: ExecutionContext) {
  if (jwksSetPromise) return jwksSetPromise;
  jwksSetPromise = (async () => {
    const kv = getKV(env);
    const cached = await kv.get<JWKSData>(JWKS_KV_KEY, 'json');
    if (cached?.keys?.length) {
      return createLocalJWKSet(cached as Parameters<typeof createLocalJWKSet>[0]);
    }
    // Cold fallback: compute via the cached issuer app, then persist.
    const issuerApp = getIssuerApp(env);
    const res = await issuerApp.fetch(new Request(`${origin}/.well-known/jwks.json`), env, ctx);
    const jwks = (await res.json()) as JWKSData;
    ctx.waitUntil(
      kv.put(JWKS_KV_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_KV_TTL_SECONDS }),
    );
    return createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]);
  })().catch((err) => {
    jwksSetPromise = null;
    throw err;
  });
  return jwksSetPromise;
}

export type FastVerifyResult =
  | { ok: true; subject: { type: string; properties: Record<string, unknown> } }
  | { ok: false; expired: boolean };

export async function fastVerify(
  env: Env,
  origin: string,
  ctx: ExecutionContext,
  token: string,
): Promise<FastVerifyResult> {
  try {
    const jwks = await loadJWKSet(env, origin, ctx);
    const { payload } = await jwtVerify(token, jwks, { issuer: origin });
    const subjectType = payload.type;
    if (payload.mode !== 'access' || typeof subjectType !== 'string') {
      return { ok: false, expired: false };
    }
    const sub = (subjects as unknown as Record<
      string,
      { '~standard': { validate: (v: unknown) => Promise<{ value?: unknown; issues?: unknown }> | { value?: unknown; issues?: unknown } } }
    >)[subjectType];
    if (!sub) return { ok: false, expired: false };
    const validated = await sub['~standard'].validate(payload.properties);
    if (validated.issues) return { ok: false, expired: false };
    return {
      ok: true,
      subject: { type: subjectType, properties: validated.value as Record<string, unknown> },
    };
  } catch (err) {
    return { ok: false, expired: err instanceof joseErrors.JWTExpired };
  }
}
