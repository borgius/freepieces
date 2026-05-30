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
    jqPromise = import('jq-web')
      .then(async (mod): Promise<JqWeb> => {
        // The default export is a thenable that resolves to the JqWeb instance.
        const def = (mod as { default?: unknown }).default ?? mod;
        return (await def) as JqWeb;
      })
      .catch((err) => {
        // Reset so a transient load failure can be retried on the next call.
        jqPromise = null;
        throw err;
      });
  }
  return jqPromise;
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
