// ---------------------------------------------------------------------------
// Cloudflare Workers environment bindings
// ---------------------------------------------------------------------------
export interface Env {
  /** Public base URL used for building OAuth callback URLs. */
  FREEPIECES_PUBLIC_URL: string;

  /** KV namespace for encrypted per-user OAuth tokens and admin state. Bind in wrangler.toml. */
  TOKEN_STORE: KVNamespace;

  /** Cloudflare Queue for async trigger processing. Bind in wrangler.toml as [[queues.producers]]. */
  TRIGGER_QUEUE?: Queue;

  /** Static-assets binding for the admin SPA. Configured via [assets] in wrangler.toml. */
  ASSETS?: Fetcher;

  // -- Static credentials stored as Cloudflare Secrets (never in vars) -------
  /**
   * 64-char hex string representing 32 raw bytes used as AES-GCM key material.
   * Generate with:  openssl rand -hex 32
   * Store with:     wrangler secret put TOKEN_ENCRYPTION_KEY
   */
  TOKEN_ENCRYPTION_KEY: string;

  /** Admin UI username. Set via wrangler secret or .env for local dev. */
  ADMIN_USER?: string;
  /** Admin UI password. Set via wrangler secret or .env for local dev. */
  ADMIN_PASSWORD?: string;
  /**
   * Slack app signing secret (found in Slack app → Basic Information → Signing Secret).
   * When set, all requests to POST /webhook/slack are verified via X-Slack-Signature.
   * Store with: wrangler secret put SLACK_SIGNING_SECRET
   */
  SLACK_SIGNING_SECRET?: string;
  /**
   * 64-char hex HMAC signing key for admin session tokens.
   * Generate with:  openssl rand -hex 32
   * Store with:     wrangler secret put ADMIN_SIGNING_KEY
   */
  ADMIN_SIGNING_KEY?: string;

