import { describe, expect, it } from 'vitest';
import { resolveRuntimeRequestAuth } from './request-auth';

describe('resolveRuntimeRequestAuth', () => {
  it('uses the bearer token as both fallbacks in local-dev mode', () => {
    const result = resolveRuntimeRequestAuth(
      new Headers({ authorization: 'Bearer local-token-or-user-id' }),
    );

    expect(result).toEqual({
      ok: true,
      credentials: {
        userId: 'local-token-or-user-id',
        pieceToken: 'local-token-or-user-id',
      },
    });
  });

  it('prefers explicit X-User-Id and X-Piece-Token headers in local-dev mode', () => {
    const result = resolveRuntimeRequestAuth(
      new Headers({
        authorization: 'Bearer ignored-fallback',
        'x-user-id': 'alice@example.com',
        'x-piece-token': 'xoxb-piece-token',
      }),
    );

    expect(result).toEqual({
      ok: true,
      credentials: {
        userId: 'alice@example.com',
        pieceToken: 'xoxb-piece-token',
      },
    });
  });

  it('rejects secured requests when the bearer token does not match RUN_API_KEY', () => {
    const result = resolveRuntimeRequestAuth(
      new Headers({ authorization: 'Bearer wrong-key' }),
      'fp_sk_expected',
    );

    expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
  });

  it('accepts secured requests and separates caller auth from runtime credentials', () => {
    const result = resolveRuntimeRequestAuth(
      new Headers({
        authorization: 'Bearer fp_sk_expected',
        'x-user-id': 'alice@example.com',
        'x-piece-token': 'xoxb-piece-token',
      }),
      'fp_sk_expected',
    );

    expect(result).toEqual({
      ok: true,
      credentials: {
        userId: 'alice@example.com',
        pieceToken: 'xoxb-piece-token',
      },
    });
  });
});
