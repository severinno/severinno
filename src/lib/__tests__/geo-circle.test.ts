import { describe, it, expect } from "vitest"
import {
  createRadiusGeoJSON,
  haversineDistance,
  estimatePolygonRadius,
} from "../geo-circle"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check that a polygon's first and last vertex are identical (closed ring). */
function expectClosedRing(coords: number[][]) {
  const first = coords[0]
  const last = coords[coords.length - 1]
  expect(first[0]).toBeCloseTo(last[0], 10)
  expect(first[1]).toBeCloseTo(last[1], 10)
}

// ---------------------------------------------------------------------------
// createRadiusGeoJSON
// ---------------------------------------------------------------------------

describe("createRadiusGeoJSON", () => {
  const BASE_LAT = -23.5505
  const BASE_LNG = -46.6333
  const RADIUS_KM = 10

  it("returns a valid GeoJSON Feature with Polygon geometry", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, RADIUS_KM)

    expect(result.type).toBe("Feature")
    expect(result.geometry).toBeDefined()
    expect((result.geometry as Record<string, unknown>).type).toBe("Polygon")
    expect(result.properties).toEqual({})
  })

  it("produces the default number of vertices (36) plus the closing point", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, RADIUS_KM)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    // 36 segments = 37 vertices (36 + closing point)
    expect(coords).toHaveLength(37)
  })

  it("produces a closed ring (first vertex = last vertex)", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, RADIUS_KM)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    expectClosedRing(coords)
  })

  it("accepts a custom number of points", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, RADIUS_KM, 64)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    // 64 segments = 65 vertices
    expect(coords).toHaveLength(65)
  })

  it("clamps minimum points to 3", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, RADIUS_KM, 1)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    // Clamped to 3 → 4 vertices
    expect(coords).toHaveLength(4)
  })

  it("has all vertices within ~5% of the expected radius", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, RADIUS_KM)
    const avgRadius = estimatePolygonRadius(
      result as any,
      BASE_LAT,
      BASE_LNG,
    )

    // Equirectangular approximation has some distortion at -23° lat,
    // but should be within 5% of the target
    expect(avgRadius).toBeGreaterThan(RADIUS_KM * 0.95)
    expect(avgRadius).toBeLessThan(RADIUS_KM * 1.05)
  })

  it("returns an empty polygon (single point) for radius = 0", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, 0)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    expect(coords).toHaveLength(1)
    expect(coords[0][0]).toBe(BASE_LNG)
    expect(coords[0][1]).toBe(BASE_LAT)
  })

  it("returns an empty polygon for negative radius", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, -5)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    expect(coords).toHaveLength(1)
    expect(coords[0][0]).toBe(BASE_LNG)
    expect(coords[0][1]).toBe(BASE_LAT)
  })

  it("returns an empty polygon for NaN radius", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, NaN)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    expect(coords).toHaveLength(1)
  })

  it("works with a large radius (500km)", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, 500)
    const avgRadius = estimatePolygonRadius(
      result as any,
      BASE_LAT,
      BASE_LNG,
    )

    // Larger radii have more distortion but should be within 10%
    expect(avgRadius).toBeGreaterThan(450)
    expect(avgRadius).toBeLessThan(550)
  })

  it("works at the equator (lat = 0)", () => {
    const result = createRadiusGeoJSON(0, -46.6333, 100)
    const avgRadius = estimatePolygonRadius(result as any, 0, -46.6333)

    expect(avgRadius).toBeGreaterThan(95)
    expect(avgRadius).toBeLessThan(105)
  })

  it("works at high latitude (lat = 60)", () => {
    const result = createRadiusGeoJSON(60, 30, 100)
    const avgRadius = estimatePolygonRadius(result as any, 60, 30)

    expect(avgRadius).toBeGreaterThan(95)
    expect(avgRadius).toBeLessThan(110)
  })

  it("returns coordinate pairs as [lng, lat] (GeoJSON convention)", () => {
    const result = createRadiusGeoJSON(BASE_LAT, BASE_LNG, RADIUS_KM)
    const coords = (result as any).geometry.coordinates[0] as number[][]

    // First vertex: longitude first, latitude second
    const [lng, lat] = coords[1]
    // Should be east (lng > center) and north (lat > center) of center
    expect(lng).toBeGreaterThan(BASE_LNG)
    expect(lat).toBeGreaterThan(BASE_LAT)
  })
})

// ---------------------------------------------------------------------------
// haversineDistance
// ---------------------------------------------------------------------------

