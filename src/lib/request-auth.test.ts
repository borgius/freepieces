import { describe, expect, it } from 'vitest';
import { resolveRuntimeRequestAuth } from './request-auth';

describe('resolveRuntimeRequestAuth', () => {
  it('uses the bearer token as both fallbacks in local-dev mode', async () => {
    const result = await resolveRuntimeRequestAuth(
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

  it('prefers explicit X-User-Id and X-Piece-Token headers in local-dev mode', async () => {
    const result = await resolveRuntimeRequestAuth(
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

  it('rejects secured requests when the bearer token does not match RUN_API_KEY', async () => {
    const result = await resolveRuntimeRequestAuth(
      new Headers({ authorization: 'Bearer wrong-key' }),
      'fp_sk_expected',
    );

    expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
  });

  it('accepts secured requests and separates caller auth from runtime credentials', async () => {
    const result = await resolveRuntimeRequestAuth(
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

  describe('X-Piece-Auth', () => {
    it('parses a valid JSON object into pieceAuthProps in local-dev mode', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers({
          authorization: 'Bearer fp_sk_local',
          'x-piece-auth': JSON.stringify({ botToken: 'xoxb-one', botToken2: 'xoxb-two' }),
        }),
      );

      expect(result).toEqual({
        ok: true,
        credentials: {
          userId: 'fp_sk_local',
          pieceToken: 'fp_sk_local',
          pieceAuthProps: { botToken: 'xoxb-one', botToken2: 'xoxb-two' },
        },
      });
    });

    it('parses X-Piece-Auth in secured mode and includes it in credentials', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers({
          authorization: 'Bearer fp_sk_expected',
          'x-user-id': 'user-123',
          'x-piece-auth': JSON.stringify({ apiKey: 'key-a', secretKey: 'key-b' }),
        }),
        'fp_sk_expected',
      );

      expect(result).toEqual({
        ok: true,
        credentials: {
          userId: 'user-123',
          pieceAuthProps: { apiKey: 'key-a', secretKey: 'key-b' },
        },
      });
    });

    it('silently ignores malformed JSON in X-Piece-Auth', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers({
          authorization: 'Bearer fp_sk_expected',
          'x-piece-auth': 'not-valid-json',
        }),
        'fp_sk_expected',
      );

      expect(result).toEqual({
        ok: true,
        credentials: {},
      });
    });

    it('silently drops non-string values in X-Piece-Auth', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers({
          authorization: 'Bearer fp_sk_expected',
          'x-piece-auth': JSON.stringify({ good: 'value', bad: 42, alsoGood: 'ok' }),
        }),
        'fp_sk_expected',
      );

      expect(result).toEqual({
        ok: true,
        credentials: {
          pieceAuthProps: { good: 'value', alsoGood: 'ok' },
        },
      });
    });

    it('ignores X-Piece-Auth when the object is empty after filtering', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers({
          authorization: 'Bearer fp_sk_expected',
          'x-piece-auth': JSON.stringify({ num: 1, arr: [] }),
        }),
        'fp_sk_expected',
      );

      expect(result).toEqual({
        ok: true,
        credentials: {},
      });
    });
  });

  describe('DISABLE_AUTH', () => {
    it('bypasses auth entirely when disableAuth is true and RUN_API_KEY is absent', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers(),
        undefined,
        undefined,
        undefined,
        true,
      );

      expect(result).toEqual({ ok: true, credentials: {} });
    });

    it('still surfaces X-User-Id and X-Piece-Token headers when auth is disabled', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers({
          'x-user-id': 'local-user',
          'x-piece-token': 'local-token',
        }),
        undefined,
        undefined,
        undefined,
        true,
      );

      expect(result).toEqual({
        ok: true,
        credentials: { userId: 'local-user', pieceToken: 'local-token' },
      });
    });

    it('ignores disableAuth when RUN_API_KEY is configured', async () => {
      const result = await resolveRuntimeRequestAuth(
        new Headers(),
        'fp_sk_secret',
        undefined,
        undefined,
        true,
      );

      expect(result).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
    });
  });
});
