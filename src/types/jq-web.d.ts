/**
 * Minimal ambient type declarations for the `jq-web` package.
 *
 * `jq-web` ships no TypeScript types. The default export is a thenable that
 * resolves to an object exposing `json` (object in → object out) and `raw`
 * (JSON string in → raw string out) methods backed by a WebAssembly build of
 * jq. See https://github.com/stainless-api/jq-web for the Cloudflare-Workers
 * compatible fork.
 */
declare module 'jq-web' {
  export interface JqWeb {
    /** Run `filter` against `value`, returning the parsed jq output. */
    json(value: unknown, filter: string): unknown;
    /** Run `filter` against a raw JSON string, returning raw stdout. */
    raw(json: string, filter: string, flags?: string[]): string;
  }

  /** Resolves once the WASM module is initialised. */
  const jq: Promise<JqWeb> & Partial<JqWeb>;
  export default jq;
}
