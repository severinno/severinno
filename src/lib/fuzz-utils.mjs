/**
 * fuzz-utils.mjs — ESM shim for src/lib/fuzz-utils.ts
 *
 * This file exists so that standalone Node.js scripts (like
 * scripts/run-all-fuzz.mjs) can import the shared fuzz utilities
 * without a TypeScript build step.
 *
 * SOURCE: src/lib/fuzz-utils.ts — keep both files in sync.
 */

// ---------------------------------------------------------------------------
// Seeded PRNG (Lehmer / Park-Miller)
// ---------------------------------------------------------------------------

/** Global seed for the Lehmer PRNG. */
export let seed = 42

/** Reset the PRNG seed (call at the start of each fuzz loop). */
export function setSeed(s) {
  seed = s
}

/** Seedable PRNG using the Lehmer / Park-Miller algorithm. */
export function seededRandom() {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/** Generate a random float in [min, max]. */
export function randFloat(min, max) {
  return min + seededRandom() * (max - min)
}

/** Generate a random integer in [min, max] (inclusive). */
export function randInt(min, max) {
  return Math.floor(seededRandom() * (max - min + 1)) + min
}

/** Pick a random element from a non-empty array. */
export function pick(arr) {
  return arr[Math.floor(seededRandom() * arr.length)]
}

// ---------------------------------------------------------------------------
// Lat/lng helpers
// ---------------------------------------------------------------------------

/** Generate a random latitude biased toward edge cases. */
export function fuzzLat() {
  const r = seededRandom()
  if (r < 0.05) return 0
  if (r < 0.1) return 90
  if (r < 0.15) return -90
  if (r < 0.17) return NaN
  if (r < 0.18) return Infinity
  if (r < 0.19) return -Infinity
  return randFloat(-90, 90)
}

/** Generate a random longitude biased toward edge cases. */
export function fuzzLng() {
  const r = seededRandom()
  if (r < 0.05) return 0
  if (r < 0.1) return 180
  if (r < 0.15) return -180
  if (r < 0.17) return NaN
  if (r < 0.18) return Infinity
  if (r < 0.19) return -Infinity
  return randFloat(-180, 180)
}

/** Generate a random radius (km) biased toward edge cases. */
export function fuzzRadius() {
  const r = seededRandom()
  if (r < 0.05) return 0
  if (r < 0.1) return -1
  if (r < 0.12) return -1000
  if (r < 0.14) return 1_000_000
  if (r < 0.16) return NaN
  if (r < 0.17) return Infinity
  if (r < 0.18) return -Infinity
  if (r < 0.3) return seededRandom() * 200
  return Math.round(seededRandom() * 500)
}

// ---------------------------------------------------------------------------
// Category-IDs generator
// ---------------------------------------------------------------------------

/** Generate a random categoryIds array biased toward edge cases. */
export function fuzzCategoryIds() {
  const r = seededRandom()
  if (r < 0.1) return undefined
  if (r < 0.2) return []
  if (r < 0.3) return [""]
  if (r < 0.4) return ["cat-a"]
  if (r < 0.5) return ["cat-z", "cat-a"]
  if (r < 0.6) return ["a", "b", "c", "d"]
  if (r < 0.65) return ["", "cat-a", ""]
  const count = randInt(1, 10)
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789-"
  const ids = []
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
export function fuzzQuery() {
  const r = seededRandom()
  if (r < 0.1) return undefined
  if (r < 0.2) return ""
  if (r < 0.25) return "   "
  if (r < 0.35) return "eletricista"
  if (r < 0.45) return "são paulo"
  if (r < 0.5) return "   encanador   "
  if (r < 0.55) return "a".repeat(200)
  if (r < 0.6) return "<script>alert(1)</script>"
  if (r < 0.65) return "' OR 1=1 --"
  if (r < 0.7) return "\u{1F600}\u{1F389}\u{1F3E0}"
  if (r < 0.75) return "東京"
  if (r < 0.8) return "a b c d e f g h i j"
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
 * Validate that a cache key is well-formed.
 * Kept in sync with the lenient validator in src/lib/__tests__/fuzz-utils.ts:
 * the key format itself (geohash-7 cells, normalized query) is asserted by
 * the unit tests in src/lib/__tests__/radius-expansion.test.ts.
 */
export function validateCacheKey(key, _lat, _lng) {
  if (!key || typeof key !== "string") {
    return { pass: false, reason: "key is not a string" }
  }
  if (key.length > 512) {
    return { pass: false, reason: `key length ${key.length} exceeds 512` }
  }
  // Redis is binary-safe — accept any character.
  return { pass: true }
}

// ---------------------------------------------------------------------------
// Radius expansion helpers (self-contained clone of EXPANSION_STEPS)
//
// ⚠ EXPANSION_STEPS_FUZZ must match EXPANSION_STEPS in
//    src/lib/radius-expansion.ts.  If you update one, update the other.
// ---------------------------------------------------------------------------

/** Expansion steps used by fuzzRadiusValue and validateRadii. */
export const EXPANSION_STEPS_FUZZ = [5, 10, 25, 50, 100]

const MAX_EXPECTED_RADII = EXPANSION_STEPS_FUZZ.length + 1

/** Generate a fuzz input value for userRadiusKm, biased toward edge cases. */
export function fuzzRadiusValue() {
  const r = seededRandom()
  if (r < 0.1) {
    const neg = seededRandom()
    if (neg < 0.3) return -seededRandom() * 1e6
    if (neg < 0.6) return -seededRandom() * 1000
    return -seededRandom() * 10
  }
  if (r < 0.2) return 0
  if (r < 0.3) return EXPANSION_STEPS_FUZZ[randInt(0, EXPANSION_STEPS_FUZZ.length - 1)]
  if (r < 0.4) {
    const step = EXPANSION_STEPS_FUZZ[randInt(0, EXPANSION_STEPS_FUZZ.length - 2)]
    const nextStep = EXPANSION_STEPS_FUZZ[EXPANSION_STEPS_FUZZ.indexOf(step) + 1]
    return step + seededRandom() * (nextStep - step)
  }
  if (r < 0.5) return seededRandom() * 5
  if (r < 0.6) {
    const above = seededRandom()
    if (above < 0.3) return 100 + seededRandom() * 1e6
    if (above < 0.6) return 100 + seededRandom() * 1000
    return 100 + seededRandom() * 500
  }
  return seededRandom() * 2000 - 1000
}

/** Validate the three invariants for buildRadiiToTry output. */
export function validateRadii(userRadiusKm, radii) {
  if (radii[0] !== userRadiusKm) {
    return { pass: false, reason: "radii[0] !== userRadiusKm" }
  }
  if (radii.length > MAX_EXPECTED_RADII) {
    return { pass: false, reason: `length ${radii.length} exceeds max ${MAX_EXPECTED_RADII}` }
  }
  for (let i = 1; i < radii.length; i++) {
    if (radii[i] <= radii[i - 1]) {
      return { pass: false, reason: `not monotonic at index ${i}: ${radii[i - 1]} >= ${radii[i]}` }
    }
  }
  const stepSet = new Set(EXPANSION_STEPS_FUZZ)
  for (let i = 0; i < radii.length; i++) {
    const v = radii[i]
    if (v === userRadiusKm) continue
    if (!stepSet.has(v)) {
      return {
        pass: false,
        reason: `value ${v} at index ${i} is neither userRadius (${userRadiusKm}) nor an expansion step [${EXPANSION_STEPS_FUZZ}]`,
      }
    }
    if (i > 0 && v === userRadiusKm) {
      return { pass: false, reason: `duplicate user radius ${v} at index ${i}` }
    }
  }
  return { pass: true }
}
