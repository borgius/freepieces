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
});
