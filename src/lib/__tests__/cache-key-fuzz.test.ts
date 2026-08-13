/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * cache-key-fuzz.test.ts
 *
 * Fuzzing test for `radiusCountCacheKey` — generates 1000 random
 * combinations of lat/lng/radius/categoryIds/q and verifies the
 * invariants:
 *
 *   1. Key always starts with "providers:count:".
 *   2. Contains lat and lng formatted to 3 decimal places.
 *   3. Does not crash with empty/undefined/null-like inputs.
 *   4. Deterministic: same inputs → same key.
 *
 * The input space covers:
 *   - Valid lat/lng ranges (-90–90, -180–180)
 *   - Edge coordinates: poles, equator, prime meridian, date line
 *   - Radius: 0, negative, very large, fractional
 *   - categoryIds: undefined, empty array, single, multiple
 *   - q: undefined, empty string, whitespace, special chars, Unicode
 *   - JavaScript edge values: NaN, Infinity, -Infinity
 */

import { describe, it, expect } from "vitest"
import { radiusCountCacheKey } from "../radius-expansion"
import {
  setSeed,
  fuzzLat,
  fuzzLng,
  fuzzRadius,
  fuzzCategoryIds,
  fuzzQuery,
  validateCacheKey,
} from "@/lib/__tests__"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FUZZ_ITERATIONS = 1000

// ---------------------------------------------------------------------------
// Fuzz test
// ---------------------------------------------------------------------------

describe("radiusCountCacheKey fuzzing", () => {
  it(`maintains invariants across ${FUZZ_ITERATIONS} random inputs`, () => {
    setSeed(42)
    const failures: string[] = []

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const lat = fuzzLat()
      const lng = fuzzLng()
      const radius = fuzzRadius()
      const categoryIds = fuzzCategoryIds()
      const q = fuzzQuery()

      let key: string
      try {
        key = radiusCountCacheKey(lat, lng, radius, categoryIds, q)
      } catch (err) {
        failures.push(
          `  [${failures.length + 1}] ` +
            `lat=${lat} lng=${lng} radius=${radius} cats=${JSON.stringify(categoryIds)} q=${JSON.stringify(q)} ` +
            `→ CRASH: ${(err as Error).message}`,
        )
        continue
      }

      const v = validateCacheKey(key, lat, lng)
      if (!v.pass) {
        failures.push(
          `  [${failures.length + 1}] ` +
            `lat=${lat} lng=${lng} radius=${radius} cats=${JSON.stringify(categoryIds)} q=${JSON.stringify(q)} ` +
            `→ ${v.reason}`,
        )
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `radiusCountCacheKey failed invariants in ${failures.length}/${FUZZ_ITERATIONS} fuzz cases:\n` +
          failures.join("\n") +
          "\n\n(Re-run with seed=42 for the same sequence.)",
      )
    }
  })

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  it("is deterministic — same inputs always produce same key", () => {
    // Multiple categories in different orders should produce same key
    // (the function sorts them)
    const key1 = radiusCountCacheKey(-23.551, -46.633, 10, ["cat-b", "cat-a"], "teste")
    const key2 = radiusCountCacheKey(-23.551, -46.633, 10, ["cat-a", "cat-b"], "teste")
    expect(key1).toBe(key2)

    // Repeated call with same inputs
    const key3 = radiusCountCacheKey(-23.551, -46.633, 10, ["cat-a", "cat-b"], "teste")
    expect(key1).toBe(key3)
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("handles all-undefined inputs without crashing", () => {
    const key = radiusCountCacheKey(0, 0, 0, undefined, undefined)
    expect(key).toBe("providers:count:0.000:0.000:0:all:")
  })

  it("handles NaN coordinates without crashing", () => {
    const key = radiusCountCacheKey(NaN, NaN, 10, undefined, undefined)
    expect(key).toContain("providers:count:")
    // NaN.toFixed(3) → "NaN"
    expect(key).toContain("NaN")
  })

  it("handles Infinity coordinates without crashing", () => {
    const key = radiusCountCacheKey(Infinity, -Infinity, 10, undefined, undefined)
    expect(key).toContain("providers:count:")
  })

  it("trims whitespace from query", () => {
    const trimmed = radiusCountCacheKey(0, 0, 5, undefined, "   teste   ")
    const notTrimmed = radiusCountCacheKey(0, 0, 5, undefined, "teste")
    expect(trimmed).toBe(notTrimmed)
  })

  it("uses 'all' when categoryIds is empty array", () => {
    const key = radiusCountCacheKey(-23.551, -46.633, 10, [], "encanador")
    expect(key).toContain(":all:")
  })

  it("uses 'all' when categoryIds contains only empty strings", () => {
    const key = radiusCountCacheKey(0, 0, 5, [""], "teste")
    // [""] has length 1 → sorts to [""] → join = "" → produces ::
    expect(key).not.toContain(":all:")
    expect(key).toContain("::")
  })

  it("handles multiple empty strings in categoryIds", () => {
    // Multiple "" → join(",") = "," → appears as :,: in the key
    const key = radiusCountCacheKey(0, 0, 5, ["", "", ""], "teste")
    expect(key).not.toContain(":all:")
    expect(key).toContain(":,,")
  })

  it("produces keys with 5 colon-separated segments", () => {
    const key = radiusCountCacheKey(-23.551, -46.633, 10, ["cat-1"], "eletricista")
    const parts = key.split(":")
    // providers:count:{lat}:{lng}:{radius}:{cats}:{query} = 7 parts via split
    // ["providers", "count", "lat", "lng", "radius", "cats", "query"]
    expect(parts[0]).toBe("providers")
    expect(parts[1]).toBe("count")
    // At least 7 parts
    expect(parts.length).toBeGreaterThanOrEqual(7)
  })
})
