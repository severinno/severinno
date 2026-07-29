// @ts-nocheck
/**
 * distance-fallback-fuzz.test.ts
 *
 * Fuzzing test for computeDistanceMap — generates 100 random combinations
 * of inputs and verifies the invariant:
 *
 *   result.size === providers.length
 *
 * Edge cases covered by randomization:
 *   - Provider count: 0, 1, and up to 50
 *   - Provider lat/lng: valid coords, null-only, mixed null/valid
 *   - centerGeo: null or random coordinates
 *   - hasGeo: true or false
 *   - PostGIS mock: returns subset of providers, empty set, or throws
 *   - User position: random global coordinates
 */

import { describe, it, expect, vi } from "vitest"
import { computeDistanceMap, type ProviderGeo } from "../distance-fallback"
import { setSeed, seededRandom, seed, randFloat, randInt, pick } from "@/lib/__tests__"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of fuzz iterations to run. */
const FUZZ_ITERATIONS = 100

/** Maximum number of providers per fuzz iteration. */
const MAX_PROVIDERS = 50

/** Generate a random provider count (biased toward edge cases). */
function randomProviderCount(): number {
  const r = seededRandom()
  if (r < 0.1) return 0       // 10%: empty
  if (r < 0.2) return 1       // 10%: single
  return randInt(2, MAX_PROVIDERS)  // 80%: 2–50
}

/**
 * Generate a random lat/lng pair with three possible states:
 *   - both valid (75% chance)
 *   - both null  (15% chance)
 *   - one null, one valid (10% chance — partial null)
 */
function randomLatLng(): { lat: number | null; lng: number | null } {
  const r = seededRandom()
  if (r < 0.75) {
    return {
      lat: randFloat(-90, 90),
      lng: randFloat(-180, 180),
    }
  }
  if (r < 0.9) {
    return { lat: null, lng: null }
  }
  // Partial null: one coordinate null, the other valid
  if (seededRandom() < 0.5) {
    return { lat: null, lng: randFloat(-180, 180) }
  }
  return { lat: randFloat(-90, 90), lng: null }
}

/** Generate a list of providers with random IDs and coordinates. */
function randomProviders(count: number): ProviderGeo[] {
  const providers: ProviderGeo[] = []
  for (let i = 0; i < count; i++) {
    const { lat, lng } = randomLatLng()
    providers.push({ id: `p-${seed}-${i}`, lat, lng })
  }
  return providers
}

/** Build a mock queryRawUnsafe function for the given providers. */
function mockQueryRawForFuzz(
  providers: ProviderGeo[],
  behavior: "success-subset" | "success-empty" | "throw" | "success-all",
) {
  return vi.fn<
    (sql: string, ...params: unknown[]) => Promise<Array<{ id: string; distance_km: number }>>
  >(async () => {
    if (behavior === "throw") {
      throw new Error("Fuzz simulated PostGIS failure")
    }

    if (behavior === "success-empty") {
      return []
    }

    // success-subset or success-all: return distance for some or all providers
    const rows: Array<{ id: string; distance_km: number }> = []
    for (const p of providers) {
      if (p.lat === null || p.lng === null) continue // PostGIS requires location
      if (behavior === "success-subset" && seededRandom() < 0.3) continue // skip 30%
      rows.push({
        id: p.id,
        distance_km: randFloat(0.1, 100),
      })
    }
    return rows
  })
}

/** Run one fuzz iteration and return diagnostics. */
async function runOneFuzz(): Promise<string> {
  const providerCount = randomProviderCount()
  const providers = randomProviders(providerCount)
  const providerIds = providers.map((p) => p.id)

  // Decide PostGIS behavior
  const behavior = pick(["success-subset", "success-empty", "throw", "success-all"]) as
    | "success-subset"
    | "success-empty"
    | "throw"
    | "success-all"

  // Decide centerGeo — 30% chance null, 70% random coords
  const centerGeo =
    seededRandom() < 0.3
      ? null
      : { lat: randFloat(-90, 90), lng: randFloat(-180, 180) }

  // Decide hasGeo — 20% false, 80% true
  const hasGeo = seededRandom() >= 0.2

  const queryRaw = mockQueryRawForFuzz(providers, behavior)

  const map = await computeDistanceMap({
    providerIds,
    providers,
    centerGeo,
    hasGeo,
    userLat: randFloat(-90, 90),
    userLng: randFloat(-180, 180),
    queryRawUnsafe: queryRaw as any,
  })

  return diagnostic({
    size: map.size,
    expected: providers.length,
    passed: map.size === providers.length,
    providerCount,
    centerGeo: centerGeo !== null,
    hasGeo,
    behavior,
  })
}

function diagnostic(opts: {
  size: number
  expected: number
  passed: boolean
  providerCount: number
  centerGeo: boolean
  hasGeo: boolean
  behavior: string
}): string {
  return (
    `providers=${opts.providerCount} ` +
    `centerGeo=${opts.centerGeo} hasGeo=${opts.hasGeo} ` +
    `behavior=${opts.behavior} size=${opts.size} expected=${opts.expected} ` +
    `→ ${opts.passed ? "PASS" : "FAIL"}`
  )
}

