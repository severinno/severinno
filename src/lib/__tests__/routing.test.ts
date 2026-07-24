import { describe, it, expect } from "vitest"
import { getRoute } from "../routing"

describe("getRoute fallback", () => {
  it("returns fallback route when OSRM is unavailable", async () => {
    const route = await getRoute([-23.55, -46.63], [-23.543, -46.625])
    expect(route).toHaveProperty("distanceKm")
    expect(route).toHaveProperty("durationMin")
    expect(route.distanceKm).toBeGreaterThan(0)
    expect(route.durationMin).toBeGreaterThan(0)
  })
})
