import { describe, expect, it, vi } from 'vitest';

import {
  USER_TOOL_STATE_KEY,
  isActionEnabledForUser,
  isTriggerEnabledForUser,
  loadUserToolState,
  setActionEnabledForUser,
  setTriggerEnabledForUser,
} from './user-tool-state';

function createKv(initialEntries: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialEntries));

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    dump(): Record<string, string> {
      return Object.fromEntries(store.entries());
    },
  } as unknown as KVNamespace & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    dump: () => Record<string, string>;
  };
}

describe('user-tool-state', () => {
  it('defaults every action and trigger to enabled when no record exists', async () => {
    const kv = createKv();

    await expect(loadUserToolState(kv, 'admin-user', 'gmail')).resolves.toEqual({
      version: 1,
      disabledActions: [],
      disabledTriggers: [],
    });
    await expect(isActionEnabledForUser(kv, 'admin-user', 'gmail', 'send_email')).resolves.toBe(true);
    await expect(isTriggerEnabledForUser(kv, 'admin-user', 'gmail', 'new_email')).resolves.toBe(true);
  });

  it('treats missing user scope as fully enabled', async () => {
    const kv = createKv({
      [USER_TOOL_STATE_KEY('someone', 'gmail')]: JSON.stringify({
        version: 1,
        disabledActions: ['send_email'],
        disabledTriggers: ['new_email'],
      }),
    });

    await expect(isActionEnabledForUser(kv, undefined, 'gmail', 'send_email')).resolves.toBe(true);
    await expect(isTriggerEnabledForUser(kv, undefined, 'gmail', 'new_email')).resolves.toBe(true);
  });

  it('persists disabled actions and triggers in one per-user record', async () => {
    const kv = createKv();

    await setActionEnabledForUser(kv, 'admin-user', 'gmail', 'send_email', false);
    await setTriggerEnabledForUser(kv, 'admin-user', 'gmail', 'new_email', false);

    expect(kv.dump()).toEqual({
      [USER_TOOL_STATE_KEY('admin-user', 'gmail')]: JSON.stringify({
        version: 1,
        disabledActions: ['send_email'],
        disabledTriggers: ['new_email'],
      }),
    });

    await expect(isActionEnabledForUser(kv, 'admin-user', 'gmail', 'send_email')).resolves.toBe(false);
    await expect(isTriggerEnabledForUser(kv, 'admin-user', 'gmail', 'new_email')).resolves.toBe(false);
  });

  it('removes the record again when every item is re-enabled', async () => {
    const kv = createKv();

    await setActionEnabledForUser(kv, 'admin-user', 'gmail', 'send_email', false);
    await setTriggerEnabledForUser(kv, 'admin-user', 'gmail', 'new_email', false);
    await setActionEnabledForUser(kv, 'admin-user', 'gmail', 'send_email', true);
    await setTriggerEnabledForUser(kv, 'admin-user', 'gmail', 'new_email', true);

    expect(kv.dump()).toEqual({});
    expect(kv.delete).toHaveBeenCalledWith(USER_TOOL_STATE_KEY('admin-user', 'gmail'));
  });

  it('normalizes corrupt or noisy stored data back to the safe empty state', async () => {
    const kv = createKv({
      [USER_TOOL_STATE_KEY('admin-user', 'gmail')]: JSON.stringify({
        disabledActions: ['send_email', 'send_email', '', 123],
        disabledTriggers: 'not-an-array',
      }),
    });

    await expect(loadUserToolState(kv, 'admin-user', 'gmail')).resolves.toEqual({
      version: 1,
      disabledActions: ['send_email'],
      disabledTriggers: [],
    });
  });
});
