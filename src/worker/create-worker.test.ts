import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../framework/types';

// Must reset modules between tests because the registry is module-global.
// Each test gets its own isolated registry state.

function createEnv(): Env {
  return {
    FREEPIECES_PUBLIC_URL: 'https://freepieces.example.workers.dev',
    FREEPIECES_TOKEN_STORE: undefined,
    FREEPIECES_AUTH_STORE: undefined,
    FREEPIECES_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    FREEPIECES_ADMIN_EMAILS: 'admin@example.com',
  };
}

function createCtx(): ExecutionContext {
  return { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
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
  });
});
