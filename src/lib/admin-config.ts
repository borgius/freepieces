/**
 * Admin panel configuration constants and helpers.
 *
 * Global/per-piece secret definitions, piece-enable flags, and
 * stored-user detection for the admin SPA.
 */

// ---------------------------------------------------------------------------
// Piece-enable flag
// ---------------------------------------------------------------------------

/** KV key prefix for admin piece-enabled flags. */
export const PIECE_FLAG = (name: string): string => `__admin:enabled:${name}`;

/** Returns true when the piece is enabled (default: all bundled pieces are enabled). */
export async function isPieceEnabled(kv: KVNamespace, name: string): Promise<boolean> {
  const flag = await kv.get(PIECE_FLAG(name));
  return flag !== 'false';
}

// ---------------------------------------------------------------------------
// Global infrastructure secrets
// ---------------------------------------------------------------------------

/**
 * Global infrastructure secrets shown in the Settings › Secrets panel.
 * These keys are filtered OUT of per-piece secret groups in the pieces API.
 *
 * Each variable is resolved in order: FREEPIECES_<NAME> → FP_<NAME> → <NAME>.
 * The canonical (FREEPIECES_) form is listed here; the FP_ and un-prefixed
 * legacy names are accepted automatically by the env helpers in src/lib/env.ts.
 */
export const GLOBAL_SECRET_DEFS = [
  {
    key: 'FREEPIECES_PUBLIC_URL',
    displayName: 'Public URL',
    description: 'Base URL for OAuth callbacks and webhook routes (also accepted: FP_PUBLIC_URL). Set as a [vars] entry in wrangler.toml.',
    required: true,
    command: 'Set FREEPIECES_PUBLIC_URL in wrangler.toml [vars]',
  },
  {
    key: 'FREEPIECES_TOKEN_STORE',
    displayName: 'Token Store (KV Namespace)',
    description: 'KV namespace binding for storing OAuth tokens and admin state (also accepted: FP_TOKEN_STORE, TOKEN_STORE).',
    required: true,
    command: 'Configure [[kv_namespaces]] binding = "FREEPIECES_TOKEN_STORE" in wrangler.toml',
  },
  {
    key: 'FREEPIECES_AUTH_STORE',
    displayName: 'Auth Store (KV Namespace)',
    description: 'KV namespace binding for OpenAuth session/token storage (also accepted: FP_AUTH_STORE, AUTH_STORE).',
    required: true,
    command: 'Configure [[kv_namespaces]] binding = "FREEPIECES_AUTH_STORE" in wrangler.toml',
  },
  {
    key: 'FREEPIECES_TOKEN_ENCRYPTION_KEY',
    displayName: 'Token Encryption Key',
    description: 'AES-GCM 32-byte key for encrypting stored OAuth tokens (also accepted: FP_TOKEN_ENCRYPTION_KEY, TOKEN_ENCRYPTION_KEY). Generate: openssl rand -hex 32',
    required: true,
    command: 'wrangler secret put FREEPIECES_TOKEN_ENCRYPTION_KEY',
  },
  {
    key: 'FREEPIECES_ADMIN_EMAILS',
    displayName: 'Admin Emails',
    description: 'Comma-separated list of email addresses with admin access (also accepted: FP_ADMIN_EMAILS, ADMIN_EMAILS).',
    required: true,
    command: 'wrangler secret put FREEPIECES_ADMIN_EMAILS',
  },
  {
    key: 'FREEPIECES_ALLOWED_EMAILS',
    displayName: 'Allowed Emails',
    description: 'Comma-separated list of non-admin email addresses allowed to register (also accepted: FP_ALLOWED_EMAILS, ALLOWED_EMAILS).',
    required: false,
    command: 'wrangler secret put FREEPIECES_ALLOWED_EMAILS',
  },
  {
    key: 'FREEPIECES_AUTH_SENDER_EMAIL',
    displayName: 'Auth Sender Email',
    description: 'Verified sender email address for verification code delivery (also accepted: FP_AUTH_SENDER_EMAIL, AUTH_SENDER_EMAIL).',
    required: false,
    command: 'Set FREEPIECES_AUTH_SENDER_EMAIL in wrangler.toml [vars] or wrangler secret put FREEPIECES_AUTH_SENDER_EMAIL',
  },
  {
    key: 'FREEPIECES_GOOGLE_CLIENT_ID',
    displayName: 'Google OAuth Client ID',
    description: 'Google OAuth client ID for social login (also accepted: FP_GOOGLE_CLIENT_ID, GOOGLE_CLIENT_ID).',
    required: false,
    command: 'wrangler secret put FREEPIECES_GOOGLE_CLIENT_ID',
  },
  {
    key: 'FREEPIECES_GOOGLE_CLIENT_SECRET',
    displayName: 'Google OAuth Client Secret',
    description: 'Google OAuth client secret for social login (also accepted: FP_GOOGLE_CLIENT_SECRET, GOOGLE_CLIENT_SECRET).',
    required: false,
    command: 'wrangler secret put FREEPIECES_GOOGLE_CLIENT_SECRET',
  },
  {
    key: 'FREEPIECES_GITHUB_CLIENT_ID',
    displayName: 'GitHub OAuth Client ID',
    description: 'GitHub OAuth client ID for social login (also accepted: FP_GITHUB_CLIENT_ID, GITHUB_CLIENT_ID).',
    required: false,
    command: 'wrangler secret put FREEPIECES_GITHUB_CLIENT_ID',
  },
  {
    key: 'FREEPIECES_GITHUB_CLIENT_SECRET',
    displayName: 'GitHub OAuth Client Secret',
    description: 'GitHub OAuth client secret for social login (also accepted: FP_GITHUB_CLIENT_SECRET, GITHUB_CLIENT_SECRET).',
    required: false,
    command: 'wrangler secret put FREEPIECES_GITHUB_CLIENT_SECRET',
  },
  {
    key: 'FREEPIECES_RUN_API_KEY',
    displayName: 'Runtime API Key',
    description: 'Shared caller-auth key for /run, /trigger, and /subscriptions (also accepted: FP_RUN_API_KEY, RUN_API_KEY). Prefix with fp_sk_.',
    required: false,
    command: 'wrangler secret put FREEPIECES_RUN_API_KEY',
  },
] as const;

