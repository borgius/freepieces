import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from './worker';
import type { Env } from './framework/types';
import { registerPiece } from './framework/registry';
import { createPiece } from './framework/piece';
import { createTrigger } from './framework/piece';

// Mock the OpenAuth client so admin session verification works in tests
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

// Mock fastVerify so tests don't need a real JWKS/KV issuer setup
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
}

function createEnv(kv: KVNamespace): Env {
  return {
    FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
    FREEPIECES_TOKEN_STORE: kv,
    FREEPIECES_AUTH_STORE: new MemoryKv() as unknown as KVNamespace,
    FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
  };
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

describe('admin auth', () => {
  it('returns login URL for email code provider', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const request = new Request('https://freepieces.example.workers.dev/admin/api/login-url?provider=code');

    const response = await worker.fetch(request, env, createExecutionContext());

    expect(response.status).toBe(200);
    const body = await response.json() as { url: string };
    expect(body.url).toBeTruthy();
  });

  it('rejects unauthenticated access to /admin/api/me', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const request = new Request('https://freepieces.example.workers.dev/admin/api/me');

    const response = await worker.fetch(request, env, createExecutionContext());

    expect(response.status).toBe(401);
  });
});

describe('admin piece users', () => {
  it('marks OAuth-backed pieces as supporting users', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const request = new Request('https://freepieces.example.workers.dev/admin/api/pieces', {
      headers: { cookie: createAdminCookie() },
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
      headers: { cookie: createAdminCookie() },
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
    env.FREEPIECES_RUN_API_KEY = 'fp_sk_test';
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

// --------------------------------------------------------------------------
// Native WEBHOOK trigger parity
// --------------------------------------------------------------------------

const onEnableSpy = vi.fn().mockResolvedValue(undefined);
const onDisableSpy = vi.fn().mockResolvedValue(undefined);
const triggerRunSpy = vi.fn().mockResolvedValue([{ id: 'evt-1' }]);

const nativeWebhookPiece = createPiece({
  name: 'test-native-webhook',
  displayName: 'Test Native Webhook Piece',
  description: 'Test piece for native WEBHOOK trigger parity tests.',
  version: '0.1.0',
  auth: { type: 'apiKey', headerName: 'X-Api-Key' },
  actions: [],
  triggers: [
    createTrigger({
      name: 'new-event',
      displayName: 'New Event',
      description: 'Fires when an inbound webhook arrives.',
      type: 'WEBHOOK',
      props: {},
      async run(ctx) {
        return triggerRunSpy(ctx);
      },
      onEnable: onEnableSpy,
      onDisable: onDisableSpy,
    }),
  ],
});

describe('native WEBHOOK trigger subscriptions', () => {
  beforeAll(() => {
    registerPiece(nativeWebhookPiece);
  });

  afterAll(() => {
    onEnableSpy.mockClear();
    onDisableSpy.mockClear();
    triggerRunSpy.mockClear();
  });

  function createEnv(kv: KVNamespace): Env {
    const env: Env = {
      FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
      FREEPIECES_TOKEN_STORE: kv,
      FREEPIECES_AUTH_STORE: new MemoryKv() as unknown as KVNamespace,
      FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
      FREEPIECES_RUN_API_KEY: 'fp_sk_test',
    };
    return env;
  }

  it('accepts subscription for a native WEBHOOK trigger', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createEnv(kv);

    const response = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/subscriptions/test-native-webhook/new-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fp_sk_test',
          'X-Piece-Token': 'test-api-key-value',
        },
        body: JSON.stringify({ callbackUrl: 'https://example.com/cb', propsValue: {} }),
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { ok: boolean; id: string; webhookUrl: string };
    expect(body.ok).toBe(true);
    expect(body.webhookUrl).toBe('https://freepieces.example.workers.dev/webhook/test-native-webhook');
  });

  it('calls onEnable when a native WEBHOOK subscription is created', async () => {
    onEnableSpy.mockClear();
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createEnv(kv);

    await worker.fetch(
      new Request('https://freepieces.example.workers.dev/subscriptions/test-native-webhook/new-event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fp_sk_test',
          'X-Piece-Token': 'test-api-key-value',
        },
        body: JSON.stringify({ callbackUrl: 'https://example.com/cb', propsValue: {} }),
      }),
      env,
      createExecutionContext(),
    );

    expect(onEnableSpy).toHaveBeenCalledOnce();
    const ctx = onEnableSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(ctx).toHaveProperty('webhookUrl');
  });

  it('calls onDisable when a native WEBHOOK subscription is deleted', async () => {
    onDisableSpy.mockClear();
    const sub = {
      id: 'sub-native-1',
      trigger: 'new-event',
      propsValue: {},
      callbackUrl: 'https://example.com/cb',
      pieceToken: 'test-api-key-value',
      createdAt: new Date().toISOString(),
    };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-native-1': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createEnv(kv);

    const response = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/subscriptions/test-native-webhook/new-event/sub-native-1', {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer fp_sk_test',
          'X-Piece-Token': 'test-api-key-value',
        },
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(onDisableSpy).toHaveBeenCalledOnce();
  });

  it('runtime endpoint rejects subscription for a native POLLING trigger (not webhook-capable)', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createEnv(kv);

    // gmail has polling triggers — subscription should be rejected
    const response = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/subscriptions/gmail/gmail_new_email_received', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer fp_sk_test',
        },
        body: JSON.stringify({ callbackUrl: 'https://example.com/cb', propsValue: {} }),
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toMatch(/does not support webhook/i);
  });

  it('accepts inbound webhook POST for native piece', async () => {
    // Seed a subscription so there is something to dispatch to
    const sub = {
      id: 'sub-native-2',
      trigger: 'new-event',
      propsValue: {},
      callbackUrl: 'https://example.com/cb',
      pieceToken: 'test-api-key-value',
      createdAt: new Date().toISOString(),
    };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-native-2': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createEnv(kv);

    const response = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/webhook/test-native-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'test.event', data: { foo: 'bar' } }),
      }),
      env,
      createExecutionContext(),
    );

    // Worker accepts the webhook and dispatches asynchronously — 200 expected
    expect(response.status).toBe(200);
  });
});

