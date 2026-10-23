import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "../route"
import { db } from "@/lib/db"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    general: { key: "general", interval: 60, max: 100 },
  },
}))

vi.mock("@/lib/redis", () => ({
  withCache: vi.fn((_key, fn) => fn()),
}))

describe("GET /api/vitrine/context", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns regional context with city, timezone, weather and platform metrics", async () => {
    vi.mocked(db.user.count).mockResolvedValue(15)
    vi.mocked(db.booking.count).mockResolvedValue(42)
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "bk-1",
      service: { title: "Técnico de Ar-Condicionado" },
    } as any)

    const request = new Request(
      "http://localhost:3000/api/vitrine/context?city=Governador%20Valadares&state=MG&lat=-18.85&lng=-41.95",
    )
    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.city).toBe("Governador Valadares")
    expect(body.state).toBe("MG")
    expect(body.macroRegion).toBe("sudeste")
    expect(body.timezone).toBe("America/Sao_Paulo")
    expect(body.neighborhoods).toContain("Ilha dos Araújos")
    expect(body.neighborhoods).toContain("Centro")
    expect(body.platformEvents.bookingsLast24h).toBe(42)
    expect(body.platformEvents.activeProvidersNearby).toBe(15)
  })

  it("adapts correctly to requested city and forced weather", async () => {
    vi.mocked(db.user.count).mockResolvedValue(8)
    vi.mocked(db.booking.count).mockResolvedValue(19)

    const request = new Request(
      "http://localhost:3000/api/vitrine/context?city=Salvador&state=BA&weather=rainstorm",
    )
    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.city).toBe("Salvador")
    expect(body.state).toBe("BA")
    expect(body.macroRegion).toBe("nordeste")
    expect(body.weather).toBe("rainstorm")
    expect(body.neighborhoods).toContain("Pituba")
  })
})