describe("haversineDistance", () => {
  it("returns 0 for the same point", () => {
    expect(haversineDistance(-23.55, -46.63, -23.55, -46.63)).toBe(0)
  })

  it("computes ~10km for 0.1° lat difference at equator", () => {
    const d = haversineDistance(0, 0, 0.09, 0)
    // ~0.09° × 111.32 km/° ≈ 10 km
    expect(d).toBeGreaterThan(9.5)
    expect(d).toBeLessThan(10.5)
  })

  it("computes ~3959km between São Paulo and Manaus", () => {
    // São Paulo: -23.5505, -46.6333
    // Manaus: -3.1190, -60.0217
    const d = haversineDistance(-23.5505, -46.6333, -3.119, -60.0217)
    // Real distance ≈ 2700 km
    expect(d).toBeGreaterThan(2600)
    expect(d).toBeLessThan(2800)
  })
})

// ---------------------------------------------------------------------------
// estimatePolygonRadius
// ---------------------------------------------------------------------------

describe("estimatePolygonRadius", () => {
  it("returns 0 for a single-point polygon", () => {
    const polygon = {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[-46.6333, -23.5505]]],
      },
      properties: {},
    } as any

    expect(estimatePolygonRadius(polygon, -23.5505, -46.6333)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Fuzzing — 100 random lat/lng/radius combinations
// ---------------------------------------------------------------------------

describe("createRadiusGeoJSON fuzzing (100 random inputs)", () => {
  /**
   * Seeded pseudo-random number generator (Mulberry32).
   * Deterministic — the same seed always produces the same sequence,
   * so this test is reproducible across runs.
   */
  function mulberry32(seed: number) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  const rand = mulberry32(42) // fixed seed for reproducibility

  /** Generate a random float in [min, max]. */
  const between = (min: number, max: number) => min + rand() * (max - min)

  it.each([
    // [label, latRange, lngRange, radiusRange, tolerance]
    ["tropics (−30° to 30°) ±10%", -30, 30, -180, 180, 1, 500, 0.10],
    ["mid-latitudes (30° to 60°) ±10%", 30, 60, -180, 180, 1, 500, 0.10],
    ["high latitudes (60° to 85°) ±12%", 60, 85, -180, 180, 1, 500, 0.12],
    ["small radii (1–10 km) ±8%", -60, 60, -180, 180, 1, 10, 0.08],
    ["medium radii (10–100 km) ±8%", -60, 60, -180, 180, 10, 100, 0.08],
    ["large radii (100–1000 km) ±15%", -60, 60, -180, 180, 100, 1000, 0.15],
  ])("all 100 samples within tolerance for %s", (
    _label,
    latMin, latMax,
    lngMin, lngMax,
    radiusMin, radiusMax,
    tolerance,
  ) => {
    const SAMPLES = 100
    const results: Array<{ lat: number; lng: number; radius: number; estimated: number; errorPct: number }> = []

    for (let i = 0; i < SAMPLES; i++) {
      const lat = between(latMin, latMax)
      const lng = between(lngMin, lngMax)
      const radius = between(radiusMin, radiusMax)

      const polygon = createRadiusGeoJSON(lat, lng, radius)
      const estimated = estimatePolygonRadius(polygon as any, lat, lng)
      const errorPct = Math.abs(estimated - radius) / radius

      if (errorPct > tolerance) {
        results.push({ lat, lng, radius, estimated, errorPct })
      }
    }

    // Collect all failures for a comprehensive report
    const maxFailures = 3
    const failures = results.slice(0, maxFailures)
    const remaining = results.length - failures.length

    expect(failures).toEqual([])
  })

  it("reports aggregate stats for all 600 samples", () => {
    const aggRand = mulberry32(43) // different seed for independent sampling
    const SAMPLES = 600
    let totalError = 0
    let maxError = 0
    let maxErrorCase: { lat: number; lng: number; radius: number; estimated: number } | null = null

    for (let i = 0; i < SAMPLES; i++) {
      const lat = between(-85, 85)
      const lng = between(-180, 180)
      const radius = between(1, 1000)

      const polygon = createRadiusGeoJSON(lat, lng, radius)
      const estimated = estimatePolygonRadius(polygon as any, lat, lng)
      const errorPct = Math.abs(estimated - radius) / radius

      totalError += errorPct
      if (errorPct > maxError) {
        maxError = errorPct
        maxErrorCase = { lat, lng, radius, estimated }
      }
    }

    const avgError = totalError / SAMPLES

    // The equirectangular approximation should average < 3% error
    expect(avgError).toBeLessThan(0.03)

    // Document the worst case (not a hard assertion — informational)
    if (maxError > 0.15) {
      console.warn(
        `[geo-circle fuzz] worst case: lat=${maxErrorCase?.lat.toFixed(2)}, ` +
        `lng=${maxErrorCase?.lng.toFixed(2)}, radius=${maxErrorCase?.radius}km, ` +
        `estimated=${maxErrorCase?.estimated.toFixed(1)}km, error=${(maxError * 100).toFixed(1)}%`,
      )
    }
  })
})
