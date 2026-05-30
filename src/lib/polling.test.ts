import { describe, expect, it, vi } from 'vitest';

import { USER_TOOL_STATE_KEY } from './user-tool-state';

function createKv(records: Record<string, string>) {
  const store = new Map(Object.entries(records));
  const put = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  });

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put,
    list: vi.fn(async (options?: { prefix?: string; cursor?: string }) => {
      const prefix = options?.prefix ?? '';
      const keys = [...store.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((name) => ({ name }));

      return {
        keys,
        list_complete: true,
        cursor: '',
      };
    }),
  } as unknown as KVNamespace & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
}

describe('runAllPollingTriggers', () => {
  it('skips polling delivery for subscriptions whose trigger is disabled for their user', async () => {
    vi.resetModules();

    const triggerRun = vi.fn().mockResolvedValue([{ id: 'evt-1' }]);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { runAllPollingTriggers } = await import('./polling.js');
      const { registerPiece } = await import('../framework/registry.js');

      registerPiece({
        name: 'poll-toggle-test',
        displayName: 'Poll Toggle Test',
        version: '1.0.0',
        auth: { type: 'none' },
        actions: [],
        triggers: [
          {
            name: 'poll-events',
            displayName: 'Poll Events',
            description: 'Polling test trigger.',
            type: 'POLLING',
            props: {},
            run: triggerRun,
          },
        ],
      });

      const kv = createKv({
        'sub:poll-toggle-test:sub-1': JSON.stringify({
          id: 'sub-1',
          trigger: 'poll-events',
          propsValue: {},
          callbackUrl: 'https://example.com/callback',
          userId: 'admin-user',
          createdAt: '2026-05-24T00:00:00.000Z',
        }),
        [USER_TOOL_STATE_KEY('admin-user', 'poll-toggle-test')]: JSON.stringify({
          version: 1,
          disabledActions: [],
          disabledTriggers: ['poll-events'],
        }),
      });

      await runAllPollingTriggers({
        FREEPIECES_TOKEN_STORE: kv,
      } as never);

      expect(triggerRun).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(kv.put).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
