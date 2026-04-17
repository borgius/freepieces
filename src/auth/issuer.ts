/**
 * OpenAuth issuer for freepieces — embedded Hono app mounted at /oa.
 *
 * Providers: Password, Code (passwordless email), Google, GitHub.
 * Storage:   Cloudflare KV via AUTH_STORE binding.
 * Email:     Cloudflare Email Workers (send_email binding) for verification codes.
 * Access:    Invite-only — only emails listed in ADMIN_EMAILS or ALLOWED_EMAILS can register.
 * Admin:     Emails in ADMIN_EMAILS get the "admin" subject; others get "user".
 */

import { issuer } from '@openauthjs/openauth';
import { CodeProvider } from '@openauthjs/openauth/provider/code';
import { CodeUI } from '@openauthjs/openauth/ui/code';
import { PasswordProvider } from '@openauthjs/openauth/provider/password';
import { PasswordUI } from '@openauthjs/openauth/ui/password';
import { GoogleProvider } from '@openauthjs/openauth/provider/google';
import { GithubProvider } from '@openauthjs/openauth/provider/github';
import { CloudflareStorage } from '@openauthjs/openauth/storage/cloudflare';
import { subjects } from './subjects';
import type { Env } from '../framework/types';
import { sendVerificationEmail } from './email';
import { getEnvStr, getKVBinding } from '../lib/env';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse comma-separated email list from env var. */
function parseEmailList(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Check if an email is allowed to register (invite-only). */
function isEmailAllowed(email: string, env: Env): boolean {
  const adminEmails = parseEmailList(getEnvStr(env, 'ADMIN_EMAILS'));
  const allowedEmails = parseEmailList(getEnvStr(env, 'ALLOWED_EMAILS'));
  const normalised = email.toLowerCase();
  return adminEmails.has(normalised) || allowedEmails.has(normalised);
}

/** Check if an email is an admin. */
function isAdmin(email: string, env: Env): boolean {
  const adminEmails = parseEmailList(getEnvStr(env, 'ADMIN_EMAILS'));
  return adminEmails.has(email.toLowerCase());
}

// ---------------------------------------------------------------------------
// Factory — creates an issuer bound to the current request's env
// ---------------------------------------------------------------------------

/**
 * Create the OpenAuth issuer Hono app.
 *
 * Called per-request so we have access to the Worker's `env` bindings.
 * OpenAuth's issuer() returns a Hono app that we mount at /oa in the main worker.
 */
export function createAuthIssuer(env: Env) {
  const providers: Record<string, ReturnType<typeof CodeProvider> | ReturnType<typeof PasswordProvider> | ReturnType<typeof GoogleProvider> | ReturnType<typeof GithubProvider>> = {};

  // ── Code provider (passwordless email) — always available ───────────
  providers.code = CodeProvider(
    CodeUI({
      sendCode: async (claims, code) => {
        const email = claims.email ?? '';
        if (!isEmailAllowed(email, env)) {
          throw new Error('This email is not authorized. Registration is invite-only.');
        }
        await sendVerificationEmail(env, email, code);
      },
    }),
  );

  // ── Password provider — always available ────────────────────────────
  providers.password = PasswordProvider(
    PasswordUI({
      sendCode: async (email, code) => {
        if (!isEmailAllowed(email, env)) {
          throw new Error('This email is not authorized. Registration is invite-only.');
        }
        await sendVerificationEmail(env, email, code);
      },
    }),
  );

  // ── Google OAuth — enabled when credentials are configured ──────────
  const googleClientId = getEnvStr(env, 'GOOGLE_CLIENT_ID');
  const googleClientSecret = getEnvStr(env, 'GOOGLE_CLIENT_SECRET');
  if (googleClientId && googleClientSecret) {
    providers.google = GoogleProvider({
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      scopes: ['openid', 'email', 'profile'],
    });
  }

  // ── GitHub OAuth — enabled when credentials are configured ──────────
  const githubClientId = getEnvStr(env, 'GITHUB_CLIENT_ID');
  const githubClientSecret = getEnvStr(env, 'GITHUB_CLIENT_SECRET');
  if (githubClientId && githubClientSecret) {
    providers.github = GithubProvider({
      clientID: githubClientId,
      clientSecret: githubClientSecret,
      scopes: ['user:email'],
    });
  }

  return issuer({
    providers,
    subjects,
    storage: CloudflareStorage({ namespace: getKVBinding(env, 'AUTH_STORE') as any }),
    allow: async () => true, // embedded issuer — all clients are trusted
    async success(ctx, value) {
      let email: string | undefined;

      const v = value as Record<string, unknown>;
      if (value.provider === 'code' || value.provider === 'password') {
        const claims = v.claims as Record<string, string> | undefined;
        email = claims?.email ?? (v.email as string | undefined);
      } else if (value.provider === 'google') {
        const tokenset = v.tokenset as { access: string };
        const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenset.access}` },
        });
        if (res.ok) {
          const info = (await res.json()) as { email?: string };
          email = info.email;
        }
      } else if (value.provider === 'github') {
        const tokenset = v.tokenset as { access: string };
        const res = await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${tokenset.access}`,
            'User-Agent': 'freepieces-openauth',
          },
        });
        if (res.ok) {
          const emails = (await res.json()) as Array<{
            email: string;
            primary: boolean;
            verified: boolean;
          }>;
          const primary = emails.find((e) => e.primary && e.verified);
          email = primary?.email ?? emails.find((e) => e.verified)?.email;
        }
      }

      if (!email) {
        return new Response('Could not determine email address', { status: 400 });
      }

      // Invite-only gate for social logins (Code/Password already gate in sendCode)
      if (!isEmailAllowed(email, env)) {
        return new Response('This email is not authorized. Registration is invite-only.', {
          status: 403,
        });
      }

      const userId = email.toLowerCase();

      if (isAdmin(email, env)) {
        return ctx.subject('admin', { userId, email: userId, role: 'admin' });
      }
      return ctx.subject('user', { userId, email: userId });
    },
  });
}
