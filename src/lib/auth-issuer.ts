/**
 * Shared issuer-app cache for Cloudflare Worker isolates.
 *
 * The OpenAuth issuer's `allSigning` lazy function scans KV for signing keys
 * on first call. Sharing one issuer instance per isolate ensures that scan
 * happens at most once — regardless of whether the call comes from the admin
 * session middleware or the public OpenAuth proxy routes.
 */

import { createAuthIssuer } from '../auth/issuer';
import type { StorageAdapter } from '@openauthjs/openauth/storage/storage';
import type { Env } from '../framework/types';

const issuerAppCache = new WeakMap<object, ReturnType<typeof createAuthIssuer>>();

export interface IssuerOpts {
  storage?: StorageAdapter;
  sendCode?: (email: string, code: string) => Promise<void>;
}

/**
 * Return the cached OpenAuth issuer app for this isolate, creating it once
 * on first call. Keyed on the AUTH_STORE KV binding (a stable object ref
 * per isolate) so the WeakMap entry lives as long as the isolate does.
 *
 * Pass `opts` on Linux/Node.js to inject MemoryStorage and SMTP sendCode
 * instead of the Cloudflare-specific defaults.
 */
export function getIssuerApp(env: Env, opts?: IssuerOpts): ReturnType<typeof createAuthIssuer> {
  const kvKey = (env as Record<string, unknown>)['FREEPIECES_AUTH_STORE']
    ?? (env as Record<string, unknown>)['FP_AUTH_STORE']
    ?? (env as Record<string, unknown>)['AUTH_STORE']
    ?? env;
  let issuerApp = issuerAppCache.get(kvKey as object);
  if (!issuerApp) {
    issuerApp = createAuthIssuer(env, opts?.storage, opts?.sendCode);
    issuerAppCache.set(kvKey as object, issuerApp);
  }
  return issuerApp;
}

/**
 * Pre-warm the OpenAuth issuer's lazy encryption key by making an in-process
 * authorize request. The `lazy()` memoization inside the issuer means this
 * Promise is shared with any concurrent real request — so even a mid-flight
 * warmup reduces the user-visible wait on /oa/authorize. Call via
 * ctx.waitUntil() to run in the background without blocking the HTTP response.
 *
 * Root cause: the first /oa/authorize call per isolate triggers
 * allEncryption() → encryptionKeys() → importSPKI/importPKCS8 for an
 * RSA-OAEP-512 key, which takes ~13 s on a cold Cloudflare Worker isolate.
 * Firing this warmup as soon as the login page is shown gives the import time
 * to finish (or partially finish) before the user clicks a login button.
 */
export async function warmupIssuer(env: Env, origin: string): Promise<void> {
  try {
    const issuerApp = getIssuerApp(env);
    const redirectUri = `${origin}/admin/api/callback`;
    // Drive /authorize in-process — triggers auth.set() → encrypt() →
    // encryptionKey() → allEncryption() → RSA key import.  The response
    // (a 302 redirect) is intentionally discarded.
    await issuerApp.fetch(
      new Request(
        `${origin}/authorize?client_id=freepieces-worker` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}` +
          `&response_type=code&provider=code`,
      ),
    );
  } catch {
    // Warmup is best-effort — swallow all errors
  }
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