// --------------------------------------------------------------------------
// Admin triggers/groups endpoint
// --------------------------------------------------------------------------

describe('admin GET /admin/api/triggers/groups', () => {
  function createAdminEnv(kv: KVNamespace): Env {
    return {
      FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
      FREEPIECES_TOKEN_STORE: kv,
      FREEPIECES_AUTH_STORE: new MemoryKv() as unknown as KVNamespace,
      FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
    };
  }

  function adminRequest(path: string): Request {
    return new Request(`https://freepieces.example.workers.dev${path}`, {
      headers: { cookie: '__fp_admin=valid-admin-token; __fp_admin_refresh=valid-refresh' },
    });
  }

  it('returns empty groups when no subscriptions exist', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    expect(response.status).toBe(200);
    const body = await response.json() as { groups: unknown[] };
    expect(body.groups).toEqual([]);
  });

  it('groups a callbackUrl subscription under one endpoint bucket', async () => {
    const sub = {
      id: 'sub-cb-1',
      trigger: 'new-event',
      propsValue: {},
      callbackUrl: 'https://my-server.example.com/hook',
      pieceToken: 'secret-api-key',
      createdAt: '2026-05-01T00:00:00.000Z',
    };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-cb-1': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    expect(response.status).toBe(200);
    const body = await response.json() as { groups: Array<Record<string, unknown>> };
    expect(body.groups).toHaveLength(1);

    const group = body.groups[0];
    expect(group.endpointType).toBe('callbackUrl');
    expect(group.endpointValue).toBe('https://my-server.example.com/hook');
    expect(group.endpointKey).toBe('callbackUrl:https://my-server.example.com/hook');
    expect(group.memberCount).toBe(1);
  });

  it('groups a queueName subscription under a queue endpoint bucket', async () => {
    const sub = {
      id: 'sub-q-admin-1',
      trigger: 'new-event',
      propsValue: {},
      queueName: 'my-events-queue',
      pieceToken: 'secret-api-key',
      createdAt: '2026-05-01T00:00:00.000Z',
    };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-q-admin-1': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    expect(response.status).toBe(200);
    const body = await response.json() as { groups: Array<Record<string, unknown>> };
    expect(body.groups).toHaveLength(1);

    const group = body.groups[0];
    expect(group.endpointType).toBe('queueName');
    expect(group.endpointValue).toBe('my-events-queue');
  });

  it('places two subscriptions with the same callbackUrl in one group', async () => {
    const sharedUrl = 'https://shared-server.example.com/events';
    const sub1 = { id: 'sub-m-1', trigger: 'new-event', propsValue: {}, callbackUrl: sharedUrl, pieceToken: 'token-a', createdAt: '2026-01-01T00:00:00Z' };
    const sub2 = { id: 'sub-m-2', trigger: 'new-event', propsValue: {}, callbackUrl: sharedUrl, userId: 'alice@example.com', createdAt: '2026-02-01T00:00:00Z' };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-m-1': JSON.stringify(sub1),
      'sub:test-native-webhook:sub-m-2': JSON.stringify(sub2),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    expect(response.status).toBe(200);
    const body = await response.json() as { groups: Array<{ memberCount: number; endpointValue: string }> };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].memberCount).toBe(2);
    expect(body.groups[0].endpointValue).toBe(sharedUrl);
  });

  it('separates subscriptions with different callbackUrls into different groups', async () => {
    const sub1 = { id: 'sub-d-1', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://server-a.example.com/hook', pieceToken: 'tok', createdAt: '2026-01-01T00:00:00Z' };
    const sub2 = { id: 'sub-d-2', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://server-b.example.com/hook', pieceToken: 'tok', createdAt: '2026-02-01T00:00:00Z' };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-d-1': JSON.stringify(sub1),
      'sub:test-native-webhook:sub-d-2': JSON.stringify(sub2),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    expect(response.status).toBe(200);
    const body = await response.json() as { groups: Array<{ endpointValue: string }> };
    expect(body.groups).toHaveLength(2);
  });

  it('does not expose raw pieceToken in any member', async () => {
    const sub = { id: 'sub-redact-1', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://cb.example.com/', pieceToken: 'super-secret-api-key', createdAt: '2026-01-01T00:00:00Z' };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-redact-1': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    const text = await response.text();
    expect(text).not.toContain('super-secret-api-key');
  });

  it('does not expose raw pieceAuthProps values in any member', async () => {
    const sub = { id: 'sub-redact-2', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://cb.example.com/', pieceAuthProps: { botToken: 'xoxb-ultra-secret' }, createdAt: '2026-01-01T00:00:00Z' };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-redact-2': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    const text = await response.text();
    expect(text).not.toContain('xoxb-ultra-secret');
  });

  it('annotates stored-user owner kind for userId subscriptions', async () => {
    const sub = { id: 'sub-owner-1', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://cb.example.com/', userId: 'alice@example.com', createdAt: '2026-01-01T00:00:00Z' };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-owner-1': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    const body = await response.json() as { groups: Array<{ members: Array<{ owner: { kind: string; label: string } }> }> };
    const member = body.groups[0].members[0];
    expect(member.owner.kind).toBe('stored-user');
    expect(member.owner.label).toBe('alice@example.com');
  });

  it('derives pieceName from KV key and joins registry displayName', async () => {
    const sub = { id: 'sub-piece-1', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://cb.example.com/', pieceToken: 'tok', createdAt: '2026-01-01T00:00:00Z' };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-piece-1': JSON.stringify(sub),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    const body = await response.json() as { groups: Array<{ members: Array<{ pieceName: string; pieceDisplayName: string; providerWebhookUrl: string }> }> };
    const member = body.groups[0].members[0];
    expect(member.pieceName).toBe('test-native-webhook');
    expect(member.pieceDisplayName).toBe('Test Native Webhook Piece');
    expect(member.providerWebhookUrl).toBe('https://freepieces.example.workers.dev/webhook/test-native-webhook');
  });

  it('requires admin session — rejects unauthenticated requests', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/admin/api/triggers/groups'),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(401);
  });

  it('groups subscriptions from different pieces under the same callbackUrl', async () => {
    const subA = { id: 'sub-mp-1', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://shared.example.com/hook', pieceToken: 'tok', createdAt: '2026-01-01T00:00:00Z' };
    // gmail is a registered POLLING piece — subscriptions for it won't exist in practice
    // but the global reader must still return whatever is stored, including cross-piece entries
    const subB = { id: 'sub-mp-2', trigger: 'new-event', propsValue: {}, callbackUrl: 'https://shared.example.com/hook', pieceToken: 'tok2', createdAt: '2026-02-01T00:00:00Z' };
    const kv = new MemoryKv({
      'sub:test-native-webhook:sub-mp-1': JSON.stringify(subA),
      // Pretend a second piece also has a subscription to the same callback
      'sub:example-apikey:sub-mp-2': JSON.stringify(subB),
    }) as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(adminRequest('/admin/api/triggers/groups'), env, createExecutionContext());

    const body = await response.json() as { groups: Array<{ memberCount: number }> };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].memberCount).toBe(2);
  });
});

// --------------------------------------------------------------------------
// Admin POST /admin/api/subscriptions/:piece/:trigger
// --------------------------------------------------------------------------

describe('admin POST /admin/api/subscriptions/:piece/:trigger', () => {
  function createAdminEnv(kv: KVNamespace): Env {
    return {
      FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
      FREEPIECES_TOKEN_STORE: kv,
      FREEPIECES_AUTH_STORE: new MemoryKv() as unknown as KVNamespace,
      FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
    };
  }

  function adminSubscriptionRequest(piece: string, trigger: string, body: object): Request {
    return new Request(
      `https://freepieces.example.workers.dev/admin/api/subscriptions/${piece}/${trigger}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: '__fp_admin=valid-admin-token; __fp_admin_refresh=valid-refresh',
        },
        body: JSON.stringify(body),
      },
    );
  }

  it('accepts a POLLING trigger subscription via the admin endpoint', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      adminSubscriptionRequest('gmail', 'gmail_new_email_received', {
        callbackUrl: 'https://example.com/cb',
        propsValue: {},
      }),
      env,
      createExecutionContext(),
    );

    // Admin endpoint now accepts POLLING triggers — freepieces polls on their behalf
    expect(response.status).toBe(201);
    const body = await response.json() as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
  });

  it('accepts a WEBHOOK trigger subscription via the admin endpoint', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      adminSubscriptionRequest('test-native-webhook', 'new-event', {
        callbackUrl: 'https://example.com/cb',
        propsValue: {},
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(201);
  });

  it('rejects unknown piece via admin endpoint', async () => {
    const kv = new MemoryKv() as unknown as KVNamespace;
    const env = createAdminEnv(kv);

    const response = await worker.fetch(
      adminSubscriptionRequest('no-such-piece', 'some-trigger', {
        callbackUrl: 'https://example.com/cb',
      }),
      env,
      createExecutionContext(),
    );

    expect(response.status).toBe(404);
  });
});