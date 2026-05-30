import { describe, expect, it, vi } from 'vitest';

import { listSubscriptions, interpolateEnvRefs, resolveHeaderInjections, isWebhookMethod, WEBHOOK_METHODS } from './webhook';
import { USER_TOOL_STATE_KEY } from './user-tool-state';

function makeKV(pages: Array<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>, records: Record<string, string>) {
  const list = vi.fn();
  for (const p of pages) list.mockResolvedValueOnce(p);
  const get = vi.fn(async (name: string) => records[name] ?? null);
  return { list, get } as unknown as KVNamespace & { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
}

describe('listSubscriptions', () => {
  it('walks every page and fetches records in parallel', async () => {
    const sub1 = { id: '1', trigger: 't', propsValue: {}, createdAt: '' };
    const sub2 = { id: '2', trigger: 't', propsValue: {}, createdAt: '' };
    const sub3 = { id: '3', trigger: 't', propsValue: {}, createdAt: '' };

    const kv = makeKV(
      [
        {
          keys: [{ name: 'sub:slack:1' }, { name: 'sub:slack:2' }],
          list_complete: false,
          cursor: 'next',
        },
        {
          keys: [{ name: 'sub:slack:3' }],
          list_complete: true,
          cursor: '',
        },
      ],
      {
        'sub:slack:1': JSON.stringify(sub1),
        'sub:slack:2': JSON.stringify(sub2),
        'sub:slack:3': JSON.stringify(sub3),
      },
    );

    // Resolve all get() promises only after every sync call is observed, proving parallelism.
    const pending: Array<() => void> = [];
    kv.get.mockImplementation(
      (name: string) =>
        new Promise((resolve) => {
          pending.push(() => resolve(JSON.stringify({ id: name.split(':').pop(), trigger: 't', propsValue: {}, createdAt: '' })));
        }),
    );

    const promise = listSubscriptions(kv, 'slack');
    // Microtask drain so Promise.all fires all get() calls.
    await new Promise((r) => setTimeout(r, 0));
    expect(kv.get).toHaveBeenCalledTimes(3);
    pending.forEach((p) => p());

    const subs = await promise;
    expect(subs.map((s) => s.id).sort()).toEqual(['1', '2', '3']);
  });

  it('skips corrupt JSON records without failing the whole list', async () => {
    const kv = makeKV(
      [{ keys: [{ name: 'sub:slack:a' }, { name: 'sub:slack:b' }], list_complete: true, cursor: '' }],
      {
        'sub:slack:a': 'not-json',
        'sub:slack:b': JSON.stringify({ id: 'b', trigger: 't', propsValue: {}, createdAt: '' }),
      },
    );

    const subs = await listSubscriptions(kv, 'slack');
    expect(subs.map((s) => s.id)).toEqual(['b']);
  });
});

describe('dispatchWebhook', () => {
  it('skips delivery for subscriptions whose trigger is disabled for their user', async () => {
    vi.resetModules();

    const triggerRun = vi.fn().mockResolvedValue([{ id: 'evt-1' }]);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { dispatchWebhook } = await import('./webhook.js');
      const { registerPiece } = await import('../framework/registry.js');

      registerPiece({
        name: 'dispatch-toggle-test',
        displayName: 'Dispatch Toggle Test',
        version: '1.0.0',
        auth: { type: 'none' },
        actions: [],
        triggers: [
          {
            name: 'new-event',
            displayName: 'New Event',
            description: 'Dispatch test trigger.',
            type: 'WEBHOOK',
            props: {},
            run: triggerRun,
          },
        ],
      });

      const kv = makeKV(
        [{ keys: [{ name: 'sub:dispatch-toggle-test:sub-1' }], list_complete: true, cursor: '' }],
        {
          'sub:dispatch-toggle-test:sub-1': JSON.stringify({
            id: 'sub-1',
            trigger: 'new-event',
            propsValue: {},
            callbackUrl: 'https://example.com/callback',
            userId: 'admin-user',
            createdAt: '2026-05-24T00:00:00.000Z',
          }),
          [USER_TOOL_STATE_KEY('admin-user', 'dispatch-toggle-test')]: JSON.stringify({
            version: 1,
            disabledActions: [],
            disabledTriggers: ['new-event'],
          }),
        },
      );

      await dispatchWebhook('dispatch-toggle-test', { ok: true }, {
        FREEPIECES_TOKEN_STORE: kv,
      } as never);

      expect(triggerRun).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('applies method, injected headers, and jq transform when delivering to a callback URL', async () => {
    vi.resetModules();

    const triggerRun = vi.fn().mockResolvedValue([{ id: 'evt-1' }, { id: 'evt-2' }]);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const { dispatchWebhook } = await import('./webhook.js');
      const { registerPiece } = await import('../framework/registry.js');

      registerPiece({
        name: 'dispatch-headers-test',
        displayName: 'Dispatch Headers Test',
        version: '1.0.0',
        auth: { type: 'none' },
        actions: [],
        triggers: [
          {
            name: 'new-event',
            displayName: 'New Event',
            description: 'Dispatch test trigger.',
            type: 'WEBHOOK',
            props: {},
            run: triggerRun,
          },
        ],
      });

      const kv = makeKV(
        [{ keys: [{ name: 'sub:dispatch-headers-test:sub-1' }], list_complete: true, cursor: '' }],
        {
          'sub:dispatch-headers-test:sub-1': JSON.stringify({
            id: 'sub-1',
            trigger: 'new-event',
            propsValue: {},
            callbackUrl: 'https://example.com/callback',
            method: 'PUT',
            headers: { 'x-inject': 'val-${GREETING}', 'x-static': 'hi' },
            jqTransform: '{ count: (.events | length) }',
            createdAt: '2026-05-24T00:00:00.000Z',
          }),
        },
      );

      await dispatchWebhook('dispatch-headers-test', { ok: true }, {
        FREEPIECES_TOKEN_STORE: kv,
        FREEPIECES_GREETING: 'hello',
      } as never);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.com/callback');
      expect(init.method).toBe('PUT');
      const headers = init.headers as Record<string, string>;
      expect(headers['x-inject']).toBe('val-hello');
      expect(headers['x-static']).toBe('hi');
      expect(headers['content-type']).toBe('application/json');
      // jq transform replaced the payload with the computed envelope
      expect(JSON.parse(init.body as string)).toEqual({ count: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips delivery when the jq transform program is invalid', async () => {
    vi.resetModules();

    const triggerRun = vi.fn().mockResolvedValue([{ id: 'evt-1' }]);
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { dispatchWebhook } = await import('./webhook.js');
      const { registerPiece } = await import('../framework/registry.js');

      registerPiece({
        name: 'dispatch-badjq-test',
        displayName: 'Dispatch Bad jq Test',
        version: '1.0.0',
        auth: { type: 'none' },
        actions: [],
        triggers: [
          {
            name: 'new-event',
            displayName: 'New Event',
            description: 'Dispatch test trigger.',
            type: 'WEBHOOK',
            props: {},
            run: triggerRun,
          },
        ],
      });

      const kv = makeKV(
        [{ keys: [{ name: 'sub:dispatch-badjq-test:sub-1' }], list_complete: true, cursor: '' }],
        {
          'sub:dispatch-badjq-test:sub-1': JSON.stringify({
            id: 'sub-1',
            trigger: 'new-event',
            propsValue: {},
            callbackUrl: 'https://example.com/callback',
            jqTransform: '.events |',
            createdAt: '2026-05-24T00:00:00.000Z',
          }),
        },
      );

      await dispatchWebhook('dispatch-badjq-test', { ok: true }, {
        FREEPIECES_TOKEN_STORE: kv,
      } as never);

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('interpolateEnvRefs', () => {
  const env = { FREEPIECES_API_TOKEN: 'abc123', PLAIN: 'raw' } as never;

  it('replaces references with resolved env values', () => {
    expect(interpolateEnvRefs('Bearer ${API_TOKEN}', env)).toBe('Bearer abc123');
    expect(interpolateEnvRefs('${PLAIN}/x', env)).toBe('raw/x');
  });

  it('resolves unknown references to an empty string', () => {
    expect(interpolateEnvRefs('a${MISSING}b', env)).toBe('ab');
  });

  it('returns the input unchanged when there are no references', () => {
    expect(interpolateEnvRefs('no refs here', env)).toBe('no refs here');
  });

  it('resolves header maps via resolveHeaderInjections', () => {
    expect(resolveHeaderInjections({ authorization: 'Bearer ${API_TOKEN}', x: 'y' }, env)).toEqual({
      authorization: 'Bearer abc123',
      x: 'y',
    });
    expect(resolveHeaderInjections(undefined, env)).toEqual({});
  });
});

describe('isWebhookMethod', () => {
  it('accepts whitelisted methods and rejects others', () => {
    for (const m of WEBHOOK_METHODS) expect(isWebhookMethod(m)).toBe(true);
    expect(isWebhookMethod('TRACE')).toBe(false);
    expect(isWebhookMethod('post')).toBe(false);
    expect(isWebhookMethod(undefined)).toBe(false);
  });
});
