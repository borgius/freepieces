/**
 * Environment variable resolution helpers.
 *
 * Every named binding or variable is resolved in this priority order:
 *   1. FREEPIECES_<NAME>  — canonical prefixed form
 *   2. FP_<NAME>          — short-prefix fallback
 *   3. <NAME>             — un-prefixed legacy name (backward compat)
 */

import type { Env } from '../framework/types';

type AnyRecord = Record<string, unknown>;

// Env key lookup order is fixed; precompute once per logical name so hot-path
// callers (every `/run` request reads several env vars) don't re-concatenate
// strings on every lookup.
const keyVariantsCache = new Map<string, readonly string[]>();
function keyVariants(name: string): readonly string[] {
  const cached = keyVariantsCache.get(name);
  if (cached) return cached;
  const variants = Object.freeze([`FREEPIECES_${name}`, `FP_${name}`, name]);
  keyVariantsCache.set(name, variants);
  return variants;
}

/**
 * Read a string env var.
 * Returns the first defined, non-empty string from the three key variants.
 */
export function getEnvStr(env: Env, name: string): string | undefined {
  const r = env as AnyRecord;
  for (const key of keyVariants(name)) {
    const v = r[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Read a required string env var.
 * Throws when none of the three key variants is set.
 */
export function requireEnvStr(env: Env, name: string): string {
  const v = getEnvStr(env, name);
  if (!v) throw new Error(`Required env var not configured: FREEPIECES_${name} / FP_${name} / ${name}`);
  return v;
}

/**
 * Read a KV namespace binding.
 * Returns the first defined binding from the three key variants.
 */
export function getKVBinding(env: Env, name: string): KVNamespace | undefined {
  const r = env as AnyRecord;
  for (const key of keyVariants(name)) {
    const v = r[key];
    if (v != null && typeof v === 'object' && 'get' in (v as object)) return v as KVNamespace;
  }
  return undefined;
}

/**
 * Read a required KV namespace binding.
 * Throws when none of the three key variants resolves to a KV namespace.
 */
export function requireKVBinding(env: Env, name: string): KVNamespace {
  const v = getKVBinding(env, name);
  if (!v) throw new Error(`Required KV binding not configured: FREEPIECES_${name} / FP_${name} / ${name}`);
  return v;
}

/**
 * Read a boolean env var.
 * Returns true when the first defined variant is "true", "1", or "yes" (case-insensitive).
 */
export function getEnvBool(env: Env, name: string): boolean {
  const v = getEnvStr(env, name);
  return v === 'true' || v === '1' || v === 'yes';
}
