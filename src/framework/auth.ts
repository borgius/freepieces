/**
 * Low-level OAuth URL helpers shared by the worker router and piece
 * implementations.  Higher-level flow logic lives in src/lib/oauth.ts.
 */

/** Build the callback URL that Cloudflare Workers will handle. */
export function buildCallbackUrl(baseUrl: string, pieceName: string): string {
  return `${baseUrl}/auth/callback/${pieceName}`;
}

/** Build the login start URL exposed by this worker. */
export function buildLoginStartUrl(baseUrl: string, pieceName: string): string {
  return `${baseUrl}/auth/login/${pieceName}`;
}
