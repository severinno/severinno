/**
 * fuzz-utils.ts
 *
 * Shared helpers for fuzz testing — seeded PRNG, generic random generators,
 * and reusable fuzz-input/value functions extracted from individual fuzz
 * test files so they can be shared across the test suite.
 *
 * Each fuzz test file sets `seed = 42` in `beforeEach` or at the start of
 * its main fuzz loop to ensure reproducible sequences.
 *
 * @example
 * ```ts
 * import { seededRandom, randFloat, randInt, pick } from "./fuzz-utils"
 * ```
 */

// ---------------------------------------------------------------------------
// Seeded PRNG (Lehmer / Park-Miller)
// ---------------------------------------------------------------------------

/**
 * Global seed for the Lehmer PRNG.
 *
 * Each fuzz test file resets this to 42 at the beginning of its main
 * fuzz loop to ensure reproducible sequences across runs.
 *
 * The PRNG generates values in [0, 1).
 */
export let seed = 42

/** Reset the PRNG seed (call at the start of each fuzz loop). */
export function setSeed(s: number): void {
  seed = s
}

/** Seedable PRNG using the Lehmer / Park-Miller algorithm. */
export function seededRandom(): number {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** Generate a random float in [min, max]. */
export function randFloat(min: number, max: number): number {
  return min + seededRandom() * (max - min)
}

/** Generate a random integer in [min, max] (inclusive). */
export function randInt(min: number, max: number): number {
  return Math.floor(seededRandom() * (max - min + 1)) + min
}

/** Pick a random element from a non-empty array. */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)]
}

// ---------------------------------------------------------------------------
// Lat/lng helpers
// ---------------------------------------------------------------------------

/** Generate a random latitude biased toward edge cases. */
export function fuzzLat(): number {
  const r = seededRandom()
  if (r < 0.05) return 0          // equator
  if (r < 0.10) return 90         // north pole
  if (r < 0.15) return -90        // south pole
  if (r < 0.17) return NaN
  if (r < 0.18) return Infinity
  if (r < 0.19) return -Infinity
  return randFloat(-90, 90)
}

/** Generate a random longitude biased toward edge cases. */
export function fuzzLng(): number {
  const r = seededRandom()
  if (r < 0.05) return 0          // prime meridian
  if (r < 0.10) return 180        // date line
  if (r < 0.15) return -180       // date line (west)
  if (r < 0.17) return NaN
  if (r < 0.18) return Infinity
  if (r < 0.19) return -Infinity
  return randFloat(-180, 180)
}

/**
 * Generate a random radius (km) biased toward edge cases.
 * Covers: 0, negative, very large, fractional, NaN, Infinity.
 */
export function fuzzRadius(): number {
  const r = seededRandom()
  if (r < 0.05) return 0
  if (r < 0.10) return -1
  if (r < 0.12) return -1000
  if (r < 0.14) return 1_000_000
  if (r < 0.16) return NaN
  if (r < 0.17) return Infinity
  if (r < 0.18) return -Infinity
  if (r < 0.30) return seededRandom() * 200
  return Math.round(seededRandom() * 500)
}

// ---------------------------------------------------------------------------
// Category-IDs generator
// ---------------------------------------------------------------------------

