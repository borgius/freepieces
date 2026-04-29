import { describe, expect, it } from 'vitest';

import { cloudflareR2Piece } from './cloudflare-r2';
import type { Env } from '../framework/types';

class FakeR2Object {
  readonly version = 'v1';
  readonly etag = 'etag-1';
  readonly httpEtag = '"etag-1"';
  readonly uploaded = new Date('2026-01-01T00:00:00.000Z');
  readonly storageClass = 'Standard';

  constructor(
    readonly key: string,
    private readonly value: string,
    readonly httpMetadata?: R2HTTPMetadata,
    readonly customMetadata?: Record<string, string>,
  ) {}

  get size(): number {
    return this.value.length;
  }

  async text(): Promise<string> {
    return this.value;
  }

  async json<T>(): Promise<T> {
    return JSON.parse(this.value) as T;
  }
}

class FakeR2Bucket {
  readonly objects = new Map<string, FakeR2Object>();
  deletedKey: string | string[] | undefined;
  lastListOptions: R2ListOptions | undefined;

  async put(key: string, value: string | null, options?: R2PutOptions): Promise<FakeR2Object> {
    const object = new FakeR2Object(
      key,
      value ?? '',
      options?.httpMetadata as R2HTTPMetadata | undefined,
      options?.customMetadata,
    );
    this.objects.set(key, object);
    return object;
  }

  async get(key: string): Promise<FakeR2Object | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string | string[]): Promise<void> {
    this.deletedKey = key;
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    this.lastListOptions = options;
    const prefix = options?.prefix ?? '';
    return {
      objects: [...this.objects.values()].filter((object) => object.key.startsWith(prefix)) as unknown as R2Object[],
      delimitedPrefixes: [],
      truncated: false,
    };
  }
}

function createEnv(bucket = new FakeR2Bucket()): Env {
  return { BUCKET: bucket } as unknown as Env;
}

function getAction(name: string) {
  const action = cloudflareR2Piece.actions.find((entry) => entry.name === name);
  if (!action) throw new Error(`Missing action ${name}`);
  return action;
}

describe('cloudflareR2Piece', () => {
  it('defines a no-auth Cloudflare R2 piece', () => {
    expect(cloudflareR2Piece.name).toBe('cloudflare-r2');
    expect(cloudflareR2Piece.auth.type).toBe('none');
    expect(cloudflareR2Piece.actions.map((action) => action.name)).toEqual([
      'put_object',
      'get_object',
      'delete_object',
      'list_objects',
    ]);
  });

  it('puts and gets text objects through the default BUCKET binding', async () => {
    const bucket = new FakeR2Bucket();
    const env = createEnv(bucket);

    const putResult = await getAction('put_object').run({
      env,
      props: {
        key: 'notes/hello.txt',
        value: 'hello',
        contentType: 'text/plain',
        customMetadata: { source: 'test' },
      },
    }) as { object: { key: string; size: number; customMetadata?: Record<string, string> } };

    expect(putResult.object.key).toBe('notes/hello.txt');
    expect(putResult.object.size).toBe(5);
    expect(putResult.object.customMetadata).toEqual({ source: 'test' });

    const getResult = await getAction('get_object').run({
      env,
      props: { key: 'notes/hello.txt' },
    });

    expect(getResult).toMatchObject({
      found: true,
      value: 'hello',
      object: { key: 'notes/hello.txt', uploaded: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('gets JSON objects when format is json', async () => {
    const bucket = new FakeR2Bucket();
    await bucket.put('data.json', '{"ok":true}');

    const result = await getAction('get_object').run({
      env: createEnv(bucket),
      props: { key: 'data.json', format: 'json' },
    });

    expect(result).toMatchObject({ found: true, value: { ok: true } });
  });

  it('deletes an object by key', async () => {
    const bucket = new FakeR2Bucket();
    const result = await getAction('delete_object').run({
      env: createEnv(bucket),
      props: { key: 'old.txt' },
    });

    expect(bucket.deletedKey).toBe('old.txt');
    expect(result).toEqual({ deleted: true });
  });

  it('lists objects with prefix and clamps limit', async () => {
    const bucket = new FakeR2Bucket();
    await bucket.put('logs/a.txt', 'a');
    await bucket.put('notes/b.txt', 'b');

    const result = await getAction('list_objects').run({
      env: createEnv(bucket),
      props: { prefix: 'logs/', limit: 5000 },
    }) as { objects: Array<{ key: string }> };

    expect(bucket.lastListOptions).toEqual({ limit: 1000, prefix: 'logs/' });
    expect(result.objects.map((object) => object.key)).toEqual(['logs/a.txt']);
  });

  it('returns found=false for missing objects', async () => {
    const result = await getAction('get_object').run({
      env: createEnv(),
      props: { key: 'missing.txt' },
    });

    expect(result).toEqual({ found: false, object: null, value: null });
  });
});
