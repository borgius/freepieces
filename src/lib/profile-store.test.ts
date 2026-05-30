import { describe, expect, it, vi } from 'vitest';

import {
  createProfile,
  deleteProfile,
  generateProfileTokenValue,
  getProfile,
  hashProfileToken,
  isProfileToken,
  listProfiles,
  profileToolOwner,
  regenerateProfileToken,
  renameProfile,
  resolveProfileToken,
  revokeProfileToken,
} from './profile-store';

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
    list: vi.fn(async ({ prefix, cursor }: { prefix?: string; cursor?: string } = {}) => {
      void cursor;
      const keys = [...store.keys()]
        .filter((name) => !prefix || name.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    }),
    dump(): Record<string, string> {
      return Object.fromEntries(store.entries());
    },
  } as unknown as KVNamespace & { dump: () => Record<string, string> };
}

describe('profile-store', () => {
  it('creates and lists profiles per owning user', async () => {
    const kv = createKv();

    const a = await createProfile(kv, 'owner@example.com', 'Work');
    const b = await createProfile(kv, 'owner@example.com', 'Personal');
    await createProfile(kv, 'other@example.com', 'Theirs');

    expect(a.userId).toBe('owner@example.com');
    expect(a.tokenHash).toBeNull();

    const profiles = await listProfiles(kv, 'owner@example.com');
    expect(profiles.map((p) => p.name)).toEqual(['Work', 'Personal']);
    expect(profiles.map((p) => p.id)).toContain(a.id);
    expect(profiles.map((p) => p.id)).toContain(b.id);
  });

  it('renames a profile and leaves others untouched', async () => {
    const kv = createKv();
    const profile = await createProfile(kv, 'owner@example.com', 'Old');

    const renamed = await renameProfile(kv, 'owner@example.com', profile.id, 'New');
    expect(renamed?.name).toBe('New');

    const loaded = await getProfile(kv, 'owner@example.com', profile.id);
    expect(loaded?.name).toBe('New');

    expect(await renameProfile(kv, 'owner@example.com', 'missing', 'X')).toBeNull();
  });

  it('generates a scoped token that resolves to the owning identity and profile', async () => {
    const kv = createKv();
    const profile = await createProfile(kv, 'owner@example.com', 'Work');

    const issued = await regenerateProfileToken(kv, 'owner@example.com', profile.id);
    expect(issued).not.toBeNull();
    expect(isProfileToken(issued!.token)).toBe(true);
    expect(issued!.profile.tokenHash).toBe(await hashProfileToken(issued!.token));

    const resolved = await resolveProfileToken(kv, issued!.token);
    expect(resolved).toEqual({ userId: 'owner@example.com', profileId: profile.id });
  });

  it('never stores the plaintext token in KV', async () => {
    const kv = createKv();
    const profile = await createProfile(kv, 'owner@example.com', 'Work');
    const issued = await regenerateProfileToken(kv, 'owner@example.com', profile.id);

    const serialized = JSON.stringify(kv.dump());
    expect(serialized).not.toContain(issued!.token);
  });

  it('invalidates the previous token when regenerating', async () => {
    const kv = createKv();
    const profile = await createProfile(kv, 'owner@example.com', 'Work');

    const first = await regenerateProfileToken(kv, 'owner@example.com', profile.id);
    const second = await regenerateProfileToken(kv, 'owner@example.com', profile.id);

    expect(await resolveProfileToken(kv, first!.token)).toBeNull();
    expect(await resolveProfileToken(kv, second!.token)).toEqual({
      userId: 'owner@example.com',
      profileId: profile.id,
    });
  });

  it('revokes a token without deleting the profile', async () => {
    const kv = createKv();
    const profile = await createProfile(kv, 'owner@example.com', 'Work');
    const issued = await regenerateProfileToken(kv, 'owner@example.com', profile.id);

    const revoked = await revokeProfileToken(kv, 'owner@example.com', profile.id);
    expect(revoked?.tokenHash).toBeNull();
    expect(await resolveProfileToken(kv, issued!.token)).toBeNull();
    expect(await getProfile(kv, 'owner@example.com', profile.id)).not.toBeNull();
  });

  it('deletes a profile along with its token index and tool state', async () => {
    const kv = createKv();
    const profile = await createProfile(kv, 'owner@example.com', 'Work');
    const issued = await regenerateProfileToken(kv, 'owner@example.com', profile.id);

    // Simulate per-profile tool state written elsewhere.
    await kv.put(`__admin:user-tool-state:${profileToolOwner(profile.id)}:gmail`, '{"version":1}');

    expect(await deleteProfile(kv, 'owner@example.com', profile.id)).toBe(true);
    expect(await getProfile(kv, 'owner@example.com', profile.id)).toBeNull();
    expect(await resolveProfileToken(kv, issued!.token)).toBeNull();
    expect(kv.dump()[`__admin:user-tool-state:${profileToolOwner(profile.id)}:gmail`]).toBeUndefined();
  });

  it('rejects non-profile and unknown tokens', async () => {
    const kv = createKv();
    expect(isProfileToken('fp_sk_static')).toBe(false);
    expect(isProfileToken(generateProfileTokenValue())).toBe(true);

    expect(await resolveProfileToken(kv, 'fp_sk_static')).toBeNull();
    expect(await resolveProfileToken(kv, generateProfileTokenValue())).toBeNull();
  });
});
