import { beforeAll, describe, expect, it, vi } from 'vitest';

import worker from './worker';
import type { Env } from './framework/types';
import { registerPiece } from './framework/registry';
import { createPiece, createTrigger } from './framework/piece';
import { SUB_KEY } from './lib/webhook';

vi.mock('./auth/client', () => ({
  subjects: {
    admin: { type: 'admin' },
    user: { type: 'user' },
  },
  createAuthClient: () => ({
    verify: async (_subjects: unknown, token: string) => {
      if (token === 'valid-admin-token') {
        return {
          subject: {
            type: 'admin',
            properties: { userId: 'admin-user', email: 'admin@example.com', role: 'admin' },
          },
        };
      }
      return { err: new Error('Invalid token') };
    },
    authorize: async () => ({ url: 'https://auth.example.com/authorize' }),
  }),
}));

vi.mock('./lib/fast-verify', () => ({
  fastVerify: async (_env: unknown, _origin: unknown, _ctx: unknown, token: string) => {
    if (token === 'valid-admin-token') {
      return {
        ok: true,
        subject: {
          type: 'admin',
          properties: { userId: 'admin-user', email: 'admin@example.com', role: 'admin' },
        },
      };
    }
    return { ok: false, expired: false };
  },
}));

class MemoryKv {
  private readonly store = new Map<string, string>();

  constructor(entries: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(entries)) this.store.set(key, value);
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

  async list(options?: { prefix?: string }) {
    const prefix = options?.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));
    return { keys, list_complete: true, cursor: '' };
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store.entries());
  }
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function createAdminCookie(): string {
  return '__fp_admin=valid-admin-token; __fp_admin_refresh=valid-refresh';
}

const subPiece = createPiece({
  name: 'test-subscriptions-piece',
  displayName: 'Test Subscriptions Piece',
  description: 'Test piece for subscription delivery config.',
  version: '0.1.0',
  auth: { type: 'none' },
  actions: [],
  triggers: [
    createTrigger({
      name: 'new-event',
      displayName: 'New Event',
      description: 'Fires when a matching event arrives.',
      type: 'WEBHOOK',
      props: {},
      async run() {
        return [{ id: 'evt-1' }];
      },
    }),
  ],
});

describe('admin subscription delivery configuration', () => {
  beforeAll(() => {
    registerPiece(subPiece);
  });

  function createAdminEnv(kv: KVNamespace): Env {
    return {
      FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
      FREEPIECES_TOKEN_STORE: kv,
      FREEPIECES_AUTH_STORE: new MemoryKv() as unknown as KVNamespace,
      FREEPIECES_TOKEN_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
    };
  }

  function adminRequest(path: string, init?: RequestInit): Request {
    return new Request(`https://freepieces.example.workers.dev${path}`, {
      ...init,
      headers: {
        cookie: createAdminCookie(),
        ...(init?.headers ?? {}),
      },
    });
  }

  it('reports runtime capability flags', async () => {
    const env = createAdminEnv(new MemoryKv() as unknown as KVNamespace);
    const response = await worker.fetch(adminRequest('/admin/api/runtime'), env, createExecutionContext());
    expect(response.status).toBe(200);
    const info = (await response.json()) as { runtime: string; supportsCliHooks: boolean };
    // The test suite runs under Node, so CLI hooks are supported.
    expect(info.runtime).toBe('node');
    expect(info.supportsCliHooks).toBe(true);
  });

  it('persists method and injected headers on subscription creation', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace & { snapshot(): Record<string, string> };
    const env = createAdminEnv(kv);
    const response = await worker.fetch(
      adminRequest('/admin/api/subscriptions/test-subscriptions-piece/new-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callbackUrl: 'https://example.com/callback',
          method: 'PUT',
          headers: { 'x-static': 'hi' },
        }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const stored = JSON.parse(kv.snapshot()[SUB_KEY('test-subscriptions-piece', id)]);
    expect(stored.method).toBe('PUT');
    expect(stored.headers).toEqual({ 'x-static': 'hi' });
    expect(stored.callbackUrl).toBe('https://example.com/callback');
  });

  it('rejects an invalid HTTP method', async () => {
    const env = createAdminEnv(new MemoryKv() as unknown as KVNamespace);
    const response = await worker.fetch(
      adminRequest('/admin/api/subscriptions/test-subscriptions-piece/new-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ callbackUrl: 'https://example.com/callback', method: 'FETCH' }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/method/i);
  });

  it('rejects providing more than one delivery target', async () => {
    const env = createAdminEnv(new MemoryKv() as unknown as KVNamespace);
    const response = await worker.fetch(
      adminRequest('/admin/api/subscriptions/test-subscriptions-piece/new-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callbackUrl: 'https://example.com/callback',
          command: 'echo hi',
        }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/exactly one/i);
  });

  it('previews a valid jq program against a sample envelope', async () => {
    const env = createAdminEnv(new MemoryKv() as unknown as KVNamespace);
    const response = await worker.fetch(
      adminRequest('/admin/api/subscriptions/jq-sample', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          piece: 'test-subscriptions-piece',
          trigger: 'new-event',
          program: '{ count: (.events | length) }',
          sample: { events: [{ id: 'a' }, { id: 'b' }] },
        }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; result: unknown };
    expect(body.ok).toBe(true);
    expect(body.result).toEqual({ count: 2 });
  });

  it('returns an error for an invalid jq program', async () => {
    const env = createAdminEnv(new MemoryKv() as unknown as KVNamespace);
    const response = await worker.fetch(
      adminRequest('/admin/api/subscriptions/jq-sample', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          piece: 'test-subscriptions-piece',
          trigger: 'new-event',
          program: '{ this is (((not valid',
          sample: { events: [] },
        }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  it('round-trips method and headers through PATCH', async () => {
    const existing = {
      id: 'sub-existing',
      trigger: 'new-event',
      propsValue: {},
      callbackUrl: 'https://example.com/callback',
      method: 'POST',
      headers: { 'x-old': '1' },
      createdAt: '2026-05-24T00:00:00.000Z',
    };
    const kv = new MemoryKv({
      [SUB_KEY('test-subscriptions-piece', 'sub-existing')]: JSON.stringify(existing),
    }) as unknown as KVNamespace & { snapshot(): Record<string, string> };
    const env = createAdminEnv(kv);
    const response = await worker.fetch(
      adminRequest('/admin/api/subscriptions/test-subscriptions-piece/sub-existing', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callbackUrl: 'https://example.com/callback',
          method: 'PATCH',
          headers: { 'x-new': '2' },
        }),
      }),
      env,
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    const stored = JSON.parse(kv.snapshot()[SUB_KEY('test-subscriptions-piece', 'sub-existing')]);
    expect(stored.method).toBe('PATCH');
    expect(stored.headers).toEqual({ 'x-new': '2' });
    // stale headers were dropped, not merged
    expect(stored.headers['x-old']).toBeUndefined();
    // non-delivery fields are preserved
    expect(stored.id).toBe('sub-existing');
    expect(stored.createdAt).toBe('2026-05-24T00:00:00.000Z');
  });
});
