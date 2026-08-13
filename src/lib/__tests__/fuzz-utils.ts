/**
 * fuzz-utils.ts
 *
 * Shared fuzzing utilities for tests:
 *   - Seeded PRNG (mulberry32) for deterministic randomness
 *   - Fuzz generators for common input types (lat, lng, radius, etc.)
 *   - Validators for fuzz test invariants
 *
 * Using a seeded PRNG means tests are deterministic and reproducible.
 * Change the seed to explore different random combinations, or remove the
 * setSeed() call to get different values on each run.
 */

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────────

/** Current seed value — mutated by each call to seededRandom(). */
export let seed = 42

/** Reset the PRNG to a specific seed. */
export function setSeed(newSeed: number): void {
  seed = newSeed
}

/** Generate a pseudo-random float in [0, 1) using the mulberry32 algorithm. */
export function seededRandom(): number {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** Generate a pseudo-random float in [min, max). */
export function randFloat(min: number, max: number): number {
  return seededRandom() * (max - min) + min
}

/** Generate a pseudo-random integer in [min, max] (inclusive). */
export function randInt(min: number, max: number): number {
  return Math.floor(seededRandom() * (max - min + 1)) + min
}

/** Pick a random element from an array. */
export function pick<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)]
}

// ── Fuzz generators ────────────────────────────────────────────────────────

/** Generate a random latitude (-90 to 90). */
export function fuzzLat(): number {
  return randFloat(-90, 90)
}

/** Generate a random longitude (-180 to 180). */
export function fuzzLng(): number {
  return randFloat(-180, 180)
}

/** Generate a random radius in km (0 to 200, biased toward typical values). */
export function fuzzRadius(): number {
  const r = seededRandom()
  if (r < 0.3) return randFloat(0, 5) // 30%: very local (0–5 km)
  if (r < 0.6) return randFloat(5, 50) // 30%: city-level (5–50 km)
  if (r < 0.9) return randFloat(50, 200) // 30%: regional (50–200 km)
  // 10%: edge cases
  return pick([0, -1, Infinity, -Infinity, NaN])
}

/** Generate an array of 0–5 random category IDs. */
export function fuzzCategoryIds(maxCategories = 5): string[] {
  const count = randInt(0, maxCategories)
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    ids.push(`cat-${randInt(1, 20)}`)
  }
  return [...new Set(ids)] // deduplicate
}

/** Generate a random search query. */
export function fuzzQuery(): string {
  const queries = [
    "",
    "a",
    "encanador",
    "elétrica",
    "Limpeza Residencial",
    "MARIA",
    "são paulo",
    "123",
    "  espaços  ",
    "caractères spéci@ux!",
    "x".repeat(100),
  ]
  return pick(queries)
}

/**
 * Result of a cache key validation.
 */
export type CacheKeyValidation = {
  pass: boolean
  reason?: string
}

/** Validate that a cache key is well-formed. */
export function validateCacheKey(key: string, _lat?: number, _lng?: number): CacheKeyValidation {
  if (!key || typeof key !== "string") {
    return { pass: false, reason: "key is not a string" }
  }
  if (key.length > 512) {
    return { pass: false, reason: `key length ${key.length} exceeds 512` }
  }
  // Redis is binary-safe — accept any character.
  return { pass: true }
}

// ── Radius expansion fuzz generators ──────────────────────────────────────

const EXPANSION_STEPS = [5, 10, 25, 50, 100] as const

/** Generate a random radius value for fuzzing buildRadiiToTry. */
export function fuzzRadiusValue(): number {
  const r = seededRandom()
  if (r < 0.01) return NaN
  if (r < 0.02) return Infinity
  if (r < 0.03) return -Infinity
  if (r < 0.04) return Number.MIN_VALUE
  if (r < 0.05) return Number.MAX_VALUE
  if (r < 0.1) return 0
  if (r < 0.15) return -randFloat(0.1, 100) // negative
  if (r < 0.25) return pick([...EXPANSION_STEPS]) // exactly on a step
  if (r < 0.4) return pick([...EXPANSION_STEPS]) + randFloat(0.01, 2) // just above a step
  if (r < 0.55) return Math.max(0, pick([...EXPANSION_STEPS]) - randFloat(0.01, 2)) // just below a step
  return randFloat(0, 500) // completely random
}

/** Validate that a radii array satisfies all invariants for buildRadiiToTry. */
export function validateRadii(
  userRadiusKm: number,
  radii: number[],
): { pass: boolean; reason?: string } {
  // Invariant 1: radii[0] must be userRadiusKm
  if (radii.length === 0) return { pass: false, reason: "empty array" }
  if (!Object.is(radii[0], userRadiusKm) && !(isNaN(radii[0]) && isNaN(userRadiusKm))) {
    return { pass: false, reason: `radii[0] (${radii[0]}) !== userRadiusKm (${userRadiusKm})` }
  }

  // Invariant 2: must be monotonically increasing
  for (let i = 1; i < radii.length; i++) {
    if (!(radii[i] > radii[i - 1])) {
      if (isNaN(radii[i]) || isNaN(radii[i - 1])) continue // NaN comparisons always false
      return {
        pass: false,
        reason: `radii[${i}] (${radii[i]}) <= radii[${i - 1}] (${radii[i - 1]})`,
      }
    }
  }

  // Invariant 3: each entry is either userRadiusKm or an EXPANSION_STEP
  for (let i = 1; i < radii.length; i++) {
    if (!EXPANSION_STEPS.includes(radii[i] as (typeof EXPANSION_STEPS)[number])) {
      return {
        pass: false,
        reason: `radii[${i}] (${radii[i]}) is not an EXPANSION_STEP`,
      }
    }
  }

  // Invariant 4: no duplicate expansion steps
  const steps = radii.slice(1)
  const uniqueSteps = new Set(steps)
  if (uniqueSteps.size !== steps.length) {
    return { pass: false, reason: "duplicate expansion steps" }
  }

  return { pass: true }
}

// ── Fuzzy string matching (for search fuzz tests) ─────────────────────────

export function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) qi++
  }
  return qi === lowerQuery.length
}

export function fuzzyScore(text: string, query: string): number {
  if (!query) return 1
  if (!fuzzyMatch(text, query)) return 0
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let score = 0
  let prevMatch = false
  let qi = 0
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      score += prevMatch ? 2 : 1
      prevMatch = true
      qi++
    } else {
      prevMatch = false
    }
  }
  return score / (lowerQuery.length * 2)
}

export function findBestMatch<T extends string>(
  items: T[],
  query: string,
  minScore = 0.3,
): { item: T; score: number } | null {
  let best: { item: T; score: number } | null = null
  for (const item of items) {
    const score = fuzzyScore(item, query)
    if (score >= minScore && (!best || score > best.score)) {
      best = { item, score }
    }
  }
  return best
}
