/**
 * jq transform engine wrapper.
 *
 * Wraps the WebAssembly `jq-web` build behind a small async API so the rest of
 * the codebase never touches the raw module. The engine is loaded lazily via a
 * dynamic import and cached for the lifetime of the isolate/process — the WASM
 * initialisation only happens on the first transform.
 *
 * Used to transform a piece's outbound webhook payload with a standard jq
 * program before delivery (`applyJq`) and to validate/preview programs from the
 * admin UI against a sample payload (`validateJq`).
 */

import type { JqWeb } from 'jq-web';

let jqPromise: Promise<JqWeb> | null = null;

/** Lazily initialise and cache the jq-web instance. */
async function getJq(): Promise<JqWeb> {
  if (!jqPromise) {
    jqPromise = loadJq().catch((err) => {
      // Reset so a transient load failure can be retried on the next call.
      jqPromise = null;
      throw err;
    });
  }
  return jqPromise;
}

/**
 * Load the `jq-web` CommonJS module via `createRequire`. The package's
 * `module.exports` is itself a thenable that resolves to the engine instance;
 * loading it through `require` (rather than a dynamic ESM `import`) avoids the
 * ESM namespace being treated as a thenable and double-unwrapped. jq-web also
 * loads its WebAssembly at runtime, so it only works on the Node/linux runtime.
 */
async function loadJq(): Promise<JqWeb> {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  // `module.exports` is a Promise-like that resolves to the JqWeb instance.
  const mod = require('jq-web') as PromiseLike<JqWeb>;
  return (await mod) as JqWeb;
}

/**
 * Apply a jq `program` to `payload` and return the transformed value.
 * Throws when the program has a syntax error or evaluation fails.
 */
export async function applyJq(payload: unknown, program: string): Promise<unknown> {
  const jq = await getJq();
  return jq.json(payload, program);
}

/** Result of a best-effort jq validation/preview run. */
export type JqValidationResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/**
 * Compile and run `program` against `sample`, returning the transformed output
 * or a human-readable error message. Never throws.
 */
export async function validateJq(program: string, sample: unknown): Promise<JqValidationResult> {
  if (typeof program !== 'string' || program.trim() === '') {
    return { ok: false, error: 'jq program is empty' };
  }
  try {
    const result = await applyJq(sample, program);
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
