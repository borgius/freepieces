/**
 * OpenAuth client for token verification.
 *
 * Used by admin-api and runtime-auth-middleware to verify JWTs
 * issued by the embedded OpenAuth issuer.
 */

import { createClient } from '@openauthjs/openauth/client';
import { subjects } from './subjects';

/**
 * Create an OpenAuth client that verifies tokens against the embedded issuer.
 *
 * @param publicUrl    - The FREEPIECES_PUBLIC_URL (base URL of the Worker).
 *                       The issuer is mounted at `/oa`, so issuer URL = `${publicUrl}/oa`.
 * @param customFetch  - Optional fetch override. Pass an in-process fetch when calling
 *                       from inside the same Worker to avoid self-referential subrequests,
 *                       which Cloudflare Workers handle unreliably.
 */
export function createAuthClient(
  publicUrl: string,
  customFetch?: typeof fetch,
) {
  // iss in JWT tokens equals the request origin seen by the issuer,
  // which is FREEPIECES_PUBLIC_URL's origin (no /oa path component).
  return createClient({
    clientID: 'freepieces-worker',
    issuer: new URL(publicUrl).origin,
    ...(customFetch ? { fetch: customFetch } : {}),
  });
}

export { subjects };

export type AuthClient = ReturnType<typeof createAuthClient>;
