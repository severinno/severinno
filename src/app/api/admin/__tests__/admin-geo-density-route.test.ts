import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/geo-density/route"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { NextRequest } from "next/server"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
}))

describe("GET /api/admin/geo-density", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireRole).mockResolvedValue({ id: "admin-1", role: "ADMIN" } as any)
  })

  it("returns a valid GeoJSON FeatureCollection aggregated by H3 hexagons", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      { id: "p-1", lat: -23.5505, lng: -46.6333 },
      { id: "p-2", lat: -23.551, lng: -46.634 },
    ] as any)

    vi.mocked(db.booking.findMany).mockResolvedValue([
      { id: "b-1", lat: -23.5505, lng: -46.6333 },
      { id: "b-2", lat: -22.9068, lng: -43.1729 },
    ] as any)

    const req = new NextRequest("http://localhost:3000/api/admin/geo-density?resolution=7")
    const res = await GET(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.type).toBe("FeatureCollection")
    expect(Array.isArray(json.features)).toBe(true)
    expect(json.features.length).toBeGreaterThan(0)
    expect(json.meta.resolution).toBe(7)
    expect(json.meta.totalProviders).toBe(2)
    expect(json.meta.totalDemands).toBe(2)

    const feature = json.features[0]
    expect(feature.type).toBe("Feature")
    expect(feature.geometry.type).toBe("Polygon")
    expect(Array.isArray(feature.geometry.coordinates[0])).toBe(true)
    expect(feature.properties.h3Index).toBeDefined()
    expect(feature.properties.opportunityScore).toBeDefined()
  })
})
