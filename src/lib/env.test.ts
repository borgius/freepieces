import { describe, expect, it } from 'vitest';
import { getEnvStr, getKVBinding } from './env';
import type { Env } from '../framework/types';

describe('getEnvStr', () => {
  it('prefers FREEPIECES_<NAME> over FP_<NAME> and unprefixed', () => {
    const env = {
      FREEPIECES_TOKEN_ENCRYPTION_KEY: 'canonical',
      FP_TOKEN_ENCRYPTION_KEY: 'short',
      TOKEN_ENCRYPTION_KEY: 'legacy',
    } as unknown as Env;
    expect(getEnvStr(env, 'TOKEN_ENCRYPTION_KEY')).toBe('canonical');
  });

  it('falls back to FP_<NAME> then legacy', () => {
    expect(getEnvStr({ FP_RUN_API_KEY: 'short' } as unknown as Env, 'RUN_API_KEY')).toBe('short');
    expect(getEnvStr({ RUN_API_KEY: 'legacy' } as unknown as Env, 'RUN_API_KEY')).toBe('legacy');
  });

  it('ignores empty strings', () => {
    const env = { FREEPIECES_PUBLIC_URL: '', PUBLIC_URL: 'legacy' } as unknown as Env;
    expect(getEnvStr(env, 'PUBLIC_URL')).toBe('legacy');
  });

  it('returns undefined when no variant is set', () => {
    expect(getEnvStr({} as Env, 'MISSING')).toBeUndefined();
  });
});

describe('getKVBinding', () => {
  it('returns the first binding that quacks like a KV namespace', () => {
    const kv = { get: () => null } as unknown as KVNamespace;
    expect(getKVBinding({ TOKEN_STORE: kv } as unknown as Env, 'TOKEN_STORE')).toBe(kv);
  });

  it('ignores non-object values in the same slot', () => {
    expect(getKVBinding({ TOKEN_STORE: 'oops' } as unknown as Env, 'TOKEN_STORE')).toBeUndefined();
  });
});
