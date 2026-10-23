import { scryptSync, randomBytes, timingSafeEqual, createHash } from "crypto"

/**
 * Hash a high-entropy secret token (such as a password reset token) with SHA-256.
 * Ensures database dumps do not expose usable tokens in cleartext.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

const KEY_LEN = 64
const SALT_LEN = 16
const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1

/**
 * Hash a password using scrypt with a random salt.
 * Returns a string of format `saltHex:hashHex`.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN)
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `${salt.toString("hex")}:${hash.toString("hex")}`
}

/**
 * Verify a password against a `saltHex:hashHex` string.
 * Uses timing-safe comparison to avoid timing attacks.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || typeof stored !== "string") return false
  const [saltHex, hashHex] = stored.split(":")
  if (!saltHex || !hashHex) return false
  try {
    const salt = Buffer.from(saltHex, "hex")
    const hash = Buffer.from(hashHex, "hex")
    const computed = scryptSync(password, salt, hash.length, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
    })
    return timingSafeEqual(computed, hash)
  } catch {
    return false
  }
}

// Pre-computed dummy hash of format saltHex:hashHex for timing-safe dummy verification
const DUMMY_HASH =
  "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"

/**
 * Execute scrypt verification on a dummy hash to equalize response times
 * when an account does not exist, neutralizing email enumeration timing attacks.
 */
export function dummyPasswordVerification(password: string): void {
  verifyPassword(password, DUMMY_HASH)
}
