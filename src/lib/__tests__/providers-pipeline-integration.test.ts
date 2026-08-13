/**
 * providers-pipeline-integration.test.ts
 *
 * White-box integration test for the providers search pipeline.
 *
 * Chains the extracted modules together — mocking ONLY `queryRawUnsafe` —
 * to verify that the full pipeline composes correctly:
 *
 *   createCachedRadiusCountFn  (factory: buildWhereClause + withCache + queryRawUnsafe)
 *   → findEffectiveRadius       (Phase 1a: progressive radius expansion)
 *   → buildProviderWhereClause + $queryRawUnsafe  (Phase 1b: ID resolution)
 *   → computeDistanceMap        (Phase 2: PostGIS → Haversine → null chain)
 *
 * Unlike the HTTP-level tests (providers-radius-expansion.test.ts), this test
 * calls the modules directly without the Next.js route handler, making it
 * faster and more focused on the module composition.
 */

import { describe, it, expect, vi } from "vitest"
import { createCachedRadiusCountFn, findEffectiveRadius } from "../radius-expansion"
import { computeDistanceMap, type ProviderGeo } from "../distance-fallback"
import { buildProviderWhereClause } from "../sql-builder"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_LAT = -23.5505
const USER_LNG = -46.6333

// ---------------------------------------------------------------------------
// Mock data — 3 providers at increasing distances
// ---------------------------------------------------------------------------

/** Haversine distance from user (computed offline for assertions). */
const HAVERSINE_P2 = 1.5 // ~1.508 km → rounded to 1 decimal
const HAVERSINE_P3 = 7.3 // ~7.258 km → rounded to 1 decimal

const providers: ProviderGeo[] = [
  { id: "p1", lat: USER_LAT, lng: USER_LNG }, // 0 km from user
  { id: "p2", lat: -23.5605, lng: -46.6433 }, // ~1.508 km
  { id: "p3", lat: -23.6, lng: -46.68 }, // ~7.258 km
]

const providerIds = ["p1", "p2", "p3"]

// ---------------------------------------------------------------------------
// Staged mock — returns different responses based on SQL content & radius
// ---------------------------------------------------------------------------

/** Create a mock $queryRawUnsafe with staged responses for each query type. */
function createStagedQueryRaw(stages: {
  /** Response for COUNT queries during expansion (Phase 1a). */
  countByRadius?: Record<number, number>
  /**
   * Response for the ID resolution query (Phase 1b).
   * If omitted, defaults to all provider IDs for any radius.
   */
  idRowsByRadius?: Record<number, Array<{ id: string }>>
  /** Fallback when no radius-specific ID rows are configured. */
  defaultIdRows?: Array<{ id: string }>
  /** Response for the ST_Distance query (Phase 2, PostGIS). */
  distanceRows?: Array<{ id: string; distance_km: number }>
  /** If true, ST_Distance rejects (simulating PostGIS failure). */
  distanceReject?: boolean
}) {
  /** Extract the radius in meters from ST_DWithin(...). */
  function extractRadiusMeters(sql: string): number {
    const start = sql.indexOf("ST_DWithin")
    if (start === -1) return 0
    // Take everything after ST_DWithin and find the LAST numeric argument
    const after = sql.slice(start)
    const nums = [...after.matchAll(/(\d+)/g)]
    return nums.length > 0 ? Number(nums[nums.length - 1][1]) : 0
  }

  return vi.fn((sql: string, ..._params: unknown[]) => {
    const radiusMeters = extractRadiusMeters(sql)
    const radiusKm = radiusMeters / 1000

    // Phase 1a: COUNT query with ST_DWithin
    if (sql.includes("COUNT") && sql.includes("ST_DWithin")) {
      const count = stages.countByRadius?.[radiusKm] ?? 0
      return Promise.resolve([{ total: BigInt(count) }])
    }

    // Phase 2: ST_Distance query
    if (sql.includes("ST_Distance")) {
      if (stages.distanceReject) {
        return Promise.reject(new Error("PostGIS ST_Distance failed"))
      }
      return Promise.resolve(stages.distanceRows ?? [])
    }

    // Phase 1b: ID resolution — return radius-specific or default IDs
    const radiusSpecific = stages.idRowsByRadius?.[radiusKm]
    if (radiusSpecific) {
      return Promise.resolve(radiusSpecific)
    }
    return Promise.resolve(stages.defaultIdRows ?? [])
  }) as any
}

