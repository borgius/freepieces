/**
 * Example OAuth2 piece — demonstrates the native freepieces piece model.
 *
 * This piece uses OAuth2 to authenticate with a provider (GitHub used as the
 * example).  The login flow is handled by the worker's /auth/login/:piece and
 * /auth/callback/:piece endpoints.
 *
 * To use a real provider replace the authorizationUrl / tokenUrl below and
 * register OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET as Cloudflare Secrets.
 */

import { createPiece } from '../framework/piece';

export const exampleOAuthPiece = createPiece({
  name: 'example-oauth',
  displayName: 'Example OAuth2 Piece',
  description: 'Demonstrates OAuth2 authentication flow using the freepieces framework.',
  version: '0.1.0',
  auth: {
    type: 'oauth2',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'repo']
  },
  actions: [
    {
      name: 'get-user',
      displayName: 'Get Authenticated User',
      description: 'Returns the GitHub profile of the authenticated user.',
      async run(ctx) {
        const token = ctx.auth?.accessToken ?? ctx.auth?.token;
        if (!token) throw new Error('No access token available — complete OAuth login first');

        const resp = await fetch('https://api.github.com/user', {
          headers: {
            authorization: `Bearer ${token}`,
            'user-agent': 'freepieces/0.1.0'
          }
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`GitHub API error (${resp.status}): ${text}`);
        }

        return resp.json();
      }
    }
  ]
});
