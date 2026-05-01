import { afterEach, describe, expect, it, vi } from 'vitest';
import { decrypt, encrypt, __resetCryptoKeyCache } from './crypto';

const HEX_KEY = 'a'.repeat(64);

afterEach(() => {
  __resetCryptoKeyCache();
  vi.restoreAllMocks();
});

describe('crypto key cache', () => {
  it('round-trips a plaintext through encrypt/decrypt', async () => {
    const payload = await encrypt('hello-world', HEX_KEY);
    await expect(decrypt(payload, HEX_KEY)).resolves.toBe('hello-world');
  });

  it('calls crypto.subtle.importKey exactly once across many encrypt/decrypt calls with the same key', async () => {
    __resetCryptoKeyCache();
    const spy = vi.spyOn(crypto.subtle, 'importKey');

    const a = await encrypt('one', HEX_KEY);
    const b = await encrypt('two', HEX_KEY);
    await decrypt(a, HEX_KEY);
    await decrypt(b, HEX_KEY);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('imports a separate key when the hex secret changes', async () => {
    __resetCryptoKeyCache();
    const spy = vi.spyOn(crypto.subtle, 'importKey');
    const alt = 'b'.repeat(64);

    await encrypt('x', HEX_KEY);
    await encrypt('y', alt);

    expect(spy).toHaveBeenCalledTimes(2);
  });
});
