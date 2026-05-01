import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

function okJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data } as unknown as Response;
}
function errJson(status: number, data: unknown = { error: 'x' }) {
  return { ok: false, status, json: async () => data } as unknown as Response;
}

describe('FreePiecesClient request options', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('sets keepalive on every request', async () => {
    mockFetch.mockResolvedValue(okJson({ ok: true }));
    const client = createClient({
      baseUrl: 'https://example.test',
      token: 'fp_sk_test',
      userId: 'alice',
      fetch: mockFetch as unknown as typeof fetch,
    });
    await client.run('gmail', 'send_email', {});
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.keepalive).toBe(true);
  });

  it('attaches an AbortSignal when timeoutMs > 0', async () => {
    mockFetch.mockResolvedValue(okJson({ ok: true }));
    const client = createClient({
      baseUrl: 'https://example.test',
      token: 'fp_sk_test',
      userId: 'alice',
      timeoutMs: 5000,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await client.run('gmail', 'send_email', {});
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });

  it('omits the AbortSignal when timeoutMs is 0', async () => {
    mockFetch.mockResolvedValue(okJson({ ok: true }));
    const client = createClient({
      baseUrl: 'https://example.test',
      token: 'fp_sk_test',
      userId: 'alice',
      timeoutMs: 0,
      fetch: mockFetch as unknown as typeof fetch,
    });
    await client.run('gmail', 'send_email', {});
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeUndefined();
  });

  it('retries listPieces() on transient 5xx and succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce(errJson(503, { error: 'busy' }))
      .mockResolvedValueOnce(okJson([{ name: 'gmail' }]));

    const client = createClient({
      baseUrl: 'https://example.test',
      token: 'fp_sk_test',
      retries: 2,
      fetch: mockFetch as unknown as typeof fetch,
    });

    const result = await client.listPieces();
    expect(result).toEqual([{ name: 'gmail' }]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry run() (non-idempotent action)', async () => {
    mockFetch.mockResolvedValue(errJson(503, { error: 'busy' }));
    const client = createClient({
      baseUrl: 'https://example.test',
      token: 'fp_sk_test',
      retries: 3,
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.run('gmail', 'send_email', {})).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry listPieces() on 4xx', async () => {
    mockFetch.mockResolvedValue(errJson(401, { error: 'unauthorized' }));
    const client = createClient({
      baseUrl: 'https://example.test',
      token: 'fp_sk_test',
      retries: 3,
      fetch: mockFetch as unknown as typeof fetch,
    });

    await expect(client.listPieces()).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
