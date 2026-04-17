// ---------------------------------------------------------------------------
// Cloudflare Workers environment bindings
// ---------------------------------------------------------------------------
//
// Every string var / secret and every KV binding is resolved via the helpers in
// src/lib/env.ts, which check keys in this priority order:
//   1. FREEPIECES_<NAME>  — canonical prefixed form (preferred)
//   2. FP_<NAME>          — short-prefix fallback
//   3. <NAME>             — un-prefixed legacy name (backward compat)
//
// Both the FREEPIECES_ and FP_ variants are listed as optional below so
// TypeScript accepts wrangler.toml configs that use either naming scheme.
// ---------------------------------------------------------------------------
export interface Env {
  // ── Public URL ──────────────────────────────────────────────────────────
  /** Public base URL (canonical). e.g. FREEPIECES_PUBLIC_URL in [vars]. */
  FREEPIECES_PUBLIC_URL?: string;
  /** Short-prefix alias. e.g. FP_PUBLIC_URL in [vars]. */
  FP_PUBLIC_URL?: string;
  /** Legacy un-prefixed name (backward compat). */
  PUBLIC_URL?: string;

  // ── Token store KV binding ───────────────────────────────────────────────
  /** KV namespace for encrypted OAuth tokens and admin state (canonical). */
  FREEPIECES_TOKEN_STORE?: KVNamespace;
  /** Short-prefix alias. */
  FP_TOKEN_STORE?: KVNamespace;
  /** Legacy un-prefixed binding name (backward compat). */
  TOKEN_STORE?: KVNamespace;

  // ── Token encryption key ─────────────────────────────────────────────────
  /**
   * 64-char hex string (32 raw bytes) for AES-GCM encryption (canonical).
   * Generate with: openssl rand -hex 32
   * Store with:    wrangler secret put FREEPIECES_TOKEN_ENCRYPTION_KEY
   */
  FREEPIECES_TOKEN_ENCRYPTION_KEY?: string;
  /** Short-prefix alias. */
  FP_TOKEN_ENCRYPTION_KEY?: string;
  /** Legacy un-prefixed name (backward compat). */
  TOKEN_ENCRYPTION_KEY?: string;

  // ── Auth store KV binding ────────────────────────────────────────────────
  /** KV namespace for OpenAuth session/token storage (canonical). */
  FREEPIECES_AUTH_STORE?: KVNamespace;
  /** Short-prefix alias. */
  FP_AUTH_STORE?: KVNamespace;
  /** Legacy un-prefixed binding name (backward compat). */
  AUTH_STORE?: KVNamespace;

  // ── Runtime API key ───────────────────────────────────────────────────────
  /**
   * Shared caller-auth secret for /run, /trigger, /subscriptions (canonical).
   * Store with: wrangler secret put FREEPIECES_RUN_API_KEY
   */
  FREEPIECES_RUN_API_KEY?: string;
  /** Short-prefix alias. */
  FP_RUN_API_KEY?: string;
  /** Legacy un-prefixed name (backward compat). */
  RUN_API_KEY?: string;

  // ── Admin / invite-only email lists ──────────────────────────────────────
  /** Comma-separated admin emails (canonical). */
  FREEPIECES_ADMIN_EMAILS?: string;
  FP_ADMIN_EMAILS?: string;
  /** Legacy un-prefixed name (backward compat). */
  ADMIN_EMAILS?: string;

  /** Comma-separated allowed (non-admin) emails (canonical). */
  FREEPIECES_ALLOWED_EMAILS?: string;
  FP_ALLOWED_EMAILS?: string;
  /** Legacy un-prefixed name (backward compat). */
  ALLOWED_EMAILS?: string;

  // ── Email sender ──────────────────────────────────────────────────────────
  /** Verified sender address for verification code emails (canonical). */
  FREEPIECES_AUTH_SENDER_EMAIL?: string;
  FP_AUTH_SENDER_EMAIL?: string;
  /** Legacy un-prefixed name (backward compat). */
  AUTH_SENDER_EMAIL?: string;

  // ── Email Workers send binding ────────────────────────────────────────────
  /**
   * Cloudflare Email Workers send binding for delivering verification codes.
   * Configured via [[send_email]] in wrangler.toml.
   */
  FREEPIECES_EMAIL?: { send: (msg: unknown) => Promise<void> };
  FP_EMAIL?: { send: (msg: unknown) => Promise<void> };
  /** Legacy un-prefixed binding name (backward compat). */
  EMAIL?: { send: (msg: unknown) => Promise<void> };

  // ── OpenAuth social providers ─────────────────────────────────────────────
  FREEPIECES_GOOGLE_CLIENT_ID?: string;
  FP_GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_ID?: string;

  FREEPIECES_GOOGLE_CLIENT_SECRET?: string;
  FP_GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_SECRET?: string;

  FREEPIECES_GITHUB_CLIENT_ID?: string;
  FP_GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_ID?: string;

  FREEPIECES_GITHUB_CLIENT_SECRET?: string;
  FP_GITHUB_CLIENT_SECRET?: string;
  GITHUB_CLIENT_SECRET?: string;

  // ── Cloudflare Queue / static-assets bindings ─────────────────────────────
  /** Cloudflare Queue for async trigger processing. */
  TRIGGER_QUEUE?: Queue;
  /** Static-assets binding for the admin SPA. */
  ASSETS?: Fetcher;

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
  /**
   * Optional URL to fetch the authorized user's profile after token exchange.
   * When set, the callback can auto-resolve the userId from the provider
   * (e.g. Google's userinfo endpoint returns { email }).
   */
  userInfoUrl?: string;
  /**
   * JSON field in the userInfoUrl response to use as the userId.
   * Defaults to 'email'.
   */
  userIdField?: string;
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
