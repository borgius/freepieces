/**
 * Shared issuer-app cache for Cloudflare Worker isolates.
 *
 * The OpenAuth issuer's `allSigning` lazy function scans KV for signing keys
 * on first call. Sharing one issuer instance per isolate ensures that scan
 * happens at most once — regardless of whether the call comes from the admin
 * session middleware or the public OpenAuth proxy routes.
 */

import { createAuthIssuer } from '../auth/issuer';
import type { Env } from '../framework/types';

const issuerAppCache = new WeakMap<object, ReturnType<typeof createAuthIssuer>>();

/**
 * Return the cached OpenAuth issuer app for this isolate, creating it once
 * on first call. Keyed on the AUTH_STORE KV binding (a stable object ref
 * per isolate) so the WeakMap entry lives as long as the isolate does.
 */
export function getIssuerApp(env: Env): ReturnType<typeof createAuthIssuer> {
  const kvKey = (env as Record<string, unknown>)['FREEPIECES_AUTH_STORE']
    ?? (env as Record<string, unknown>)['FP_AUTH_STORE']
    ?? (env as Record<string, unknown>)['AUTH_STORE']
    ?? env;
  let issuerApp = issuerAppCache.get(kvKey as object);
  if (!issuerApp) {
    issuerApp = createAuthIssuer(env);
    issuerAppCache.set(kvKey as object, issuerApp);
  }
  return issuerApp;
}

/** Convenience: return a fetch-compatible function that routes requests
 *  in-process through the cached issuer app. */
export function makeIssuerFetch(env: Env): typeof fetch {
  const issuerApp = getIssuerApp(env);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const t0 = Date.now();
    const res = await issuerApp.fetch(new Request(input, init));
    console.log(`[issuer-fetch] ${init?.method ?? 'GET'} ${url} → ${res.status} (${Date.now() - t0}ms)`);
    return res;
  }) as typeof fetch;
}