/** Generate a random categoryIds array biased toward edge cases. */
export function fuzzCategoryIds(): string[] | undefined {
  const r = seededRandom()
  if (r < 0.10) return undefined
  if (r < 0.20) return []
  if (r < 0.30) return [""]
  if (r < 0.40) return ["cat-a"]
  if (r < 0.50) return ["cat-z", "cat-a"]
  if (r < 0.60) return ["a", "b", "c", "d"]
  if (r < 0.65) return ["", "cat-a", ""]
  // Random IDs
  const count = randInt(1, 10)
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789-"
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    let id = ""
    const len = randInt(1, 16)
    for (let j = 0; j < len; j++) id += chars[Math.floor(seededRandom() * chars.length)]
    ids.push(id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Search-query generator
// ---------------------------------------------------------------------------

/** Generate a random search query biased toward edge cases. */
export function fuzzQuery(): string | undefined {
  const r = seededRandom()
  if (r < 0.10) return undefined
  if (r < 0.20) return ""
  if (r < 0.25) return "   "
  if (r < 0.35) return "eletricista"
  if (r < 0.45) return "são paulo"
  if (r < 0.50) return "   encanador   "
  if (r < 0.55) return "a".repeat(200)
  if (r < 0.60) return "<script>alert(1)</script>"
  if (r < 0.65) return "' OR 1=1 --"
  if (r < 0.70) return "😀🎉🏠"
  if (r < 0.75) return "東京"
  if (r < 0.80) return "a b c d e f g h i j"
  // Random string
  const len = randInt(1, 50)
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789 -_."
  let result = ""
  for (let i = 0; i < len; i++) result += chars[Math.floor(seededRandom() * chars.length)]
  return result
}

// ---------------------------------------------------------------------------
// Validate cache-key invariants
// ---------------------------------------------------------------------------

/**
 * Validate invariants for a cache key produced by radiusCountCacheKey.
 *
 *   Invariant 1: key starts with "providers:count:"
 *   Invariant 2: finite lat/lng appear formatted to 3 decimal places
 *
 * @returns `{ pass: true }` or `{ pass: false, reason }`.
 */
export function validateCacheKey(
  key: string,
  lat: unknown,
  lng: unknown,
): { pass: boolean; reason?: string } {
  if (!key.startsWith("providers:count:")) {
    return { pass: false, reason: `key "${key}" does not start with "providers:count:"` }
  }

  if (typeof lat === "number" && Number.isFinite(lat)) {
    const expected = (lat as number).toFixed(3)
    if (!key.includes(expected)) {
      return { pass: false, reason: `key "${key}" missing lat "${expected}" (input ${lat})` }
    }
  }

  if (typeof lng === "number" && Number.isFinite(lng)) {
    const expected = (lng as number).toFixed(3)
    if (!key.includes(expected)) {
      return { pass: false, reason: `key "${key}" missing lng "${expected}" (input ${lng})` }
    }
  }

  return { pass: true }
}

// ---------------------------------------------------------------------------
// Radius expansion helpers (depend on EXPANSION_STEPS)
// ---------------------------------------------------------------------------

import { EXPANSION_STEPS } from "../radius-expansion"

const MAX_EXPECTED_RADII = EXPANSION_STEPS.length + 1

/**
 * Generate a fuzz input value for userRadiusKm, biased toward edge cases.
 * Covers: negative, zero, exactly-on-step, between-steps, below-first-step,
 * above-max-step, and uniform random across [-1000, 1000].
 */
export function fuzzRadiusValue(): number {
  const r = seededRandom()

  // 10%: negative
  if (r < 0.10) {
    const neg = seededRandom()
    if (neg < 0.30) return -seededRandom() * 1e6
    if (neg < 0.60) return -seededRandom() * 1000
    return -seededRandom() * 10
  }

  if (r < 0.20) return 0

  // 10%: exactly on an expansion step
  if (r < 0.30) return EXPANSION_STEPS[randInt(0, EXPANSION_STEPS.length - 1)]

  // 10%: between steps (fractional)
  if (r < 0.40) {
    const step = EXPANSION_STEPS[randInt(0, EXPANSION_STEPS.length - 2)]
    const nextStep = EXPANSION_STEPS[EXPANSION_STEPS.indexOf(step) + 1]
    return step + seededRandom() * (nextStep - step)
  }

  // 10%: small positive below first step
  if (r < 0.50) return seededRandom() * 5

  // 10%: above max step
  if (r < 0.60) {
    const above = seededRandom()
    if (above < 0.30) return 100 + seededRandom() * 1e6
    if (above < 0.60) return 100 + seededRandom() * 1000
    return 100 + seededRandom() * 500
  }

  // 40%: uniform random across [-1000, 1000]
  return seededRandom() * 2000 - 1000
}

/**
 * Validate the three invariants for buildRadiiToTry output:
 *   1. radii[0] === userRadiusKm
 *   2. radii[i] > radii[i-1]  (monotonically increasing)
 *   3. ∀ r ∈ radii, r === userRadiusKm ∨ r ∈ EXPANSION_STEPS
 *   4. No duplicate expansion steps (apart from user radius at index 0)
 *
 * @returns `{ pass: true }` or `{ pass: false, reason }`.
 */
export function validateRadii(
  userRadiusKm: number,
  radii: number[],
): { pass: boolean; reason?: string } {
  if (radii[0] !== userRadiusKm) {
    return { pass: false, reason: "radii[0] !== userRadiusKm" }
  }

  if (radii.length > MAX_EXPECTED_RADII) {
    return {
      pass: false,
      reason: `length ${radii.length} exceeds max ${MAX_EXPECTED_RADII}`,
    }
  }

  for (let i = 1; i < radii.length; i++) {
    if (radii[i] <= radii[i - 1]) {
      return {
        pass: false,
        reason: `not monotonic at index ${i}: ${radii[i - 1]} >= ${radii[i]}`,
      }
    }
  }

  const stepSet = new Set(EXPANSION_STEPS)
  for (let i = 0; i < radii.length; i++) {
    const v = radii[i]
    if (v === userRadiusKm) continue
    if (!stepSet.has(v)) {
      return {
        pass: false,
        reason: `value ${v} at index ${i} is neither userRadius (${userRadiusKm}) nor an expansion step [${EXPANSION_STEPS}]`,
      }
    }
    if (i > 0 && v === userRadiusKm) {
      return { pass: false, reason: `duplicate user radius ${v} at index ${i}` }
    }
  }

  return { pass: true }
}
