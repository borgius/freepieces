import { describe, expect, it, vi } from 'vitest';
import { listStoredUserIds } from './token-store';

describe('listStoredUserIds', () => {
  it('lists stored users across paginated KV pages', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        keys: [
          { name: 'token:gmail:alice@example.com' },
          { name: 'token:gmail:team:ops@example.com' },
        ],
        list_complete: false,
        cursor: 'page-2',
      })
      .mockResolvedValueOnce({
        keys: [
          { name: 'token:gmail:bob@example.com' },
        ],
        list_complete: true,
        cursor: '',
      });

    const kv = { list } as unknown as KVNamespace;

    await expect(listStoredUserIds(kv, 'gmail')).resolves.toEqual([
      'alice@example.com',
      'team:ops@example.com',
      'bob@example.com',
    ]);

    expect(list).toHaveBeenNthCalledWith(1, { prefix: 'token:gmail:' });
    expect(list).toHaveBeenNthCalledWith(2, { prefix: 'token:gmail:', cursor: 'page-2' });
  });

  it('returns an empty list when no users are stored', async () => {
    const kv = {
      list: vi.fn().mockResolvedValue({ keys: [], list_complete: true, cursor: '' }),
    } as unknown as KVNamespace;

    await expect(listStoredUserIds(kv, 'gmail')).resolves.toEqual([]);
  });

  it('short-circuits once the limit is reached and does not page further', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        keys: [
          { name: 'token:gmail:alice@example.com' },
          { name: 'token:gmail:bob@example.com' },
          { name: 'token:gmail:charlie@example.com' },
        ],
        list_complete: false,
        cursor: 'page-2',
      })
      .mockResolvedValueOnce({ keys: [{ name: 'token:gmail:dana@example.com' }], list_complete: true, cursor: '' });

    const kv = { list } as unknown as KVNamespace;
    const out = await listStoredUserIds(kv, 'gmail', 2);
    expect(out).toEqual(['alice@example.com', 'bob@example.com']);
    expect(list).toHaveBeenCalledTimes(1);
  });
});