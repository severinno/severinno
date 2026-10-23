import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { POST } from "../slot-fit-check/route"

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: "book-123",
        providerId: "prov-1",
      }),
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "prov-1", role: "PROVIDER" }),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { general: {} },
}))

vi.mock("@/lib/slot-fit-notifications", () => ({
  checkAndNotifyBookingSlotFit: vi.fn().mockResolvedValue({
    eligible: true,
    notified: true,
    fitQuality: "PERFECT",
    detourKm: 1.5,
  }),
}))

describe("POST /api/provider/routes/slot-fit-check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("evaluates slot fit and returns result", async () => {
    const req = new NextRequest("http://localhost:3000/api/provider/routes/slot-fit-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId: "book-123" }),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.eligible).toBe(true)
    expect(json.notified).toBe(true)
    expect(json.fitQuality).toBe("PERFECT")
  })

  it("returns 400 when bookingId is missing", async () => {
    const req = new NextRequest("http://localhost:3000/api/provider/routes/slot-fit-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
  })
})
