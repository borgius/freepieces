/**
 * File-backed KV shim for Linux deployments.
 *
 * Implements the KV interface used throughout freepieces (get/put/delete/list).
 * Data is persisted to a JSON file on every mutation. Safe for single-process
 * deployments; not safe for multi-process/cluster use (V1 scope).
 *
 * The returned object satisfies the duck-typed check in `getKVBinding()`:
 *   `'get' in obj` → true
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface KVShim {
  get(key: string): Promise<string | null>;
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor: string | undefined;
  }>;
}

export function createFileKV(filePath: string): KVShim {
  mkdirSync(dirname(filePath), { recursive: true });
  let store: Record<string, string> = {};
  if (existsSync(filePath)) {
    try {
      store = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>;
    } catch {
      store = {};
    }
  }

  const save = () => writeFileSync(filePath, JSON.stringify(store, null, 2));

  return {
    async get(key: string, type?: 'json'): Promise<unknown> {
      const val = store[key] ?? null;
      if (type === 'json') return val ? (JSON.parse(val) as unknown) : null;
      return val;
    },
    async put(key: string, value: string) {
      store[key] = value;
      save();
    },
    async delete(key: string) {
      delete store[key];
      save();
    },
    async list({ prefix = '' }: { prefix?: string; cursor?: string } = {}) {
      const keys = Object.keys(store)
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((name) => ({ name }));
      return { keys, list_complete: true as const, cursor: undefined };
    },
  } as unknown as KVShim;
}
