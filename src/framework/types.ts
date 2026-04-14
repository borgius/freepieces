// ---------------------------------------------------------------------------
// Cloudflare Workers environment bindings
// ---------------------------------------------------------------------------
export interface Env {
  /** Public base URL used for building OAuth callback URLs. */
  FREEPIECES_PUBLIC_URL: string;

  /** KV namespace for encrypted per-user OAuth tokens. Bind in wrangler.toml. */
  TOKEN_STORE: KVNamespace;

  // -- Static credentials stored as Cloudflare Secrets (never in vars) -------
  /** OAuth client/app ID, e.g. from GitHub / Slack / etc. */
  OAUTH_CLIENT_ID: string;
  /** OAuth client secret. */
  OAUTH_CLIENT_SECRET: string;
  /**
   * 64-char hex string representing 32 raw bytes used as AES-GCM key material.
   * Generate with:  openssl rand -hex 32
   * Store with:     wrangler secret put TOKEN_ENCRYPTION_KEY
   */
  TOKEN_ENCRYPTION_KEY: string;

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
export interface PieceAction {
  name: string;
  displayName: string;
  description?: string;
  run(ctx: PieceActionContext): Promise<unknown>;
}

export interface PieceDefinition {
  name: string;
  displayName: string;
  description?: string;
  version: string;
  auth: PieceAuthDefinition;
  actions: PieceAction[];
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
