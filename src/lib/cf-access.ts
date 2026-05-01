/**
 * Cloudflare Access JWT validation utility for freepieces.
 * Validates the `Cf-Access-Jwt-Assertion` header injected by CF Access.
 * Uses the Web Crypto API (available in the Workers runtime, no npm dependencies).
 */

// Module-level JWKS cache — reused across requests within the same isolate.
const jwksCache = new Map<string, CryptoKey[]>()

export interface CfAccessIdentity {
  email: string
  sub: string
  type: string
}

/**
 * Validates the CF Access JWT from the request header.
 * Returns the identity if valid, null if the header is absent or invalid.
 *
 * @param request  - The incoming Request (reads `Cf-Access-Jwt-Assertion` header)
 * @param teamDomain - CF Access team domain, e.g. "yourteam.cloudflareaccess.com"
 * @param audience   - CF Access Application ID (AUD claim)
 */
export async function verifyCfAccessJwt(
  request: Request,
  teamDomain: string,
  audience: string,
): Promise<CfAccessIdentity | null> {
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!jwt) return null

  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  const headerB64 = parts[0] as string
  const payloadB64 = parts[1] as string
  const sigB64 = parts[2] as string

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.includes(audience)) return null

  if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null

  if (payload.iss !== `https://${teamDomain}`) return null

  let keys = jwksCache.get(teamDomain)
  if (!keys) {
    const jwksRes = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
    if (!jwksRes.ok) return null
    const jwks = (await jwksRes.json()) as { keys: JsonWebKey[] }
    keys = await Promise.all(
      jwks.keys.map((k) =>
        crypto.subtle.importKey(
          'jwk',
          k,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      ),
    )
    jwksCache.set(teamDomain, keys)
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(`${headerB64}.${payloadB64}`)
  const sig = Uint8Array.from(
    atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0),
  )

  for (const key of keys) {
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)
    if (valid) {
      return {
        email: String(payload.email ?? ''),
        sub: String(payload.sub ?? ''),
        type: String(payload.type ?? 'app'),
      }
    }
  }
  return null
}