// ---------------------------------------------------------------------------
// Fuzz test
// ---------------------------------------------------------------------------

describe("computeDistanceMap fuzzing", () => {
  it(`maintains result.size === providers.length across ${FUZZ_ITERATIONS} random inputs`, async () => {
    setSeed(42)
    const failures: string[] = []

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const line = await runOneFuzz()
      if (line.includes("FAIL")) {
        failures.push(`  [${failures.length + 1}] ${line}`)
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `computeDistanceMap failed size invariant in ${failures.length}/${FUZZ_ITERATIONS} fuzz cases:\n` +
        failures.join("\n"),
      )
    }
  })

  // -----------------------------------------------------------------------
  // Edge case: empty providers with PostGIS query that throws
  // -----------------------------------------------------------------------

  it("handles empty provider list even when PostGIS throws", async () => {
    const queryRaw = vi.fn(() => Promise.reject(new Error("DB gone")))

    const map = await computeDistanceMap({
      providerIds: [],
      providers: [],
      centerGeo: { lat: -23.55, lng: -46.63 },
      hasGeo: true,
      userLat: -23.55,
      userLng: -46.63,
      queryRawUnsafe: queryRaw as any,
    })

    expect(map.size).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Edge case: all null coordinates with PostGIS available
  // -----------------------------------------------------------------------

  it("handles all-null coordinates gracefully", async () => {
    const providers: ProviderGeo[] = [
      { id: "a", lat: null, lng: null },
      { id: "b", lat: null, lng: null },
    ]
    const queryRaw = vi.fn(() => Promise.resolve([]))

    const map = await computeDistanceMap({
      providerIds: ["a", "b"],
      providers,
      centerGeo: { lat: 0, lng: 0 },
      hasGeo: true,
      userLat: 0,
      userLng: 0,
      queryRawUnsafe: queryRaw as any,
    })

    // PostGIS query runs but returns nothing (no coordinates to query with),
    // Haversine can't compute because lat/lng are null → all null
    expect(map.size).toBe(2)
    expect(map.get("a")).toBeNull()
    expect(map.get("b")).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Edge case: partial-null coordinates (one of lat/lng is null)
  // -----------------------------------------------------------------------

  it("handles mixed null/valid coordinates without crashing", async () => {
    const providers: ProviderGeo[] = [
      { id: "a", lat: null, lng: -46.63 },
      { id: "b", lat: -23.55, lng: null },
    ]
    const queryRaw = vi.fn(() => Promise.resolve([]))

    const map = await computeDistanceMap({
      providerIds: ["a", "b"],
      providers,
      centerGeo: null,
      hasGeo: true,
      userLat: -23.55,
      userLng: -46.63,
      queryRawUnsafe: queryRaw as any,
    })

    // Both providers have incomplete coordinates → Haversine can't compute
    expect(map.size).toBe(2)
    expect(map.get("a")).toBeNull()
    expect(map.get("b")).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Edge case: userLat/userLng at poles (extreme coordinates)
  // -----------------------------------------------------------------------

  it("handles polar user coordinates without crashing", async () => {
    const providers: ProviderGeo[] = [
      { id: "north", lat: 89.9, lng: 0 },
      { id: "south", lat: -89.9, lng: 0 },
    ]
    const queryRaw = vi.fn(() => Promise.reject(new Error("No PostGIS")))

    const map = await computeDistanceMap({
      providerIds: ["north", "south"],
      providers,
      centerGeo: null,
      hasGeo: true,
      userLat: 90, // North Pole
      userLng: 0,
      queryRawUnsafe: queryRaw as any,
    })

    expect(map.size).toBe(2)
    // Haversine should still work at poles (Haversine formula handles it)
    expect(map.get("north")).toBeTypeOf("number")
    expect(map.get("south")).toBeTypeOf("number")
  })

  // -----------------------------------------------------------------------
  // Edge case: duplicate provider IDs (same id in multiple entries)
  // -----------------------------------------------------------------------

  it("handles duplicate provider IDs — last entry wins", async () => {
    const queryRaw = vi.fn(() => Promise.resolve([]))

    const map = await computeDistanceMap({
      providerIds: ["dup", "dup"],
      providers: [
        { id: "dup", lat: -23.55, lng: -46.63 },
        { id: "dup", lat: -23.56, lng: -46.64 },
      ],
      centerGeo: null,
      hasGeo: true,
      userLat: -23.55,
      userLng: -46.63,
      queryRawUnsafe: queryRaw as any,
    })

    // Map has 1 key because Map deduplicates by key
    expect(map.size).toBe(1)
    // The last provider's coordinates were used
    expect(map.get("dup")).toBeCloseTo(1.5, 0) // Haversine ~1.5 km from user
  })
})
