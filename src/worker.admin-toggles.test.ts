import { beforeAll, describe, expect, it, vi } from 'vitest';

import worker from './worker';
import type { Env } from './framework/types';
import { registerPiece } from './framework/registry';
import { createPiece, createTrigger } from './framework/piece';
import { USER_TOOL_STATE_KEY } from './lib/user-tool-state';

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
    authorize: async () => ({
      url: 'https://auth.example.com/authorize',
    }),
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

const toggleAdminPiece = createPiece({
  name: 'test-admin-toggle-dedicated',
  displayName: 'Test Admin Toggle Dedicated',
  description: 'Test piece for per-user admin toggles.',
  version: '0.1.0',
  auth: { type: 'none' },
  actions: [
    {
      name: 'inspect',
      displayName: 'Inspect',
      description: 'Returns a tiny success payload.',
      props: {},
      async run() {
        return { ok: true };
      },
    },
  ],
  triggers: [
    createTrigger({
      name: 'new-event',
      displayName: 'New Event',
      description: 'Fires when a matching event arrives.',
      type: 'WEBHOOK',
      props: {},
      async run() {
        return [{ id: 'evt-admin-1' }];
      },
    }),
  ],
});

describe('admin per-user action and trigger toggles', () => {
  beforeAll(() => {
    registerPiece(toggleAdminPiece);
  });

  function createAdminEnv(kv: KVNamespace): Env {
    return {
      FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
      FREEPIECES_TOKEN_STORE: kv,
      FREEPIECES_AUTH_STORE: new MemoryKv() as unknown as KVNamespace,
      FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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

  it('returns both userId and email from /admin/api/me', async () => {
    const env = createAdminEnv(new MemoryKv() as unknown as KVNamespace);
    const response = await worker.fetch(
      adminRequest('/admin/api/me'),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: 'admin-user',
      email: 'admin@example.com',
    });
  });

  it('includes per-item enabled state in the admin pieces response', async () => {
    const kv = new MemoryKv({
      [USER_TOOL_STATE_KEY('admin-user', 'test-admin-toggle-dedicated')]: JSON.stringify({
        version: 1,
        disabledActions: ['inspect'],
        disabledTriggers: ['new-event'],
      }),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      adminRequest('/admin/api/pieces'),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    const pieces = await response.json() as Array<{
      name: string;
      actions: Array<{ name: string; enabled: boolean }>;
      triggers: Array<{ name: string; enabled: boolean }>;
    }>;
    const piece = pieces.find((entry) => entry.name === 'test-admin-toggle-dedicated');
    expect(piece).toBeDefined();
    expect(piece?.actions.find((action) => action.name === 'inspect')?.enabled).toBe(false);
    expect(piece?.triggers.find((trigger) => trigger.name === 'new-event')?.enabled).toBe(false);
  });

  it('persists action toggle changes through the admin mutation route', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace & { snapshot(): Record<string, string> };
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      adminRequest('/admin/api/pieces/test-admin-toggle-dedicated/action/inspect', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(kv.snapshot()).toEqual({
      [USER_TOOL_STATE_KEY('admin-user', 'test-admin-toggle-dedicated')]: JSON.stringify({
        version: 1,
        disabledActions: ['inspect'],
        disabledTriggers: [],
      }),
    });
  });

  it('returns 404 from the admin run proxy when the action is disabled for the selected user', async () => {
    const kv = new MemoryKv({
      [USER_TOOL_STATE_KEY('other-user', 'test-admin-toggle-dedicated')]: JSON.stringify({
        version: 1,
        disabledActions: ['inspect'],
        disabledTriggers: [],
      }),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      adminRequest('/admin/api/run/test-admin-toggle-dedicated/inspect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: 'other-user' }),
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Action not found' });
  });

  it('returns 404 from admin subscription creation when the trigger is disabled for the selected user', async () => {
    const kv = new MemoryKv({
      [USER_TOOL_STATE_KEY('other-user', 'test-admin-toggle-dedicated')]: JSON.stringify({
        version: 1,
        disabledActions: [],
        disabledTriggers: ['new-event'],
      }),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      adminRequest('/admin/api/subscriptions/test-admin-toggle-dedicated/new-event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          userId: 'other-user',
          callbackUrl: 'https://example.com/callback',
          propsValue: {},
        }),
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Trigger not found' });
  });
});