/** Create a mock withCache that invokes the factory function (cache miss). */
function createMockWithCache() {
  return vi.fn(async (_key: string, fn: () => unknown) => fn()) as any
}

// ---------------------------------------------------------------------------
// Pipeline helper — chains all phases into a structured result
// ---------------------------------------------------------------------------

interface PipelineResult {
  effectiveRadius: number | null
  matchCount: number
  providerIds: string[]
  distances: Map<string, number | null>
}

/**
 * Run the full providers search pipeline with the given parameters.
 *
 * @param opts.countByRadius - Number of providers to simulate at each radius.
 * @param opts.idRowsByRadius - Which provider IDs to return for each radius.
 * @param opts.distanceRows - PostGIS distance results for Phase 2.
 * @param opts.distanceReject - If true, Phase 2 ST_Distance throws.
 *
 * NOTE: This helper does not thread `categoryIds` or `q` through to the
 * ID resolution phase — those are tested separately in HTTP-level tests.
 */
async function runPipeline(opts: {
  radiusKm: number
  countByRadius?: Record<number, number>
  idRowsByRadius?: Record<number, Array<{ id: string }>>
  distanceRows?: Array<{ id: string; distance_km: number }>
  distanceReject?: boolean
}): Promise<PipelineResult> {
  const { radiusKm, countByRadius, idRowsByRadius, distanceRows, distanceReject } = opts
  const defaultIdRows = providerIds.map((id) => ({ id }))

  const queryRaw = createStagedQueryRaw({
    countByRadius,
    idRowsByRadius,
    defaultIdRows,
    distanceRows,
    distanceReject,
  })
  const withCache = createMockWithCache()

  // Phase 1a: create count function and run radius expansion
  const countFn = createCachedRadiusCountFn({
    lat: USER_LAT,
    lng: USER_LNG,
    cacheTtl: 120,
    queryRawUnsafe: queryRaw,
    withCache,
    buildWhereClause: buildProviderWhereClause,
  })

  const { effectiveRadius, matchCount } = await findEffectiveRadius(radiusKm, countFn)

  if (effectiveRadius === null) {
    return { effectiveRadius, matchCount, providerIds: [], distances: new Map() }
  }

  // Phase 1b: resolve provider IDs at the effective radius
  const centerGeo = { lat: USER_LAT, lng: USER_LNG, radiusKm: effectiveRadius }
  const [idWhere] = buildProviderWhereClause({ centerGeo })
  const idResult = await (queryRaw as any)(`SELECT u.id FROM "User" u WHERE ${idWhere}`)
  const resolvedIds = idResult.map((r: { id: string }) => r.id)

  // Only keep providers that were actually returned by Phase 1b
  const resolvedProviders = providers.filter((p) => resolvedIds.includes(p.id))

  // Phase 2: compute distances
  const distances = await computeDistanceMap({
    providerIds: resolvedIds,
    providers: resolvedProviders,
    centerGeo,
    hasGeo: true,
    userLat: USER_LAT,
    userLng: USER_LNG,
    queryRawUnsafe: queryRaw,
  })

  return { effectiveRadius, matchCount, providerIds: resolvedIds, distances }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Providers pipeline integration", () => {
  // -----------------------------------------------------------------------
  // Scenario 1 — Full success: expansion finds providers, distances computed
  // -----------------------------------------------------------------------

  it("chains expansion → ID resolution → distance computation", async () => {
    // Phase 1a: 0 providers at 10km, 3 providers at 25km
    // Phase 2: PostGIS returns distances for all 3 providers
    const result = await runPipeline({
      radiusKm: 10,
      countByRadius: { 10: 0, 25: 3 },
      idRowsByRadius: { 25: providerIds.map((id) => ({ id })) },
      distanceRows: [
        { id: "p1", distance_km: 0 },
        { id: "p2", distance_km: 1.508 },
        { id: "p3", distance_km: 7.258 },
      ],
    })

    // Phase 1a: expanded to 25km
    expect(result.effectiveRadius).toBe(25)
    expect(result.matchCount).toBe(3)

    // Phase 1b: all 3 provider IDs resolved
    expect(result.providerIds).toEqual(["p1", "p2", "p3"])

    // Phase 2: distances from PostGIS (rounded to 1 decimal)
    expect(result.distances.get("p1")).toBe(0)
    expect(result.distances.get("p2")).toBe(1.5)
    expect(result.distances.get("p3")).toBe(7.3)
    expect(result.distances.size).toBe(3)
  })

  // -----------------------------------------------------------------------
  // Scenario 2 — PostGIS distance fails → Haversine fallback
  // -----------------------------------------------------------------------

  it("falls back to Haversine when PostGIS distance query rejects", async () => {
    const result = await runPipeline({
      radiusKm: 10,
      countByRadius: { 10: 3 },
      distanceReject: true,
    })

    // Phase 1a: found at user's radius
    expect(result.effectiveRadius).toBe(10)
    expect(result.matchCount).toBe(3)

    // Phase 1b: 3 IDs
    expect(result.providerIds).toEqual(["p1", "p2", "p3"])

    // Phase 2: Haversine fallback (PostGIS threw)
    expect(result.distances.get("p1")).toBe(0)
    expect(result.distances.get("p2")).toBe(HAVERSINE_P2)
    expect(result.distances.get("p3")).toBe(HAVERSINE_P3)
    expect(result.distances.size).toBe(3)
  })

  // -----------------------------------------------------------------------
  // Scenario 3 — No providers at any expansion radius
  // -----------------------------------------------------------------------

  it("returns empty result when no providers found at any radius", async () => {
    const result = await runPipeline({
      radiusKm: 10,
      countByRadius: { 10: 0, 25: 0, 50: 0, 100: 0 },
    })

    expect(result.effectiveRadius).toBeNull()
    expect(result.matchCount).toBe(0)
    expect(result.providerIds).toHaveLength(0)
    expect(result.distances.size).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Scenario 4 — Expansion from radius=0 to 5km
  // -----------------------------------------------------------------------

  it("expands from radius=0 to 5km and computes distances", async () => {
    const result = await runPipeline({
      radiusKm: 0,
      countByRadius: { 0: 0, 5: 2 },
      idRowsByRadius: { 5: [{ id: "p1" }, { id: "p2" }] },
      distanceRows: [
        { id: "p1", distance_km: 0 },
        { id: "p2", distance_km: 1.508 },
      ],
    })

    expect(result.effectiveRadius).toBe(5)
    expect(result.matchCount).toBe(2)
    expect(result.providerIds).toEqual(["p1", "p2"])
    expect(result.distances.get("p1")).toBe(0)
    expect(result.distances.get("p2")).toBe(1.5)
  })

  // -----------------------------------------------------------------------
  // Scenario 5 — PostGIS returns distances for a subset of providers
  // -----------------------------------------------------------------------

  it("merges PostGIS + Haversine results when PostGIS returns partial data", async () => {
    const result = await runPipeline({
      radiusKm: 10,
      countByRadius: { 10: 3 },
      distanceRows: [{ id: "p1", distance_km: 0.5 }],
    })

    expect(result.effectiveRadius).toBe(10)
    expect(result.matchCount).toBe(3)

    // p1 from PostGIS
    expect(result.distances.get("p1")).toBe(0.5)
    // p2 and p3 not in PostGIS result → Haversine fallback
    expect(result.distances.get("p2")).toBe(HAVERSINE_P2)
    expect(result.distances.get("p3")).toBe(HAVERSINE_P3)
    expect(result.distances.size).toBe(3)
  })

  // -----------------------------------------------------------------------
  // Scenario 6 — Provider without coordinates (no Haversine fallback)
  // -----------------------------------------------------------------------

  it("returns null distance for providers without lat/lng", async () => {
    const noCoordProviders: ProviderGeo[] = [
      { id: "p1", lat: null, lng: null },
      { id: "p2", lat: -23.5605, lng: -46.6433 },
    ]
    const noCoordIds = ["p1", "p2"]

    const queryRaw = vi.fn((sql: string) => {
      if (sql.includes("COUNT")) return Promise.resolve([{ total: BigInt(2) }])
      if (sql.includes("ST_Distance")) return Promise.resolve([])
      return Promise.resolve(noCoordIds.map((id) => ({ id })))
    }) as any
    const withCache = createMockWithCache()

    const countFn = createCachedRadiusCountFn({
      lat: USER_LAT,
      lng: USER_LNG,
      cacheTtl: 120,
      queryRawUnsafe: queryRaw,
      withCache,
      buildWhereClause: buildProviderWhereClause,
    })
    const { effectiveRadius } = await findEffectiveRadius(10, countFn)
    expect(effectiveRadius).toBe(10)

    const distances = await computeDistanceMap({
      providerIds: noCoordIds,
      providers: noCoordProviders,
      centerGeo: { lat: USER_LAT, lng: USER_LNG, radiusKm: 10 } as any,
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    // p1 has no coordinates → null
    expect(distances.get("p1")).toBeNull()
    // p2 has coordinates → Haversine
    expect(distances.get("p2")).toBe(HAVERSINE_P2)
    expect(distances.size).toBe(2)
  })

  // -----------------------------------------------------------------------
  // Scenario 7 — withCache called for each expansion radius tried
  // -----------------------------------------------------------------------

  it("calls withCache for each radius level during expansion", async () => {
    const queryRaw = createStagedQueryRaw({
      countByRadius: { 10: 0, 25: 3 },
      defaultIdRows: providerIds.map((id) => ({ id })),
      distanceRows: [],
    })
    const withCache = createMockWithCache()

    const countFn = createCachedRadiusCountFn({
      lat: USER_LAT,
      lng: USER_LNG,
      cacheTtl: 120,
      queryRawUnsafe: queryRaw,
      withCache,
      buildWhereClause: buildProviderWhereClause,
    })

    await findEffectiveRadius(10, countFn)

    const cacheKeys = withCache.mock.calls.map((c: unknown[]) => c[0] as string)
    const countKeys = cacheKeys.filter((k: string) => k.startsWith("providers:count:"))

    // 10km was tried (returned 0), 25km was tried (returned 3)
    expect(countKeys.some((k: string) => k.includes(":10:"))).toBe(true)
    expect(countKeys.some((k: string) => k.includes(":25:"))).toBe(true)
    // 50km and beyond should NOT be called (stopped at 25km)
    expect(countKeys.some((k: string) => k.includes(":50:"))).toBe(false)
    expect(countKeys.some((k: string) => k.includes(":100:"))).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Scenario 8 — Expansion reaches the last step (100km)
  // -----------------------------------------------------------------------

  it("expands through all steps and finds providers only at 100km", async () => {
    const result = await runPipeline({
      radiusKm: 10,
      // All expansion steps return 0 until 100km
      countByRadius: { 10: 0, 25: 0, 50: 0, 100: 2 },
      idRowsByRadius: { 100: [{ id: "p1" }, { id: "p2" }] },
      distanceRows: [
        { id: "p1", distance_km: 55.3 },
        { id: "p2", distance_km: 78.1 },
      ],
    })

    expect(result.effectiveRadius).toBe(100)
    expect(result.matchCount).toBe(2)
    expect(result.providerIds).toEqual(["p1", "p2"])
    expect(result.distances.get("p1")).toBe(55.3)
    expect(result.distances.get("p2")).toBe(78.1)
    expect(result.distances.size).toBe(2)
  })
})
