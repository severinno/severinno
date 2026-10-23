import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET as getDailyRoute } from "@/app/api/provider/routes/daily/route"
import { POST as postSlotFit } from "@/app/api/provider/routes/slot-fit/route"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
    },
    booking: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

const PROVIDER_ID = "prov-route-1"

const mockBookings = [
  {
    id: "b-1",
    address: "Rua Vergueiro, 100",
    scheduledAt: new Date("2026-10-15T09:00:00Z"),
    service: { title: "Manutenção de Ar" },
    client: { name: "Lucas Mendes" },
  },
  {
    id: "b-2",
    address: "Av. Brigadeiro Luis Antonio, 500",
    scheduledAt: new Date("2026-10-15T14:00:00Z"),
    service: { title: "Limpeza de Dutos" },
    client: { name: "Ana Beatriz" },
  },
]

describe("Provider Routes & Daily Optimization API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUser).mockResolvedValue({ userId: PROVIDER_ID, role: "PROVIDER" } as never)
  })

  it("GET /api/provider/routes/daily otimiza agendamentos do dia usando TSP 2-Opt", async () => {
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: PROVIDER_ID,
      name: "João Climatização",
      city: "São Paulo",
    } as never)
    vi.mocked(db.booking.findMany).mockResolvedValue(mockBookings as never)

    const req = new Request("http://localhost:3000/api/provider/routes/daily?date=2026-10-15")
    const res = await getDailyRoute(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.stopsCount).toBe(2)
    expect(json.plan.orderedStops.length).toBe(2)
    expect(json.plan.googleMapsUrl).toContain("google.com/maps")
    expect(json.plan.wazeUrl).toContain("waze.com")
  })

  it("POST /api/provider/routes/slot-fit avalia encaixe inteligente com menor desvio", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue(mockBookings as never)

    const req = new Request("http://localhost:3000/api/provider/routes/slot-fit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: "2026-10-15",
        title: "Reparo Extra",
        lat: -23.56,
        lng: -46.64,
        durationMinutes: 60,
      }),
    })
    const res = await postSlotFit(req)

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.fit.bestSlot).toBeDefined()
    expect(json.fit.allEvaluations.length).toBeGreaterThan(0)
  })
})
