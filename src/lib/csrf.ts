/**
 * csrf.ts
 *
 * CSRF token generation and verification using HMAC-SHA-256 (Web Crypto API).
 * Compatible with Edge Runtime (middleware) and Node.js (API routes).
 *
 * Strategy: Double-submit cookie pattern.
 *   1. On GET requests to sensitive routes, middleware sets a `csrf_token` cookie
 *      containing a random nonce signed with HMAC.
 *   2. On POST/PUT/PATCH/DELETE to sensitive routes, middleware verifies that
 *      the `X-CSRF-Token` header matches the cookie value.
 *
 * The token is a signed random nonce — no server-side state needed.
 */

const CSRF_COOKIE = "csrf_token"
const CSRF_HEADER = "x-csrf-token"
const TOKEN_LENGTH = 32
const MAX_AGE = 60 * 60 // 1 hour

/**
 * Generate a new CSRF token (random nonce signed with HMAC).
 */
export async function generateCsrfToken(secret: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH))
  const nonceHex = Array.from(nonce)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(nonceHex))
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  return `${nonceHex}.${sigHex}`
}

/**
 * Verify a CSRF token matches the signed nonce.
 */
export async function verifyCsrfToken(token: string, secret: string): Promise<boolean> {
  const dotIdx = token.indexOf(".")
  if (dotIdx === -1) return false

  const nonceHex = token.slice(0, dotIdx)
  const providedSig = token.slice(dotIdx + 1)

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(nonceHex))
  const expectedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  // Constant-time comparison
  const expectedBytes = encoder.encode(expectedSig)
  const providedBytes = encoder.encode(providedSig)
  if (expectedBytes.byteLength !== providedBytes.byteLength) return false
  let diff = 0
  for (let i = 0; i < expectedBytes.byteLength; i++) {
    diff |= expectedBytes[i] ^ providedBytes[i]
  }
  return diff === 0
}

export { CSRF_COOKIE, CSRF_HEADER, MAX_AGE }

/**
 * Read CSRF token from cookie (client-side only).
 * Used by api.ts to attach the X-CSRF-Token header on mutations.
 */
export function getCsrfTokenFromCookie(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.split("; ").find((c) => c.startsWith(CSRF_COOKIE + "="))
  return match ? match.split("=")[1] : null
}
