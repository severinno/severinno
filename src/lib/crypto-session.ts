/**
 * Shared session HMAC utilities — works in both Edge Runtime and Node.js.
 *
 * Edge Runtime: uses Web Crypto API (crypto.subtle)
 * Node.js:      uses Node's built-in `crypto` module
 *
 * Detects the runtime at call time so the same module serves both
 * `src/lib/auth.ts` (Node) and `src/middleware.ts` (Edge).
 */

const COOKIE_NAME = "severinno_session" as const
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days
const ROTATION_THRESHOLD_SECONDS = COOKIE_MAX_AGE_SECONDS / 2 // 15 days

/** Cookie format: `${userId}.${role}.${expiresAt}.${signatureHex}` */
const PARTS_COUNT = 4

export type SessionRole = "CLIENT" | "PROVIDER" | "ADMIN"

export type SessionPayload = {
  userId: string
  role: SessionRole
}

export const SESSION_COOKIE_NAME = COOKIE_NAME
export const SESSION_MAX_AGE = COOKIE_MAX_AGE_SECONDS
export const ROTATION_THRESHOLD = ROTATION_THRESHOLD_SECONDS

// ---------------------------------------------------------------------------
// Node.js helpers (crypto built-in)
// ---------------------------------------------------------------------------
function getNodeSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error("SESSION_SECRET environment variable is not set")
  return secret
}

let _nodeHmac: ((payload: string) => string) | null = null

function nodeSign(payload: string): string {
  if (!_nodeHmac) {
    // Lazy-load Node crypto only when running on Node
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createHmac } = require("crypto")
    _nodeHmac = (p: string) => createHmac("sha256", getNodeSecret()).update(p).digest("hex")
  }
  return _nodeHmac(payload)
}

// ---------------------------------------------------------------------------
// Edge helpers (Web Crypto API)
// ---------------------------------------------------------------------------
let _edgeKey: CryptoKey | null = null

async function getEdgeKey(): Promise<CryptoKey> {
  if (!_edgeKey) {
    const encoder = new TextEncoder()
    const secret = process.env.SESSION_SECRET
    if (!secret) throw new Error("SESSION_SECRET environment variable is not set")
    _edgeKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
  }
  return _edgeKey
}

async function edgeSign(payload: string): Promise<string> {
  const key = await getEdgeKey()
  const encoder = new TextEncoder()
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// ---------------------------------------------------------------------------
// Runtime detection — sign is either sync (Node) or async (Edge)
// ---------------------------------------------------------------------------
const isEdgeRuntime = typeof crypto !== "undefined" && "subtle" in crypto

/**
 * Sign a payload string with HMAC-SHA256.
 * Returns a Promise<string> for convenience (resolves synchronously on Node).
 */
export async function signPayload(payload: string): Promise<string> {
  if (isEdgeRuntime) {
    return edgeSign(payload)
  }
  return nodeSign(payload)
}

/**
 * Build a full session cookie value: `userId.role.expiresAt.signature`
 */
export function buildCookieValue(
  userId: string,
  role: SessionRole,
  expiresAt: number,
  signature: string,
): string {
  return `${userId}.${role}.${expiresAt}.${signature}`
}

/**
 * Parse a cookie value into its parts. Returns null on malformed input.
 */
export function parseCookieValue(
  cookieValue: string,
): { userId: string; role: string; expiresAt: number; signature: string } | null {
  const parts = cookieValue.split(".")
  if (parts.length !== PARTS_COUNT) return null
  const [userId, role, expiresAtStr, signature] = parts
  if (!userId || !role || !expiresAtStr || !signature) return null

  const expiresAt = Number(expiresAtStr)
  if (!Number.isFinite(expiresAt)) return null

  return { userId, role, expiresAt, signature }
}

/**
 * Constant-time compare of two hex strings.
 * Works in both Edge and Node runtimes.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
