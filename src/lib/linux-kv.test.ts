import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createFileKV } from './linux-kv';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;
let kvPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'freepieces-kv-test-'));
  kvPath = join(tmpDir, 'store.json');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createFileKV', () => {
  it('returns null for missing key', async () => {
    const kv = createFileKV(kvPath);
    expect(await kv.get('missing')).toBeNull();
  });

  it('put then get returns stored value', async () => {
    const kv = createFileKV(kvPath);
    await kv.put('foo', 'bar');
    expect(await kv.get('foo')).toBe('bar');
  });

  it('get with json type deserializes JSON', async () => {
    const kv = createFileKV(kvPath);
    await kv.put('obj', JSON.stringify({ x: 42 }));
    const result = await kv.get('obj', 'json');
    expect(result).toEqual({ x: 42 });
  });

  it('get json on missing key returns null', async () => {
    const kv = createFileKV(kvPath);
    const result = await kv.get('nope', 'json');
    expect(result).toBeNull();
  });

  it('delete removes the entry', async () => {
    const kv = createFileKV(kvPath);
    await kv.put('toDelete', 'value');
    await kv.delete('toDelete');
    expect(await kv.get('toDelete')).toBeNull();
  });

  it('list returns all keys sorted', async () => {
    const kv = createFileKV(kvPath);
    await kv.put('b', '2');
    await kv.put('a', '1');
    await kv.put('c', '3');
    const { keys, list_complete } = await kv.list();
    expect(keys.map((k) => k.name)).toEqual(['a', 'b', 'c']);
    expect(list_complete).toBe(true);
  });

  it('list filters by prefix', async () => {
    const kv = createFileKV(kvPath);
    await kv.put('token:alice', 'a');
    await kv.put('token:bob', 'b');
    await kv.put('other:charlie', 'c');
    const { keys } = await kv.list({ prefix: 'token:' });
    expect(keys.map((k) => k.name)).toEqual(['token:alice', 'token:bob']);
  });

  it('persists data to disk and restores on new instance', async () => {
    const kv1 = createFileKV(kvPath);
    await kv1.put('persistent', 'yes');

    // Create a second instance pointing at the same file
    const kv2 = createFileKV(kvPath);
    expect(await kv2.get('persistent')).toBe('yes');
  });

  it('handles concurrent puts without throwing', async () => {
    const kv = createFileKV(kvPath);
    await Promise.all([
      kv.put('k1', 'v1'),
      kv.put('k2', 'v2'),
      kv.put('k3', 'v3'),
    ]);
    expect(await kv.get('k1')).toBe('v1');
    expect(await kv.get('k2')).toBe('v2');
    expect(await kv.get('k3')).toBe('v3');
  });
});
