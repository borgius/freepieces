import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './client';

const mockFetch = vi.fn();

function okJson(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  };
}

describe('FreePiecesClient auth headers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okJson({ ok: true }));
  });

  it('sends RUN_API_KEY + X-User-Id + X-Piece-Token when provided', async () => {
    const client = createClient({
      baseUrl: 'https://freepieces.example.workers.dev',
      token: 'fp_sk_expected',
      userId: 'alice@example.com',
      pieceToken: 'xoxb-piece-token',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.run('slack', 'send_channel_message', { text: 'hello' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer fp_sk_expected',
      'x-user-id': 'alice@example.com',
      'x-piece-token': 'xoxb-piece-token',
    });
  });

  it('uses pieceToken as the bearer token in local-dev mode', async () => {
    const client = createClient({
      baseUrl: 'http://localhost:8787',
      userId: 'alice@example.com',
      pieceToken: 'raw-piece-token',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.run('example-apikey', 'ping', {});

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer raw-piece-token',
      'x-user-id': 'alice@example.com',
      'x-piece-token': 'raw-piece-token',
    });
  });

  it('falls back to userId as the bearer token when no shared key or piece token is set', async () => {
    const client = createClient({
      baseUrl: 'http://localhost:8787',
      userId: 'alice@example.com',
      fetch: mockFetch as unknown as typeof fetch,
    });

    await client.run('gmail', 'send_email', { subject: 'Hello' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer alice@example.com',
      'x-user-id': 'alice@example.com',
    });
  });
});
