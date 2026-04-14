/**
 * Minimal debug logger (6.3 — Provide debug mode).
 * Activated by setting DEBUG=fp or DEBUG=fp:* or DEBUG=* in the environment.
 *
 *   DEBUG=fp:* fp install slack
 */
const active = (process.env['DEBUG'] ?? '')
  .split(',')
  .map((s) => s.trim())
  .some((p) => p === 'fp' || p === 'fp:*' || p === '*');

/** Write a debug line to stderr when the DEBUG env var includes `fp`. */
export function debug(tag: string, msg: string): void {
  if (active) process.stderr.write(`[fp:${tag}] ${msg}\n`);
}
