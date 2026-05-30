import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../framework/types';
import { USER_TOOL_STATE_KEY } from '../lib/user-tool-state';

// Must reset modules between tests because the registry is module-global.
// Each test gets its own isolated registry state.

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

function createEnv(kv?: KVNamespace): Env {
  return {
    FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
    FREEPIECES_TOKEN_STORE: kv,
    FREEPIECES_AUTH_STORE: undefined,
    FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
  };
}

function createCtx(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
}

async function createWorkerWithTogglePiece(runApiKey?: string, kv?: KVNamespace) {
  const { createFreepiecesWorker } = await import('./create-worker.js');
  const { registerPiece } = await import('../framework/registry.js');
  const env = createEnv(kv);
  env.FREEPIECES_RUN_API_KEY = runApiKey;

  registerPiece({
    name: 'toggle-test',
    displayName: 'Toggle Test',
    version: '1.0.0',
    auth: { type: 'none' },
    actions: [
      {
        name: 'inspect',
        displayName: 'Inspect',
        description: 'Returns the supplied props.',
        props: {
          message: {
            type: 'SHORT_TEXT',
            displayName: 'Message',
            required: false,
          },
        },
        run: async (ctx) => ({ props: ctx.props }),
      },
    ],
    triggers: [
      {
        name: 'new-event',
        displayName: 'New Event',
        description: 'Returns one synthetic event.',
        type: 'WEBHOOK',
        props: {},
        run: async () => [{ id: 'evt-1' }],
      },
    ],
  });

  return { worker: createFreepiecesWorker(), env };
}

