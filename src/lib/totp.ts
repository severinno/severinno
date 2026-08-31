/**
 * TOTP (Time-based One-Time Password) implementation for 2FA.
 * RFC 6238 compliant — compatible with Google Authenticator, Authy, etc.
 *
 * Uses Node.js crypto (HMAC-SHA1) — no external dependencies needed.
 */

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto"

const DIGITS = 6
const PERIOD = 30 // seconds
const ALGORITHM = "sha1"

// ---------------------------------------------------------------------------
// Base32 encoding/decoding (RFC 4648)
// ---------------------------------------------------------------------------

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function base32Encode(buffer: Buffer): string {
  let bits = ""
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0")
  }
  let result = ""
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0")
    result += BASE32_CHARS[parseInt(chunk, 2)]
  }
  return result
}

function base32Decode(str: string): Buffer {
  const cleaned = str.replace(/[=\s]/g, "").toUpperCase()
  let bits = ""
  for (const char of cleaned) {
    const val = BASE32_CHARS.indexOf(char)
    if (val === -1) throw new Error("Invalid base32 character")
    bits += val.toString(2).padStart(5, "0")
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2)
  }
  return Buffer.from(bytes)
}

// ---------------------------------------------------------------------------
// TOTP generation and verification
// ---------------------------------------------------------------------------

/**
 * Generate a random TOTP secret (160 bits = 20 bytes).
 * Returns the secret in base32 encoding.
 */
export function generateSecret(): string {
  const buffer = randomBytes(20)
  return base32Encode(buffer)
}

/**
 * Generate a TOTP code for a given time.
 * @param secret - Base32-encoded secret
 * @param time - Unix timestamp in seconds (defaults to now)
 * @returns 6-digit TOTP code
 */
export function generateTOTP(secret: string, time?: number): string {
  const timeBytes = Buffer.alloc(8)
  const timeValue = Math.floor((time ?? Date.now() / 1000) / PERIOD)
  timeBytes.writeBigInt64BE(BigInt(timeValue))

  const key = base32Decode(secret)
  const hmac = createHmac(ALGORITHM, key).update(timeBytes).digest()

  const offset = hmac[hmac.length - 1] & 0x0f
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return String(code % 10 ** DIGITS).padStart(DIGITS, "0")
}

/**
 * Verify a TOTP code against a secret.
 * Checks the current time window and adjacent windows (±1) for clock drift.
 * @param secret - Base32-encoded secret
 * @param token - 6-digit code to verify
 * @returns true if the code is valid
 */
export function verifyTOTP(secret: string, token: string): boolean {
  if (!/^\d{6}$/.test(token)) return false

  const now = Math.floor(Date.now() / 1000)

  // Check current window and ±1 for clock drift tolerance
  for (const offset of [-1, 0, 1]) {
    const expected = generateTOTP(secret, now + offset * PERIOD)
    const a = Buffer.from(token, "utf8")
    const b = Buffer.from(expected, "utf8")
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// TOTP URI generation (for QR code)
// ---------------------------------------------------------------------------

/**
 * Generate a TOTP URI for QR code scanning.
 * Format: otpauth://totp/{issuer}:{email}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30
 */
export function generateTOTPUri(secret: string, email: string, issuer = "Severinno"): string {
  const encodedIssuer = encodeURIComponent(issuer)
  const encodedEmail = encodeURIComponent(email)
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD}`
}

// ---------------------------------------------------------------------------
// Backup codes generation and verification
// ---------------------------------------------------------------------------

const BACKUP_CODE_LENGTH = 8
const BACKUP_CODE_COUNT = 8

/**
 * Generate backup codes (plain text for display, must be hashed before storage).
 * @returns Array of 8-digit backup codes
 */
export function generateBackupCodes(): string[] {
  const codes: string[] = []
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const bytes = randomBytes(4)
    const code = String(bytes.readUInt32BE(0) % 10 ** BACKUP_CODE_LENGTH).padStart(
      BACKUP_CODE_LENGTH,
      "0",
    )
    codes.push(code)
  }
  return codes
}

/**
 * Hash a backup code for storage using scrypt.
 */
export function hashBackupCode(code: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(code, salt, 32, { N: 16384, r: 8, p: 1 })
  return `${salt.toString("hex")}:${hash.toString("hex")}`
}

/**
 * Verify a backup code against a stored hash.
 */
export function verifyBackupCode(code: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":")
  if (!saltHex || !hashHex) return false

  const salt = Buffer.from(saltHex, "hex")
  const hash = Buffer.from(hashHex, "hex")
  const computed = scryptSync(code, salt, hash.length, { N: 16384, r: 8, p: 1 })

  if (computed.length !== hash.length) return false
  return timingSafeEqual(computed, hash)
}

/**
 * Hash multiple backup codes for storage.
 */
export function hashBackupCodes(codes: string[]): string {
  return JSON.stringify(codes.map(hashBackupCode))
}

/**
 * Verify a backup code against a JSON array of stored hashes.
 * Returns the updated array (with the used code removed) or null if invalid.
 */
export function verifyBackupCodeFromStore(
  code: string,
  storedJson: string,
): { valid: boolean; updatedCodes: string } {
  try {
    const hashes: string[] = JSON.parse(storedJson)
    for (let i = 0; i < hashes.length; i++) {
      if (verifyBackupCode(code, hashes[i])) {
        // Remove the used code
        hashes.splice(i, 1)
        return { valid: true, updatedCodes: JSON.stringify(hashes) }
      }
    }
    return { valid: false, updatedCodes: storedJson }
  } catch {
    return { valid: false, updatedCodes: storedJson }
  }
}
