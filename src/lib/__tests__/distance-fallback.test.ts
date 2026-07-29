// @ts-nocheck
/**
 * Tests for src/lib/distance-fallback.ts — computeDistanceMap
 *
 * Coverage targets:
 *   ✅ PostGIS query succeeds → distances from DB
 *   ✅ PostGIS query fails (catch) → Haversine fallback
 *   ✅ PostGIS + Haversine both unavailable → null distance
 *   ✅ centerGeo is null → skip PostGIS, fall back directly to Haversine
 *   ✅ Provider without lat/lng → null distance
 *   ✅ hasGeo is false → Haversine not attempted, null for all
 *   ✅ Empty provider list → empty map
 *   ✅ Distances rounded to 1 decimal place
 */

import { describe, it, expect, vi } from "vitest"
import { computeDistanceMap } from "../distance-fallback"

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const USER_LAT = -23.5505
const USER_LNG = -46.6333

/**
 * Mock queryRawUnsafe factory.
 * Returns a spy that resolves with the given rows, or rejects with an error.
 */
function mockQueryRaw(
  rows?: Array<{ id: string; distance_km: number }>,
  shouldReject = false,
) {
  return vi.fn(
    () =>
      shouldReject
        ? Promise.reject(new Error("DB error"))
        : Promise.resolve(rows ?? []),
  ) as any
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeDistanceMap", () => {
  // -----------------------------------------------------------------------
  // Scenario 1 — PostGIS succeeds
  // -----------------------------------------------------------------------

  it("returns PostGIS distances when query succeeds", async () => {
    const queryRaw = mockQueryRaw([
      { id: "p1", distance_km: 2.543 },
      { id: "p2", distance_km: 5.789 },
    ])

    const map = await computeDistanceMap({
      providerIds: ["p1", "p2"],
      providers: [
        { id: "p1", lat: -23.55, lng: -46.63 },
        { id: "p2", lat: -23.56, lng: -46.64 },
      ],
      centerGeo: { lat: USER_LAT, lng: USER_LNG },
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    // Distances rounded to 1 decimal
    expect(map.get("p1")).toBe(2.5)
    expect(map.get("p2")).toBe(5.8)
    expect(map.size).toBe(2)

    // Verify the SQL includes ST_Distance
    const sqlCall = queryRaw.mock.calls[0][0] as string
    expect(sqlCall).toContain("ST_Distance")
    expect(sqlCall).toContain("$3::text[]")
    // Params: lng, lat, providerIds array
    expect(queryRaw.mock.calls[0][1]).toBe(USER_LNG)
    expect(queryRaw.mock.calls[0][2]).toBe(USER_LAT)
  })

  // -----------------------------------------------------------------------
  // Scenario 2 — PostGIS fails → Haversine fallback
  // -----------------------------------------------------------------------

  it("falls back to Haversine when PostGIS query rejects", async () => {
    const queryRaw = mockQueryRaw(undefined, true)

    // p1 same coords as user, p2 offset ~1.5 km
    const map = await computeDistanceMap({
      providerIds: ["p1", "p2"],
      providers: [
        { id: "p1", lat: USER_LAT, lng: USER_LNG },
        { id: "p2", lat: -23.5605, lng: -46.6433 },
      ],
      centerGeo: { lat: USER_LAT, lng: USER_LNG },
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    expect(map.get("p1")).toBe(0)
    // Haversine between (-23.5505, -46.6333) and (-23.5605, -46.6433)
    // ≈ 1.508 km, rounded to 1 decimal → 1.5 km
    expect(map.get("p2")).toBe(1.5)

    // Verify PostGIS was attempted
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(queryRaw).toHaveBeenCalledWith(
      expect.stringContaining("ST_Distance"),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    )
  })

  // -----------------------------------------------------------------------
  // Scenario 3 — centerGeo is null → skip PostGIS, directly Haversine
  // -----------------------------------------------------------------------

  it("skips PostGIS when centerGeo is null, uses Haversine directly", async () => {
    const queryRaw = mockQueryRaw()

    const map = await computeDistanceMap({
      providerIds: ["p1"],
      providers: [{ id: "p1", lat: USER_LAT, lng: USER_LNG }],
      centerGeo: null,
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    // PostGIS not attempted → Haversine computed
    expect(map.get("p1")).toBe(0)
    expect(queryRaw).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // Scenario 4 — Provider without lat/lng → null distance
  // -----------------------------------------------------------------------

  it("returns null for providers without lat/lng even with hasGeo=true", async () => {
    const queryRaw = mockQueryRaw()

    const map = await computeDistanceMap({
      providerIds: ["p1"],
      providers: [{ id: "p1", lat: null, lng: null }],
      centerGeo: null,
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    expect(map.get("p1")).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Scenario 5 — hasGeo is false → Haversine not attempted
  // -----------------------------------------------------------------------

  it("returns null when hasGeo is false and PostGIS is not used", async () => {
    const queryRaw = mockQueryRaw()

    const map = await computeDistanceMap({
      providerIds: ["p1"],
      providers: [{ id: "p1", lat: USER_LAT, lng: USER_LNG }],
      centerGeo: null,
      hasGeo: false,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    // No PostGIS (centerGeo null) + no Haversine (hasGeo false) → null
    expect(map.get("p1")).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Scenario 6 — Empty provider list
  // -----------------------------------------------------------------------

  it("returns empty map when no providers given", async () => {
    const queryRaw = mockQueryRaw()

    const map = await computeDistanceMap({
      providerIds: [],
      providers: [],
      centerGeo: { lat: USER_LAT, lng: USER_LNG },
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    expect(map.size).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Scenario 7 — PostGIS succeeds for some, Haversine for others
  // -----------------------------------------------------------------------

  it("merges PostGIS and Haversine results for different providers", async () => {
    // PostGIS returns only p1
    const queryRaw = mockQueryRaw([{ id: "p1", distance_km: 3.2 }])

    const map = await computeDistanceMap({
      providerIds: ["p1", "p2"],
      providers: [
        { id: "p1", lat: -23.55, lng: -46.63 },
        { id: "p2", lat: -23.5705, lng: -46.6533 },
      ],
      centerGeo: { lat: USER_LAT, lng: USER_LNG },
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    // p1 from PostGIS
    expect(map.get("p1")).toBe(3.2)
    // p2 not in PostGIS result → Haversine fallback
    // Offset: Δlat=0.02°, Δlng=0.02° → Haversine ≈ 3.0 km
    expect(map.get("p2")).toBe(3)
  })

  // -----------------------------------------------------------------------
  // Scenario 8 — PostGIS returns empty row set
  // -----------------------------------------------------------------------

  it("falls back to Haversine for all when PostGIS returns no rows", async () => {
    const queryRaw = mockQueryRaw([])

    const map = await computeDistanceMap({
      providerIds: ["p1"],
      providers: [{ id: "p1", lat: USER_LAT, lng: USER_LNG }],
      centerGeo: { lat: USER_LAT, lng: USER_LNG },
      hasGeo: true,
      userLat: USER_LAT,
      userLng: USER_LNG,
      queryRawUnsafe: queryRaw,
    })

    // PostGIS returned nothing → Haversine fallback
    expect(map.get("p1")).toBe(0)
  })
})
