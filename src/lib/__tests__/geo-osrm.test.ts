import { describe, it, expect, vi, beforeEach } from "vitest"
import { calculateRoute } from "../geo-osrm"

describe("OSRM Routing Engine (src/lib/geo-osrm.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("calculates geodesic fallback route when OSRM local server is unreachable", async () => {
    // Ilha dos Araújos (GV) to Centro (GV)
    const origin: [number, number] = [-18.865, -41.939]
    const dest: [number, number] = [-18.852, -41.942]

    // Simula OSRM indisponível (conexão recusada / timeout)
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Connection refused"))

    const result = await calculateRoute(origin, dest, { timeoutMs: 50 })

    expect(result).toBeDefined()
    expect(result.source).toBe("osrm-fallback-geodesic")
    expect(result.distanceMeters).toBeGreaterThan(1000)
    expect(result.distanceMeters).toBeLessThan(3500)
    expect(result.durationSeconds).toBeGreaterThan(60)
    expect(result.polyline.length).toBeGreaterThan(2)
    expect(result.geometry?.type).toBe("LineString")
  })

  it("parses OSRM local response when available", async () => {
    const mockOsrmResponse = {
      routes: [
        {
          distance: 2450.5,
          duration: 310.2,
          geometry: {
            type: "LineString",
            coordinates: [
              [-41.939, -18.865],
              [-41.94, -18.86],
              [-41.942, -18.852],
            ],
          },
        },
      ],
    }

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => mockOsrmResponse,
    } as any)

    const origin: [number, number] = [-18.865, -41.939]
    const dest: [number, number] = [-18.852, -41.942]

    const result = await calculateRoute(origin, dest)

    expect(result.source).toBe("osrm-local")
    expect(result.distanceMeters).toBe(2451)
    expect(result.durationSeconds).toBe(310)
    expect(result.polyline).toEqual([
      [-18.865, -41.939],
      [-18.86, -41.94],
      [-18.852, -41.942],
    ])
  })
})
