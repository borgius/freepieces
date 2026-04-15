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

describe('admin login', () => {
  it('returns ok and set-cookie on valid credentials', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const request = new Request('https://freepieces.example.workers.dev/admin/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'password' }),
    });

    const response = await worker.fetch(request, env, createExecutionContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toContain('__fp_admin=');
  });

  it('rejects invalid credentials', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const request = new Request('https://freepieces.example.workers.dev/admin/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });

    const response = await worker.fetch(request, env, createExecutionContext());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid credentials' });
  });
});

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

// --------------------------------------------------------------------------
// Queue delivery for subscriptions
// --------------------------------------------------------------------------

describe('queue delivery for subscriptions', () => {
  function createEnvWithQueue(kv: KVNamespace, queueBinding?: { name: string; send: ReturnType<typeof vi.fn> }): Env {
    const env = createEnv(kv);
    env.RUN_API_KEY = 'fp_sk_test';
    if (queueBinding) {
      env[queueBinding.name] = { send: queueBinding.send };
    }
    return env;
  }

  it('creates a subscription with queueName when binding exists', async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createEnvWithQueue(kv, { name: 'QUEUE_SLACK_NEW_MESSAGE', send: mockSend });

    const request = new Request('https://freepieces.example.workers.dev/subscriptions/slack/new-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fp_sk_test',
        'X-Piece-Token': 'xoxb-test',
      },
      body: JSON.stringify({
        queueName: 'slack-new-message',
        propsValue: { channel: 'C123' },
      }),
    });

    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(201);

    const body = await response.json() as { ok: boolean; id: string; webhookUrl: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
    expect(body.webhookUrl).toBe('https://freepieces.example.workers.dev/webhook/slack');
  });

  it('rejects subscription with queueName when binding is missing', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createEnvWithQueue(kv); // no queue binding

    const request = new Request('https://freepieces.example.workers.dev/subscriptions/slack/new-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fp_sk_test',
        'X-Piece-Token': 'xoxb-test',
      },
      body: JSON.stringify({
        queueName: 'slack-new-message',
        propsValue: {},
      }),
    });

    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(400);

    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/Queue binding not found/);
  });

  it('rejects subscription with both callbackUrl and queueName', async () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createEnvWithQueue(kv, { name: 'QUEUE_SLACK_NEW_MESSAGE', send: mockSend });

    const request = new Request('https://freepieces.example.workers.dev/subscriptions/slack/new-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fp_sk_test',
        'X-Piece-Token': 'xoxb-test',
      },
      body: JSON.stringify({
        callbackUrl: 'https://example.com/hook',
        queueName: 'slack-new-message',
        propsValue: {},
      }),
    });

    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(400);

    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/not both/);
  });

  it('rejects subscription with neither callbackUrl nor queueName', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createEnvWithQueue(kv);

    const request = new Request('https://freepieces.example.workers.dev/subscriptions/slack/new-message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fp_sk_test',
        'X-Piece-Token': 'xoxb-test',
      },
      body: JSON.stringify({ propsValue: {} }),
    });

    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(400);

    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/callbackUrl or queueName/);
  });

  it('lists subscriptions with queueName field', async () => {
    const sub = {
      id: 'sub-q-1',
      trigger: 'new-message',
      propsValue: { channel: 'C123' },
      queueName: 'slack-new-message',
      pieceToken: 'xoxb-test',
      createdAt: '2025-01-01T00:00:00Z',
    };
    const kv = new MemoryKv({
      'sub:slack:sub-q-1': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createEnvWithQueue(kv);

    const request = new Request('https://freepieces.example.workers.dev/subscriptions/slack', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer fp_sk_test',
        'X-Piece-Token': 'xoxb-test',
      },
    });

    const response = await worker.fetch(request, env, createExecutionContext());
    expect(response.status).toBe(200);

    const body = await response.json() as { ok: boolean; subscriptions: Array<{ id: string; queueName?: string; callbackUrl?: string }> };
    expect(body.subscriptions).toHaveLength(1);
    expect(body.subscriptions[0].queueName).toBe('slack-new-message');
    expect(body.subscriptions[0].callbackUrl).toBeUndefined();
  });
});