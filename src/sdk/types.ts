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
   * Bearer token / predefined API key.
   * Sent as `Authorization: Bearer <token>` on every request.
   */
  token?: string;
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
