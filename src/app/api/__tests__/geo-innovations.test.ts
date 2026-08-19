import { describe, it, expect, vi, beforeEach } from "vitest"
import { calculateTravelFee } from "@/lib/travel-fee"
import { optimizeDailyRoute } from "@/lib/route-optimizer"
import { isPointInServiceZone } from "@/lib/postgis"

// Mock dependencies
vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key, fn) => fn()),
}))

vi.mock("@/lib/osrm", () => ({
  calculateRouteAndEta: vi.fn((origLat: number, _origLng: number, destLat: number) => {
    const isFar = Math.abs(origLat - destLat) > 0.05
    return Promise.resolve({
      distanceKm: isFar ? 15.0 : 3.0,
      durationMin: isFar ? 25 : 6,
      origin: { lat: origLat, lng: -46.6333 },
      destination: { lat: destLat, lng: -46.65 },
      source: "osrm" as const,
    })
  }),
}))

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ inside: true }]),
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: "prov-1",
        lat: -23.5505,
        lng: -46.6333,
        travelFeePolicy: null,
      }),
    },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: "book-1",
        providerId: "prov-1",
        clientId: "client-1",
        lat: -23.56,
        lng: -46.65,
        status: "CONFIRMED",
        geofenceAlertSentAt: null,
        provider: { name: "João Encanador" },
        client: { name: "Maria" },
      }),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}))

describe("Geo Innovations Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("1. Travel Fee Engine (@/lib/travel-fee)", () => {
    it("should return zero fee when distance is within free km threshold", async () => {
      // Close coordinates -> distance 3.0 km -> free
      const result = await calculateTravelFee(-23.5505, -46.6333, -23.5585, -46.64)

      expect(result.distanceKm).toBe(3)
      expect(result.travelFee).toBe(0)
      expect(result.formattedFee).toBe("Grátis")
      expect(result.freeKm).toBe(5)
    })

    it("should calculate fee when distance exceeds free threshold", async () => {
      // Far coordinates -> distance 15.0 km -> 10 billable km * R$ 2.50 = R$ 25.00
      const result = await calculateTravelFee(-23.5505, -46.6333, -23.65, -46.75, {
        freeKmThreshold: 5,
        pricePerKm: 2.5,
        minFee: 5,
        maxFee: 80,
      })

      expect(result.distanceKm).toBe(15)
      expect(result.billableKm).toBe(10)
      expect(result.travelFee).toBe(25)
      expect(result.pricePerKm).toBe(2.5)
      expect(result.formattedFee).toContain("25")
    })
  })

  describe("2. Route Optimizer (@/lib/route-optimizer)", () => {
    it("should handle single-stop route without error", async () => {
      const result = await optimizeDailyRoute({ lat: -23.5505, lng: -46.6333 }, [
        { id: "b-1", label: "Conserto", lat: -23.56, lng: -46.64 },
      ])

      expect(result.orderedStops).toHaveLength(1)
      expect(result.totalDistanceKm).toBeGreaterThan(0)
      expect(result.savingsVsOriginalKm).toBe(0)
    })

    it("should handle empty stops list", async () => {
      const result = await optimizeDailyRoute({ lat: -23.5505, lng: -46.6333 }, [])

      expect(result.orderedStops).toHaveLength(0)
      expect(result.totalDistanceKm).toBe(0)
    })
  })

  describe("3. PostGIS isPointInServiceZone (@/lib/postgis)", () => {
    it("should validate point containment in polygon", async () => {
      const polygon = JSON.stringify({
        type: "Polygon",
        coordinates: [
          [
            [-46.7, -23.6],
            [-46.6, -23.6],
            [-46.6, -23.5],
            [-46.7, -23.5],
            [-46.7, -23.6],
          ],
        ],
      })

      const result = await isPointInServiceZone(-23.55, -46.65, polygon)
      expect(result).toBe(true)
    })
  })
})
