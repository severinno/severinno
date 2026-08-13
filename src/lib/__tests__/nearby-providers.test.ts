/**
 * nearby-providers.test.ts
 *
 * Unit tests for src/lib/nearby-providers.ts — pure Haversine fallback
 * helper for the "providers nearby" search.
 *
 * The function is pure (no I/O), so all tests run without mocks.
 */

import { describe, it, expect } from "vitest"
import { filterProvidersByRadius } from "../nearby-providers"

// Reference: São Paulo coordinates
const SP_LAT = -23.5505
const SP_LNG = -46.6333

describe("filterProvidersByRadius", () => {
  it("returns providers within the radius sorted by distance ascending", () => {
    const result = filterProvidersByRadius(
      [
        // ~7 km north of São Paulo center
        { id: "far", lat: -23.487, lng: -46.633 },
        // ~2 km west
        { id: "near", lat: -23.55, lng: -46.66 },
        // ~22 km away
        { id: "out", lat: -23.35, lng: -46.63 },
      ],
      SP_LAT,
      SP_LNG,
      10,
    )

    expect(result.map((p) => p.id)).toEqual(["near", "far"])
    expect(result[0].distanceKm).toBeLessThan(result[1].distanceKm)
    expect(result[0].distanceKm).toBeLessThan(10)
  })

  it("excludes providers beyond the radius", () => {
    const result = filterProvidersByRadius(
      [{ id: "far", lat: -23.3, lng: -46.63 }], // ~28 km
      SP_LAT,
      SP_LNG,
      5,
    )

    expect(result).toHaveLength(0)
  })

  it("excludes providers with non-finite coordinates", () => {
    const result = filterProvidersByRadius(
      [
        { id: "nan-lat", lat: NaN, lng: -46.63 },
        { id: "inf-lng", lat: -23.55, lng: Infinity },
        { id: "valid", lat: -23.55, lng: -46.63 },
      ],
      SP_LAT,
      SP_LNG,
      10,
    )

    expect(result.map((p) => p.id)).toEqual(["valid"])
  })

  it("returns empty array for empty input", () => {
    const result = filterProvidersByRadius([], SP_LAT, SP_LNG, 10)
    expect(result).toEqual([])
  })

  it("preserves provider metadata on results", () => {
    const result = filterProvidersByRadius(
      [{ id: "p1", lat: -23.55, lng: -46.633, name: "João", avgRating: 4.8 }],
      SP_LAT,
      SP_LNG,
      1,
    )

    expect(result[0]).toMatchObject({
      id: "p1",
      name: "João",
      avgRating: 4.8,
    })
    // ~62m away — well inside the radius
    expect(result[0].distanceKm).toBeLessThan(0.1)
  })

  it("computes correct Haversine distance (km)", () => {
    // Known distance between São Paulo center and its east zone (~10 km)
    const result = filterProvidersByRadius(
      [{ id: "east", lat: -23.55, lng: -46.48 }],
      SP_LAT,
      SP_LNG,
      100,
    )

    expect(result[0].distanceKm).toBeGreaterThan(10)
    expect(result[0].distanceKm).toBeLessThan(20)
  })
})
