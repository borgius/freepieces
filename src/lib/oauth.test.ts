import { describe, expect, it } from 'vitest';

import { resolveOAuthClientCredentials } from './oauth';
import type { Env, OAuth2AuthDefinition } from '../framework/types';

const authDef: OAuth2AuthDefinition = {
  type: 'oauth2',
  authorizationUrl: 'https://provider.example/oauth/authorize',
  tokenUrl: 'https://provider.example/oauth/token',
  scopes: ['read'],
  clientIdEnvKey: 'TEST_CLIENT_ID',
  clientSecretEnvKey: 'TEST_CLIENT_SECRET',
};

function makeEnv(overrides: Record<string, unknown> = {}): Env {
  return {
    FREEPIECES_PUBLIC_URL: 'https://freepieces.test',
    TOKEN_STORE: {} as KVNamespace,
    AUTH_STORE: {} as KVNamespace,
    TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
    TEST_CLIENT_ID: 'test-client-id',
    TEST_CLIENT_SECRET: 'test-client-secret',
    ...overrides,
  } as Env;
}

describe('resolveOAuthClientCredentials', () => {
  it('reads the piece-specific client credential env keys', () => {
    expect(resolveOAuthClientCredentials(authDef, makeEnv())).toEqual({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
  });

  it('reports the exact missing piece-specific env keys', () => {
    expect(() =>
      resolveOAuthClientCredentials(
        authDef,
        makeEnv({ TEST_CLIENT_ID: '', TEST_CLIENT_SECRET: undefined }),
      ),
    ).toThrow('Missing OAuth client credentials: TEST_CLIENT_ID, TEST_CLIENT_SECRET');
  });
});
