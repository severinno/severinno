import { describe, it, expect, vi, afterEach } from "vitest"
import { getRoute, getMultiRoute, clearRouteCache } from "../routing"

afterEach(() => {
  clearRouteCache()
  vi.restoreAllMocks()
})

describe("getRoute", () => {
  it("returns Haversine fallback when OSRM is unavailable", async () => {
    const route = await getRoute([-23.55, -46.63], [-23.543, -46.625])

    expect(route).toHaveProperty("distanceKm")
    expect(route).toHaveProperty("durationMin")
    expect(route).toHaveProperty("polyline")
    expect(route.distanceKm).toBeGreaterThan(0)
    expect(route.durationMin).toBeGreaterThan(0)
    // Fallback mode: no polyline
    expect(route.polyline).toBeNull()
  })

  it("returns reasonable distance for nearby points (SP center)", async () => {
    const route = await getRoute([-23.55, -46.63], [-23.56, -46.64])

    expect(route.distanceKm).toBeGreaterThan(0)
    expect(route.distanceKm).toBeLessThan(3) // ~1.3 km straight-line
    expect(route.durationMin).toBeGreaterThan(0)
    expect(route.durationMin).toBeLessThan(15)
    expect(route.polyline).toBeNull() // fallback — no OSRM running
  })

  it("returns zero distance for same coordinates", async () => {
    const route = await getRoute([-23.55, -46.63], [-23.55, -46.63])

    expect(route.distanceKm).toBe(0)
    expect(route.durationMin).toBe(0)
    expect(route.polyline).toBeNull()
  })

  it("works with { lat, lng } objects", async () => {
    const route = await getRoute(
      { lat: -23.55, lng: -46.63 },
      { lat: -23.56, lng: -46.64 },
    )

    expect(route.distanceKm).toBeGreaterThan(0)
  })
})

describe("getMultiRoute", () => {
  it("returns routes for multiple destinations", async () => {
    const origin = [-23.55, -46.63] as [number, number]
    const destinations: [number, number][] = [
      [-23.56, -46.64],
      [-23.57, -46.65],
      [-23.58, -46.66],
    ]

    const routes = await getMultiRoute(origin, destinations)

    expect(routes).toHaveLength(3)
    for (const route of routes) {
      expect(route.distanceKm).toBeGreaterThan(0)
      expect(route.durationMin).toBeGreaterThan(0)
      expect(route).toHaveProperty("polyline")
    }
  })

  it("preserves order of destinations", async () => {
    const origin = [-23.55, -46.63] as [number, number]
    const destinations: [number, number][] = [
      [-23.55, -46.63], // same = 0
      [-23.56, -46.64], // farther
    ]

    const routes = await getMultiRoute(origin, destinations)

    expect(routes[0].distanceKm).toBe(0)
    expect(routes[1].distanceKm).toBeGreaterThan(0)
  })
})

describe("clearRouteCache", () => {
  it("clears the cache without throwing", () => {
    expect(() => clearRouteCache()).not.toThrow()
  })
})