/**
 * All key names (canonical + legacy) that belong to global config.
 * Filtered out of per-piece secret groups in the pieces API.
 */
export const GLOBAL_SECRET_KEY_SET = new Set<string>([
  ...GLOBAL_SECRET_DEFS.map((d) => d.key),
  // Legacy un-prefixed names kept for backward compat filtering
  'TOKEN_STORE', 'AUTH_STORE', 'TOKEN_ENCRYPTION_KEY', 'ADMIN_EMAILS', 'ALLOWED_EMAILS',
  'AUTH_SENDER_EMAIL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'RUN_API_KEY',
  // FP_ short-prefix names
  'FP_PUBLIC_URL', 'FP_TOKEN_STORE', 'FP_AUTH_STORE', 'FP_TOKEN_ENCRYPTION_KEY',
  'FP_ADMIN_EMAILS', 'FP_ALLOWED_EMAILS', 'FP_AUTH_SENDER_EMAIL',
  'FP_GOOGLE_CLIENT_ID', 'FP_GOOGLE_CLIENT_SECRET',
  'FP_GITHUB_CLIENT_ID', 'FP_GITHUB_CLIENT_SECRET', 'FP_RUN_API_KEY',
]);

/**
 * Extra secret groups that are not derivable from AP auth definitions but are
 * needed for specific pieces (e.g. webhook signature verification).
 * Keyed by piece name.
 */
export const PIECE_EXTRA_SECRET_GROUPS: Record<string, Array<{ authType: string; displayName: string; secrets: Array<{ key: string; displayName: string; description: string; required: boolean; command: string }> }>> = {
  slack: [
    {
      authType: 'WEBHOOK_SECURITY',
      displayName: 'Webhook Security',
      secrets: [
        {
          key: 'SLACK_SIGNING_SECRET',
          displayName: 'Slack Signing Secret',
          description: 'Used to verify incoming Slack Event API webhook request signatures. Found in Slack app → Basic Information → Signing Secret.',
          required: false,
          command: 'wrangler secret put SLACK_SIGNING_SECRET',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function pieceSupportsStoredUsers(auth: unknown): boolean {
  const authDefs = Array.isArray(auth) ? auth : auth ? [auth] : [];
  return authDefs.some((authDef) => {
    if (!authDef || typeof authDef !== 'object') return false;
    const type = String((authDef as { type?: unknown }).type ?? '');
    return type === 'oauth2' || type === 'OAUTH2';
  });
}

/** True when at least one OAuth2 auth mode has a userInfoUrl configured. */
export function pieceHasAutoUserId(auth: unknown): boolean {
  const authDefs = Array.isArray(auth) ? auth : auth ? [auth] : [];
  return authDefs.some((authDef) => {
    if (!authDef || typeof authDef !== 'object') return false;
    const a = authDef as { type?: unknown; userInfoUrl?: unknown };
    return (a.type === 'oauth2' || a.type === 'OAUTH2') && typeof a.userInfoUrl === 'string' && a.userInfoUrl.length > 0;
  });
}
