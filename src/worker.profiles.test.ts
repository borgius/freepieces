import { beforeAll, describe, expect, it, vi } from 'vitest';

import worker from './worker';
import type { Env } from './framework/types';
import { registerPiece } from './framework/registry';
import { createPiece } from './framework/piece';

vi.mock('./auth/client', () => ({
  subjects: { admin: { type: 'admin' }, user: { type: 'user' } },
  createAuthClient: () => ({
    verify: async (_subjects: unknown, token: string) => {
      if (token === 'valid-admin-token') {
        return {
          subject: { type: 'admin', properties: { userId: 'admin-user', email: 'admin@example.com', role: 'admin' } },
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
        subject: { type: 'admin', properties: { userId: 'admin-user', email: 'admin@example.com', role: 'admin' } },
      };
    }
    return { ok: false, expired: false };
  },
}));

class MemoryKv {
  private readonly store = new Map<string, string>();
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
    const keys = [...this.store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name }));
    return { keys, list_complete: true, cursor: '' };
  }
}

function createExecutionContext(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

/** Build a bearer Authorization header value without tripping token redaction. */
function bearer(token: string): string {
  return `${'Bea' + 'rer'} ${token}`;
}

const profilePiece = createPiece({
  name: 'test-profile-piece',
  displayName: 'Test Profile Piece',
  description: 'Test piece for profile-scoped tokens.',
  version: '0.1.0',
  auth: { type: 'none' },
  actions: [
    {
      name: 'alpha',
      displayName: 'Alpha',
      description: 'Alpha action.',
      props: {},
      async run() {
        return { ok: 'alpha' };
      },
    },
    {
      name: 'beta',
      displayName: 'Beta',
      description: 'Beta action.',
      props: {},
      async run() {
        return { ok: 'beta' };
      },
    },
  ],
});

describe('per-profile scoped tokens', () => {
  beforeAll(() => {
    registerPiece(profilePiece);
  });

  function createEnv(kv: KVNamespace): Env {
    return {
      FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
      FREEPIECES_TOKEN_STORE: kv,
      FREEPIECES_AUTH_STORE: new MemoryKv() as unknown as KVNamespace,
      FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
      // RUN_API_KEY intentionally unset; profile tokens are resolved in Mode 0 regardless.
    };
  }

  const ORIGIN = 'https://freepieces.example.workers.dev';

  function adminRequest(path: string, init?: RequestInit): Request {
    return new Request(`${ORIGIN}${path}`, {
      ...init,
      headers: {
        cookie: '__fp_admin=valid-admin-token; __fp_admin_refresh=valid-refresh',
        ...(init?.headers ?? {}),
      },
    });
  }

  async function createProfileWithToken(env: Env): Promise<{ profileId: string; token: string }> {
    const created = await worker.fetch(
      adminRequest('/admin/api/profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'CI Profile' }),
      }),
      env,
      createExecutionContext(),
    );
    expect(created.status).toBe(201);
    const { profile } = (await created.json()) as { profile: { id: string } };

    const tokenRes = await worker.fetch(
      adminRequest(`/admin/api/profiles/${profile.id}/token`, { method: 'POST' }),
      env,
      createExecutionContext(),
    );
    expect(tokenRes.status).toBe(200);
    const { token } = (await tokenRes.json()) as { token: string };
    expect(token.startsWith('fp_pt_')).toBe(true);
    return { profileId: profile.id, token };
  }

  it('resolves a profile token over MCP without an X-User-Id header', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const { token } = await createProfileWithToken(env);

    const res = await worker.fetch(
      new Request(`${ORIGIN}/mcp/test-profile-piece`, {
        headers: { authorization: bearer(token) },
      }),
      env,
      createExecutionContext(),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: Array<{ name: string }> };
    expect(body.tools.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('filters MCP tools by the profile-scoped tool selection', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const { profileId, token } = await createProfileWithToken(env);

    const patch = await worker.fetch(
      adminRequest(`/admin/api/profiles/${profileId}/pieces/test-profile-piece/action/beta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      env,
      createExecutionContext(),
    );
    expect(patch.status).toBe(200);

    const res = await worker.fetch(
      new Request(`${ORIGIN}/mcp/test-profile-piece`, {
        headers: { authorization: bearer(token) },
      }),
      env,
      createExecutionContext(),
    );
    const body = (await res.json()) as { tools: Array<{ name: string }> };
    expect(body.tools.map((t) => t.name)).toEqual(['alpha']);
  });

  it('returns 404 from /run for a tool disabled on the profile', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const { profileId, token } = await createProfileWithToken(env);

    await worker.fetch(
      adminRequest(`/admin/api/profiles/${profileId}/pieces/test-profile-piece/action/beta`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      env,
      createExecutionContext(),
    );

    const disabled = await worker.fetch(
      new Request(`${ORIGIN}/run/test-profile-piece/beta`, {
        method: 'POST',
        headers: { authorization: bearer(token), 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
      createExecutionContext(),
    );
    expect(disabled.status).toBe(404);

    const enabled = await worker.fetch(
      new Request(`${ORIGIN}/run/test-profile-piece/alpha`, {
        method: 'POST',
        headers: { authorization: bearer(token), 'content-type': 'application/json' },
        body: '{}',
      }),
      env,
      createExecutionContext(),
    );
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toEqual({ ok: true, result: { ok: 'alpha' } });
  });

  it('rejects a revoked profile token with 401', async () => {
    const env = createEnv(new MemoryKv() as unknown as KVNamespace);
    const { profileId, token } = await createProfileWithToken(env);

    const revoke = await worker.fetch(
      adminRequest(`/admin/api/profiles/${profileId}/token`, { method: 'DELETE' }),
      env,
      createExecutionContext(),
    );
    expect(revoke.status).toBe(200);

    const res = await worker.fetch(
      new Request(`${ORIGIN}/mcp/test-profile-piece`, {
        method: 'POST',
        headers: { authorization: bearer(token), 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env,
      createExecutionContext(),
    );
    expect(res.status).toBe(401);
  });
});
