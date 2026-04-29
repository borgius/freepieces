import { describe, expect, it } from 'vitest';

import '../pieces/index.js';
import { listPieces } from './registry';

describe('listPieces OAuth secret derivation', () => {
  it('includes built-in Cloudflare binding pieces', () => {
    const names = listPieces().map((piece) => piece.name);

    expect(names).toContain('cloudflare-d1');
    expect(names).toContain('cloudflare-queue');
    expect(names).toContain('cloudflare-r2');
    expect(names).toContain('cloudflare-workflow');
  });

  it('uses explicit per-piece secrets for native OAuth pieces', () => {
    const examplePiece = listPieces().find((piece) => piece.name === 'example-oauth');
    const oauthGroup = examplePiece?.secrets.find((group) => group.authType === 'oauth2');
    const keys = oauthGroup?.secrets.map((secret) => secret.key) ?? [];

    expect(keys).toEqual([
      'EXAMPLE_OAUTH_CLIENT_ID',
      'EXAMPLE_OAUTH_CLIENT_SECRET',
      'TOKEN_ENCRYPTION_KEY',
    ]);
  });

  it('keeps Gmail on Gmail-specific OAuth secret names', () => {
    const gmailPiece = listPieces().find((piece) => piece.name === 'gmail');
    const oauthGroup = gmailPiece?.secrets.find((group) => group.authType === 'oauth2');
    const keys = oauthGroup?.secrets.map((secret) => secret.key) ?? [];

    expect(keys).toContain('GMAIL_CLIENT_ID');
    expect(keys).toContain('GMAIL_CLIENT_SECRET');
  });
});
