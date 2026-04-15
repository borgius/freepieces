// ---------------------------------------------------------------------------
// freepieces SDK — shared types
// ---------------------------------------------------------------------------

/** Configuration for a FreePiecesClient instance. */
export interface FreePiecesClientOptions {
  /**
   * Base URL of the deployed freepieces Cloudflare Worker.
   * @example 'https://freepieces.example.workers.dev'
   */
  baseUrl: string;
  /**
   * Shared API key that gates the /run endpoint.
   * Must match the `RUN_API_KEY` Cloudflare Secret on the worker.
   * Should be prefixed with `fp_sk_` (e.g. `fp_sk_<hex32>`) so it is
   * recognisable in logs and different from OAuth user tokens.
   *
   * When set, send as `Authorization: Bearer <token>` and pass `userId`
   * separately via `X-User-Id`.
   *
   * When absent (local dev without RUN_API_KEY), the userId is sent as
   * the bearer token directly (backward-compatible behaviour).
   */
  token?: string;
  /**
   * The user identity used as the KV lookup key for stored OAuth2 tokens.
   * Required in production (when `token` is a shared API key) so the
   * worker knows whose token to retrieve.
   *
   * In local dev (no `token`) this is sent as the bearer token itself.
   *
   * @example 'alice@example.com'
   */
  userId?: string;
  /**
   * Optional custom fetch implementation.
   * Defaults to the global `fetch`.
   */
  fetch?: typeof globalThis.fetch;
}

/** Shape returned by GET /pieces */
export interface PieceSummary {
  name: string;
  displayName: string;
  description?: string;
  version?: string;
  authType: string;
  actions: Array<{ name: string; displayName: string; description?: string }>;
  triggers?: Array<{ name: string; displayName: string; type: string }>;
}

/** Generic action call result envelope. */
export type ActionResult<T = unknown> = T;

/** Error thrown when a worker response is not ok. */
export class FreePiecesError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string,
  ) {
    super(message);
    this.name = 'FreePiecesError';
  }
}