describe('createFreepiecesWorker()', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns a health response', async () => {
    const { createFreepiecesWorker } = await import('./create-worker.js');
    const worker = createFreepiecesWorker();

    const res = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/health'),
      createEnv(),
      createCtx(),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('lists only pieces registered before the factory call', async () => {
    const { createFreepiecesWorker } = await import('./create-worker.js');
    const { registerPiece } = await import('../framework/registry.js');

    registerPiece({
      name: 'test-piece',
      displayName: 'Test Piece',
      version: '1.0.0',
      auth: { type: 'none' },
      actions: [
        {
          name: 'ping',
          displayName: 'Ping',
          description: undefined,
          props: undefined,
          run: async () => ({ pong: true }),
        },
      ],
      triggers: [],
    });

    const worker = createFreepiecesWorker();
    const res = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/pieces'),
      createEnv(),
      createCtx(),
    );

    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ name: string }>;
    expect(body.some((p) => p.name === 'test-piece')).toBe(true);
  });

  it('returns 404 for unknown routes', async () => {
    const { createFreepiecesWorker } = await import('./create-worker.js');
    const worker = createFreepiecesWorker();

    const res = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/does-not-exist'),
      createEnv(),
      createCtx(),
    );

    expect(res.status).toBe(404);
  });

  it('does not import pieces/index.ts (no built-in pieces registered)', async () => {
    const { createFreepiecesWorker } = await import('./create-worker.js');
    const worker = createFreepiecesWorker();

    const res = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/pieces'),
      createEnv(),
      createCtx(),
    );

    expect(res.status).toBe(200);
    // Fresh module — no pieces pre-registered in this isolated instance
    const body = await res.json() as Array<{ name: string }>;
    expect(body).toEqual([]);
  });

  it('sets a short Cache-Control header on /pieces', async () => {
    const { createFreepiecesWorker } = await import('./create-worker.js');
    const worker = createFreepiecesWorker();

    const res = await worker.fetch(
      new Request('https://freepieces.example.workers.dev/pieces'),
      createEnv(),
      createCtx(),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  describe('MCP interface', () => {
    async function createWorkerWithMcpPiece(runApiKey?: string) {
      const { createFreepiecesWorker } = await import('./create-worker.js');
      const { registerPiece } = await import('../framework/registry.js');
      const env = createEnv();
      env.FREEPIECES_RUN_API_KEY = runApiKey;

      registerPiece({
        name: 'mcp-test',
        displayName: 'MCP Test',
        version: '1.0.0',
        auth: { type: 'apiKey' },
        actions: [
          {
            name: 'inspect',
            displayName: 'Inspect',
            description: 'Returns resolved auth and props.',
            props: {
              message: {
                type: 'SHORT_TEXT',
                displayName: 'Message',
                required: true,
              },
            },
            run: async (ctx) => ({
              auth: ctx.auth,
              props: ctx.props,
            }),
          },
        ],
        triggers: [],
      });

      return { worker: createFreepiecesWorker(), env };
    }

    it('lists piece actions as MCP tools when authenticated with RUN_API_KEY', async () => {
      const { worker, env } = await createWorkerWithMcpPiece('fp_sk_mcp');
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/mcp/mcp-test', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_mcp',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        result: {
          tools: Array<{
            name: string;
            title: string;
            inputSchema: { required?: string[]; properties: Record<string, { type: string }> };
          }>;
        };
      };
      expect(body.result.tools).toEqual([
        {
          name: 'inspect',
          title: 'Inspect',
          description: 'Returns resolved auth and props.',
          inputSchema: {
            type: 'object',
            properties: {
              message: {
                title: 'Message',
                description: undefined,
                type: 'string',
              },
            },
            required: ['message'],
          },
        },
      ]);
    });

    it('falls back to displayName as description when action has no description', async () => {
      const { createFreepiecesWorker } = await import('./create-worker.js');
      const { registerPiece } = await import('../framework/registry.js');
      const env = createEnv();
      env.FREEPIECES_RUN_API_KEY = 'fp_sk_mcp';

      registerPiece({
        name: 'no-desc-test',
        displayName: 'No Desc Test',
        version: '1.0.0',
        auth: { type: 'apiKey' },
        actions: [
          {
            name: 'do_thing',
            displayName: 'Do Thing',
            props: {},
            run: async () => ({}),
          },
        ],
        triggers: [],
      });

      const worker = createFreepiecesWorker();
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/mcp/no-desc-test', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_mcp',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { result: { tools: Array<{ name: string; description: string }> } };
      const tool = body.result.tools.find((t) => t.name === 'do_thing');
      expect(tool?.description).toBe('Do Thing.');
    });

    it('calls an MCP tool with the same split auth headers as /run', async () => {
      const { worker, env } = await createWorkerWithMcpPiece('fp_sk_mcp');
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/mcp/mcp-test', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_mcp',
            'Content-Type': 'application/json',
            'X-Piece-Token': 'piece-token',
            'X-Piece-Auth': JSON.stringify({ extra: 'named-secret' }),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'inspect',
              arguments: { message: 'hello' },
            },
          }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        result: {
          content: Array<{ type: string; text: string }>;
          structuredContent: {
            auth: Record<string, string>;
            props: Record<string, unknown>;
          };
        };
      };
      expect(body.result.structuredContent).toEqual({
        auth: { token: 'piece-token', extra: 'named-secret' },
        props: { message: 'hello' },
      });
      expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent);
    });

    it('rejects MCP requests when RUN_API_KEY is configured and bearer auth is missing', async () => {
      const { worker, env } = await createWorkerWithMcpPiece('fp_sk_mcp');
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/mcp/mcp-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    });

    it('uses the bearer token as the direct piece credential in local MCP mode', async () => {
      const { worker, env } = await createWorkerWithMcpPiece();
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/mcp/mcp-test', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer local-piece-token',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'inspect',
              arguments: { message: 'local' },
            },
          }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(200);
      const body = await response.json() as {
        result: { structuredContent: { auth: Record<string, string>; props: Record<string, unknown> } };
      };
      expect(body.result.structuredContent).toEqual({
        auth: { token: 'local-piece-token' },
        props: { message: 'local' },
      });
    });

    it('filters disabled actions out of MCP tool discovery for the current user', async () => {
      const kv = new MemoryKv({
        [USER_TOOL_STATE_KEY('admin-user', 'toggle-test')]: JSON.stringify({
          version: 1,
          disabledActions: ['inspect'],
          disabledTriggers: [],
        }),
      }) as unknown as KVNamespace;

      const { worker, env } = await createWorkerWithTogglePiece('fp_sk_toggle', kv);
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/mcp/toggle-test', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_toggle',
            'Content-Type': 'application/json',
            'X-User-Id': 'admin-user',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'tools', method: 'tools/list' }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { result: { tools: Array<{ name: string }> } };
      expect(body.result.tools).toEqual([]);
    });

    it('treats disabled MCP actions as unknown tools for the current user', async () => {
      const kv = new MemoryKv({
        [USER_TOOL_STATE_KEY('admin-user', 'toggle-test')]: JSON.stringify({
          version: 1,
          disabledActions: ['inspect'],
          disabledTriggers: [],
        }),
      }) as unknown as KVNamespace;

      const { worker, env } = await createWorkerWithTogglePiece('fp_sk_toggle', kv);
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/mcp/toggle-test', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_toggle',
            'Content-Type': 'application/json',
            'X-User-Id': 'admin-user',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'inspect',
              arguments: { message: 'hello' },
            },
          }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'Unknown tool: inspect' },
      });
    });
  });

  describe('runtime user toggles', () => {
    it('returns 404 from /run when the action is disabled for the current user', async () => {
      const kv = new MemoryKv({
        [USER_TOOL_STATE_KEY('admin-user', 'toggle-test')]: JSON.stringify({
          version: 1,
          disabledActions: ['inspect'],
          disabledTriggers: [],
        }),
      }) as unknown as KVNamespace;

      const { worker, env } = await createWorkerWithTogglePiece('fp_sk_toggle', kv);
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/run/toggle-test/inspect', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_toggle',
            'Content-Type': 'application/json',
            'X-User-Id': 'admin-user',
          },
          body: JSON.stringify({ message: 'hello' }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Action not found' });
    });

    it('returns 404 from /trigger when the trigger is disabled for the current user', async () => {
      const kv = new MemoryKv({
        [USER_TOOL_STATE_KEY('admin-user', 'toggle-test')]: JSON.stringify({
          version: 1,
          disabledActions: [],
          disabledTriggers: ['new-event'],
        }),
      }) as unknown as KVNamespace;

      const { worker, env } = await createWorkerWithTogglePiece('fp_sk_toggle', kv);
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/trigger/toggle-test/new-event', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_toggle',
            'Content-Type': 'application/json',
            'X-User-Id': 'admin-user',
          },
          body: JSON.stringify({ payload: { ok: true } }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Trigger not found' });
    });

    it('returns 404 from /subscriptions when the trigger is disabled for the current user', async () => {
      const kv = new MemoryKv({
        [USER_TOOL_STATE_KEY('admin-user', 'toggle-test')]: JSON.stringify({
          version: 1,
          disabledActions: [],
          disabledTriggers: ['new-event'],
        }),
      }) as unknown as KVNamespace;

      const { worker, env } = await createWorkerWithTogglePiece('fp_sk_toggle', kv);
      const response = await worker.fetch(
        new Request('https://freepieces.example.workers.dev/subscriptions/toggle-test/new-event', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer fp_sk_toggle',
            'Content-Type': 'application/json',
            'X-User-Id': 'admin-user',
          },
          body: JSON.stringify({ callbackUrl: 'https://example.com/callback', propsValue: {} }),
        }),
        env,
        createCtx(),
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'Trigger not found' });
    });
  });
});
