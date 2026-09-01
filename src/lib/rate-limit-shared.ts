/**
 * rate-limit-shared.ts
 *
 * Shared utilities for rate limiting — extracted from global-rate-limit.ts
 * and route-rate-limit.ts to eliminate code duplication.
 *
 * Handles IP extraction with proxy-aware validation.
 */

// Trusted proxy IPs (Caddy, Cloudflare). In production, only these IPs
// can set x-forwarded-for / x-real-ip headers reliably.
const TRUSTED_PROXIES = new Set(
  (process.env.TRUSTED_PROXY_IPS ?? "127.0.0.1,::1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

/**
 * Extract client IP from request headers.
 * In production, only trusts x-forwarded-for from known reverse proxies.
 * Falls back to user-agent fingerprint for anonymous clients.
 */
export function getClientIp(request: Request): string {
  const isProd = process.env.NODE_ENV === "production"

  // In production, validate that the request comes from a trusted proxy
  // before trusting x-forwarded-for (prevents IP spoofing)
  if (isProd) {
    const forwarded = request.headers.get("x-forwarded-for")
    if (forwarded) {
      // Only trust if connecting IP is from a known proxy
      const connectingIp =
        request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip") ?? ""
      if (TRUSTED_PROXIES.has(connectingIp)) {
        const ip = forwarded.split(",")[0]?.trim()
        if (ip) return ip
      }
    }
  } else {
    // Dev: trust headers freely
    const forwarded = request.headers.get("x-forwarded-for")
    if (forwarded) {
      const ip = forwarded.split(",")[0]?.trim()
      if (ip) return ip
    }
  }

  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp

  const cfIp = request.headers.get("cf-connecting-ip")
  if (cfIp) return cfIp

  // Fallback: anonymous fingerprint based on user-agent
  const ua = request.headers.get("user-agent") ?? ""
  const accept = request.headers.get("accept") ?? ""
  return `anon-${simpleHash(`${ua}:${accept}`)}`
}

/**
 * Simple DJB2 hash — fast, non-cryptographic, good enough for rate-limit keys.
 */
export function simpleHash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash.toString(36)
}

/**
 * Build a composite fingerprint for rate limiting.
 * Combines IP + user-agent hash for more accurate per-user limits.
 */
export function getCompositeFingerprint(request: Request): string {
  const ip = getClientIp(request)
  const ua = request.headers.get("user-agent") ?? ""
  const accept = request.headers.get("accept") ?? ""
  return `${ip}:${simpleHash(`${ua}:${accept}`)}`
}