  /**
   * Optional shared secret that gates all /run, /trigger, and /subscriptions
   * endpoints. When set, every request to those routes must carry:
   *   Authorization: Bearer <RUN_API_KEY>
    * and any runtime credentials must be sent separately as:
   *   X-User-Id: <userId>
    *   X-Piece-Token: <token>
   *
    * When absent (e.g. local dev with wrangler dev), the bearer token remains
    * the fallback for both userId and direct piece-token behaviour.
   *
   * Generate with:  openssl rand -hex 32
   * Store with:     wrangler secret put RUN_API_KEY
   */
  RUN_API_KEY?: string;

  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Auth definitions
// ---------------------------------------------------------------------------
export type AuthKind = 'none' | 'oauth2' | 'apiKey';

export interface OAuth2AuthDefinition {
  type: 'oauth2';
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Env key for this piece's OAuth client ID secret. */
  clientIdEnvKey: string;
  /** Env key for this piece's OAuth client secret. */
  clientSecretEnvKey: string;
}

export interface ApiKeyAuthDefinition {
  type: 'apiKey';
  /** Header name the key is sent in, e.g. "X-Api-Key". */
  headerName?: string;
}

export interface NoAuthDefinition {
  type: 'none';
}

export type PieceAuthDefinition =
  | OAuth2AuthDefinition
  | ApiKeyAuthDefinition
  | NoAuthDefinition;

// ---------------------------------------------------------------------------
// Action context
// ---------------------------------------------------------------------------
export interface PieceActionContext {
  /** Resolved auth credentials (token, api key, etc.). */
  auth?: Record<string, string>;
  /** User-supplied props for this action invocation. */
  props?: Record<string, unknown>;
  /** Full Cloudflare Workers env (bindings + secrets). */
  env: Env;
}

// ---------------------------------------------------------------------------
// Piece + action definitions
// ---------------------------------------------------------------------------

/**
 * A single named input property for an action or trigger.
 * Covers both freepieces native props and the AP Property runtime shape.
 */
export interface PropDefinition {
  /** AP PropertyType string, e.g. 'SHORT_TEXT', 'NUMBER', 'CHECKBOX', 'OAUTH_DYNAMIC_SELECT' */
  type: string;
  displayName: string;
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
}

export interface PieceAction {
  name: string;
  displayName: string;
  description?: string;
  /** Named input parameters for this action. */
  props?: Record<string, PropDefinition>;
  run(ctx: PieceActionContext): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Trigger context (native pieces)
// ---------------------------------------------------------------------------

/**
 * Context passed to each `PieceTrigger.run()` call.
 *
 * `lastPollMs` — Unix epoch milliseconds of the last successful poll.
 *   Callers should persist this across runs (e.g. in KV) and pass it back
 *   on the next invocation so the trigger only returns new items.
 *   Pass `0` (or omit) to request the last ~5 items for back-fill / test.
 */
export interface PieceTriggerContext {
  /** Resolved OAuth2 credentials from KV (or bearer token passed at request time). */
  auth?: Record<string, string>;
  /** User-supplied filter props for this trigger (e.g. from/to/subject/label). */
  props?: Record<string, unknown>;
  /**
   * Unix epoch ms of the last successful poll.
   * Triggers use this to build their `after:` query and return only newer items.
   */
  lastPollMs?: number;
  /** Full Cloudflare Workers env (bindings + secrets). */
  env: Env;
}

export interface PieceTrigger {
  name: string;
  displayName: string;
  description?: string;
  /** Trigger strategy tag, e.g. 'POLLING'. Used for display only in native pieces. */
  type: 'POLLING';
  /** Named input parameters (filter props). */
  props?: Record<string, PropDefinition>;
  /**
   * Execute the trigger: list new events since `ctx.lastPollMs`.
   * Returns an array of event objects (empty = nothing new).
   */
  run(ctx: PieceTriggerContext): Promise<unknown[]>;
}

export interface PieceDefinition {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  auth: PieceAuthDefinition;
  actions: PieceAction[];
  triggers?: PieceTrigger[];
}

// ---------------------------------------------------------------------------
// Activepieces native piece support (zero-adapt drop-in)
// ---------------------------------------------------------------------------

/**
 * Auth property from @activepieces/pieces-framework as it appears at runtime.
 * Supports SECRET_TEXT, OAUTH2, CUSTOM_AUTH, BASIC_AUTH auth types.
 */
export interface ApPieceAuth {
  /** AP auth type string, e.g. 'SECRET_TEXT' | 'OAUTH2' | 'CUSTOM_AUTH' | 'BASIC_AUTH' */
  type: string;
  displayName?: string;
  description?: string;
  /** For CUSTOM_AUTH: named sub-properties (key = propName, value = prop descriptor) */
  props?: Record<string, {
    type: string;
    required?: boolean;
    description?: string;
    displayName?: string;
  }>;
  /** For OAUTH2: authorization URL */
  authUrl?: string;
  /** For OAUTH2: token URL */
  tokenUrl?: string;
  /** For OAUTH2: scopes list */
  scope?: string[];
}

/**
 * Minimal shape of an Activepieces Piece class instance as exported by
 * @activepieces/piece-* community packages.  Use this type to register
 * community pieces with registerApPiece() — no adapter code needed.
 */
export interface ApPiece {
  displayName: string;
  description?: string;
  /** Auth definition(s) — AP allows multiple auth options (e.g. OAuth2 + Bot Token) */
  auth?: ApPieceAuth | ApPieceAuth[];
  /**
   * Actions map keyed by action name.  Private by convention in AP source but
   * accessible at runtime (the underscore is just a TypeScript visibility marker
   * on the compiled class, not a true Symbol/WeakMap private slot).
   */
  _actions: Record<string, {
    name: string;
    displayName: string;
    description?: string;
    requireAuth?: boolean;
    /** Named input props — AP Property descriptor objects keyed by prop name. */
    props?: Record<string, unknown>;
    run(context: unknown): Promise<unknown>;
  }>;
  /**
   * Triggers map keyed by trigger name.  Same runtime accessibility note as _actions.
   */
  _triggers: Record<string, ApTrigger>;
}

/**
 * Minimal shape of an Activepieces Trigger as exported by community pieces.
 * All three AP strategies (APP_WEBHOOK, WEBHOOK, POLLING) share this interface —
 * the `run()` call is identical regardless of strategy.
 */
export interface ApTrigger {
  name: string;
  displayName: string;
  description?: string;
  /** AP trigger strategy: 'APP_WEBHOOK' | 'WEBHOOK' | 'POLLING' */
  type: string;
  /** Named input props — AP Property descriptor objects keyed by prop name. */
  props?: Record<string, unknown>;
  /**
   * Filter/transform function called when a webhook payload arrives.
   * Returns an array of matched event objects (empty = no match).
   */
  run(context: unknown): Promise<unknown[]>;
  /** Called once when the trigger is enabled (e.g. to register a webhook). */
  onEnable?(context: unknown): Promise<void>;
  /** Called once when the trigger is disabled. */
  onDisable?(context: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// OAuth token shape stored in KV
// ---------------------------------------------------------------------------
export interface OAuthTokenRecord {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix ms
  scope?: string;
  tokenType?: string;
}
