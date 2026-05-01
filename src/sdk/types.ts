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
   * OpenAuth access token (JWT) for authenticating with the freepieces worker.
   * When set, takes precedence over `token` (static API key).
   * The JWT is verified against the embedded OpenAuth issuer at /oa.
   *
   * Obtain via the OpenAuth authorization flow or `client.authorize()`.
   *
   * @example 'eyJhbGciOiJSUzI1NiIs...'
   */
  accessToken?: string;
  /**
   * The user identity used as the KV lookup key for stored OAuth2 tokens.
   * Required in production (when `token` is a shared API key) so the
   * worker knows whose token to retrieve.
   *
   * In local dev (no `token`) this is sent as the bearer token itself.
   * When using `accessToken`, the userId is extracted from the JWT but
   * can be overridden here.
   *
   * @example 'alice@example.com'
   */
  userId?: string;
  /**
   * Direct runtime credential for API-key or CUSTOM_AUTH pieces.
   * Examples: Slack bot token (`xoxb-...`), raw API key, or an access token
   * you want to pass through at request time.
   *
   * When `token` is set, this is sent as `X-Piece-Token`.
   * When `token` is absent, this becomes the bearer fallback in local dev.
   */
  pieceToken?: string;
  /**
   * Optional custom fetch implementation.
   * Defaults to the global `fetch`.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Per-request timeout in milliseconds. Aborts the `fetch()` with an
   * `AbortSignal.timeout()` when exceeded. Defaults to 30_000 (30s).
   * Set to `0` to disable.
   */
  timeoutMs?: number;
  /**
   * Number of additional retry attempts for transient network / 5xx failures
   * on idempotent requests (`GET` and `trigger`/`listPieces` internally).
   * `run()` is NOT retried by default, since actions may not be idempotent.
   * Defaults to `2`.
   */
  retries?: number;
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

/** Result envelope for trigger calls. */
export interface TriggerResult<T = unknown> {
  ok: boolean;
  events: T[];
}

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
