/**
 * Timing-safe string comparison to prevent timing side-channel attacks on
 * credential checks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let result = a.length ^ b.length;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
