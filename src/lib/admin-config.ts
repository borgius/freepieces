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
 */
export const GLOBAL_SECRET_DEFS = [
  {
    key: 'FREEPIECES_PUBLIC_URL',
    displayName: 'Public URL',
    description: 'Base URL for OAuth callbacks and webhook routes. Set as a [vars] entry in wrangler.toml.',
    required: true,
    command: 'Set FREEPIECES_PUBLIC_URL in wrangler.toml [vars]',
  },
  {
    key: 'TOKEN_STORE',
    displayName: 'Token Store (KV Namespace)',
    description: 'KV namespace binding for storing OAuth tokens and admin state.',
    required: true,
    command: 'Configure [[kv_namespaces]] in wrangler.toml',
  },
  {
    key: 'AUTH_STORE',
    displayName: 'Auth Store (KV Namespace)',
    description: 'KV namespace binding for OpenAuth session/token storage.',
    required: true,
    command: 'Configure [[kv_namespaces]] in wrangler.toml',
  },
  {
    key: 'TOKEN_ENCRYPTION_KEY',
    displayName: 'Token Encryption Key',
    description: 'AES-GCM 32-byte key for encrypting stored OAuth tokens. Generate: openssl rand -hex 32',
    required: true,
    command: 'wrangler secret put TOKEN_ENCRYPTION_KEY',
  },
  {
    key: 'ADMIN_EMAILS',
    displayName: 'Admin Emails',
    description: 'Comma-separated list of email addresses with admin access. These users get full admin panel access.',
    required: true,
    command: 'wrangler secret put ADMIN_EMAILS',
  },
  {
    key: 'ALLOWED_EMAILS',
    displayName: 'Allowed Emails',
    description: 'Comma-separated list of non-admin email addresses allowed to register. Registration is invite-only.',
    required: false,
    command: 'wrangler secret put ALLOWED_EMAILS',
  },
  {
    key: 'AUTH_SENDER_EMAIL',
    displayName: 'Auth Sender Email',
    description: 'Verified sender email address for verification code delivery via Cloudflare Email Workers.',
    required: false,
    command: 'Set AUTH_SENDER_EMAIL in wrangler.toml [vars] or wrangler secret put AUTH_SENDER_EMAIL',
  },
  {
    key: 'GOOGLE_CLIENT_ID',
    displayName: 'Google OAuth Client ID',
    description: 'Google OAuth client ID for social login (OpenAuth). Enables "Sign in with Google".',
    required: false,
    command: 'wrangler secret put GOOGLE_CLIENT_ID',
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    displayName: 'Google OAuth Client Secret',
    description: 'Google OAuth client secret for social login (OpenAuth).',
    required: false,
    command: 'wrangler secret put GOOGLE_CLIENT_SECRET',
  },
  {
    key: 'GITHUB_CLIENT_ID',
    displayName: 'GitHub OAuth Client ID',
    description: 'GitHub OAuth client ID for social login (OpenAuth). Enables "Sign in with GitHub".',
    required: false,
    command: 'wrangler secret put GITHUB_CLIENT_ID',
  },
  {
    key: 'GITHUB_CLIENT_SECRET',
    displayName: 'GitHub OAuth Client Secret',
    description: 'GitHub OAuth client secret for social login (OpenAuth).',
    required: false,
    command: 'wrangler secret put GITHUB_CLIENT_SECRET',
  },
  {
    key: 'RUN_API_KEY',
    displayName: 'Runtime API Key',
    description: 'Shared caller-auth key for /run, /trigger, and /subscriptions. Prefix with fp_sk_. (echo "fp_sk_$(openssl rand -hex 32)")',
    required: false,
    command: 'wrangler secret put RUN_API_KEY',
  },
] as const;

/** Keys that belong to global config — filtered out of per-piece secret groups. */
export const GLOBAL_SECRET_KEY_SET = new Set<string>(GLOBAL_SECRET_DEFS.map((d) => d.key));

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
