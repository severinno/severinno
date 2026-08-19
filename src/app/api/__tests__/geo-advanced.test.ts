import { describe, it, expect, vi, beforeEach } from "vitest"
import { calculateRouteAndEta } from "@/lib/osrm"
import { findProvidersWithinBounds } from "@/lib/postgis"

// Mock dependencies
vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key, fn) => fn()),
}))

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "prov-1" }, { id: "prov-2" }]),
    user: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "prov-1",
          name: "Maria Eletricista",
          avatarUrl: null,
          verified: true,
          avgRating: 4.8,
          reviewCount: 19,
          lat: -23.5505,
          lng: -46.6333,
          services: [{ id: "s-1", title: "Instalação", basePrice: 150 }],
        },
      ]),
    },
  },
}))

describe("Advanced Geolocation Layer Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("1. OSRM Engine & ETA (@/lib/osrm)", () => {
    it("should calculate driving distance and duration with urban road network fallback", async () => {
      // São Paulo Sé -> Paulista (~3km straight line, ~4km driving)
      const originLat = -23.5505
      const originLng = -46.6333
      const destLat = -23.5614
      const destLng = -46.6558

      const result = await calculateRouteAndEta(originLat, originLng, destLat, destLng)

      expect(result.distanceKm).toBeGreaterThan(0)
      expect(result.durationMin).toBeGreaterThanOrEqual(3)
      expect(result.origin.lat).toBe(originLat)
      expect(result.destination.lng).toBe(destLng)
    })
  })

  describe("2. PostGIS Bounding Box Query (@/lib/postgis)", () => {
    it("should return provider IDs inside bounding box coordinates", async () => {
      const minLat = -23.6
      const minLng = -46.7
      const maxLat = -23.5
      const maxLng = -46.6

      const ids = await findProvidersWithinBounds(minLat, minLng, maxLat, maxLng)

      expect(ids).toHaveLength(2)
      expect(ids).toEqual(["prov-1", "prov-2"])
    })
  })
})
