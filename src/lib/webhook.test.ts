import { describe, expect, it, vi } from 'vitest';

import { listSubscriptions } from './webhook';

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
