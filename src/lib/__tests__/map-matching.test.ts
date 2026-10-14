import { describe, it, expect } from "vitest"
import { snapToRoad, calculateBearing, type Coordinate } from "../map-matching"

describe("Map Matching & Snap-to-Road (src/lib/map-matching.ts)", () => {
  it("calculates accurate bearing between coordinates", () => {
    // Due North
    expect(calculateBearing(0, 0, 1, 0)).toBeCloseTo(0, 1)
    // Due East
    expect(calculateBearing(0, 0, 0, 1)).toBeCloseTo(90, 1)
    // Due South
    expect(calculateBearing(1, 0, 0, 0)).toBeCloseTo(180, 1)
    // Due West
    expect(calculateBearing(0, 1, 0, 0)).toBeCloseTo(270, 1)
  })

  it("snaps a coordinate with lateral jitter onto the centerline of a road segment", () => {
    // A straight road going West to East along latitude -18.8500
    const roadPolyline: Coordinate[] = [
      [-41.95, -18.85],
      [-41.94, -18.85],
    ]

    // Provider GPS fix with 15 meters lateral drift to the North (-18.84986 instead of -18.85000)
    const rawGps: Coordinate = [-41.945, -18.84986]

    const result = snapToRoad(rawGps, roadPolyline)

    expect(result.isMatched).toBe(true)
    expect(result.distanceToRoadMeters).toBeGreaterThan(10)
    expect(result.distanceToRoadMeters).toBeLessThan(20)
    // Snapped coordinate latitude should be exactly on the road: -18.8500
    expect(result.snappedCoord[1]).toBeCloseTo(-18.85, 5)
    // Snapped coordinate longitude should preserve the along-track position: -41.9450
    expect(result.snappedCoord[0]).toBeCloseTo(-41.945, 5)
    // Road bearing should be eastward (~90 deg)
    expect(result.bearing).toBeCloseTo(90, 1)
  })

  it("leaves coordinates untouched when provider is off-road beyond the corridor threshold", () => {
    const roadPolyline: Coordinate[] = [
      [-41.95, -18.85],
      [-41.94, -18.85],
    ]

    // Provider is 200m away in a field
    const farGps: Coordinate = [-41.945, -18.848]

    const result = snapToRoad(farGps, roadPolyline, 45)

    expect(result.isMatched).toBe(false)
    expect(result.distanceToRoadMeters).toBeGreaterThan(150)
    expect(result.snappedCoord).toEqual(farGps)
  })
})
