import { describe, expect, it, vi } from 'vitest';
import worker from './worker';
import { COOKIE_NAME, createSessionToken } from './lib/admin-session';
import type { Env } from './framework/types';

class MemoryKv {
  private readonly store = new Map<string, string>();

  constructor(entries: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(entries)) {
      this.store.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string; cursor?: string }) {
    const prefix = options?.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));

    return {
      keys,
      list_complete: true,
      cursor: '',
    };
  }
}

function createEnv(kv: KVNamespace): Env {
  return {
    FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
    TOKEN_STORE: kv,
    TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: 'password',
    ADMIN_SIGNING_KEY: 'signing-key',
  };
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

async function createAdminCookie(env: Env): Promise<string> {
  const token = await createSessionToken('admin', env.ADMIN_SIGNING_KEY ?? 'signing-key');
  return `${COOKIE_NAME}=${token}`;
}

describe('admin piece users', () => {
  it('marks OAuth-backed pieces as supporting users', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const request = new Request('https://freepieces.example.workers.dev/admin/api/pieces', {
      headers: { cookie: await createAdminCookie(env) },
    });

    const response = await worker.fetch(request, env, createExecutionContext());

    expect(response.status).toBe(200);

    const payload = await response.json() as Array<{ name: string; supportsUsers: boolean }>;
    expect(payload.find((piece) => piece.name === 'gmail')?.supportsUsers).toBe(true);
    expect(payload.find((piece) => piece.name === 'example-apikey')?.supportsUsers).toBe(false);
  });

  it('lists stored users for an OAuth-backed piece', async () => {
    const kv = new MemoryKv({
      'token:gmail:alice@example.com': 'encrypted-1',
      'token:gmail:team:ops@example.com': 'encrypted-2',
      'sub:gmail:subscription-1': '{"id":"subscription-1"}',
    }) as unknown as KVNamespace;
    const env = createEnv(kv);

    const request = new Request('https://freepieces.example.workers.dev/admin/api/pieces/gmail/users', {
      headers: { cookie: await createAdminCookie(env) },
    });

    const response = await worker.fetch(request, env, createExecutionContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      users: [
        { userId: 'alice@example.com', displayName: 'alice@example.com' },
        { userId: 'team:ops@example.com', displayName: 'team:ops@example.com' },
      ],
    });
  });
});