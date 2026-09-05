import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "test", max: 1000, windowMs: 60_000 }) }),
}))

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "u1", role: "PROVIDER" }),
}))

vi.mock("@/lib/db", () => ({ db: {} }))

const { mockValidateGeoCheckin, mockGenerateEscrowPIN, mockValidateEscrowRelease } = vi.hoisted(
  () => ({
    mockValidateGeoCheckin: vi.fn(),
    mockGenerateEscrowPIN: vi.fn(),
    mockValidateEscrowRelease: vi.fn(),
  }),
)

vi.mock("@/lib/geo-checkin-escrow", () => ({
  validateGeoCheckin: mockValidateGeoCheckin,
  generateEscrowPIN: mockGenerateEscrowPIN,
  validateEscrowRelease: mockValidateEscrowRelease,
}))

import { POST } from "../bookings/checkin-escrow/route"
import { requireUser } from "@/lib/auth"
import { HttpError } from "@/lib/api-server"

function req(body: unknown) {
  return createMockRequest({ method: "POST", body }) as any
}

describe("POST /api/bookings/checkin-escrow", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 400 for unknown action", async () => {
    const res = await POST(req({ action: "unknown" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
    expect((parsed.body as any).error).toContain("Invalid action")
  })

  it("checkin — returns 400 when missing parameters", async () => {
    const res = await POST(req({ action: "checkin", bookingId: "b1" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
  })

  it("checkin — validates geo checkin successfully", async () => {
    mockValidateGeoCheckin.mockReturnValue({ success: true, distanceMeters: 50 })
    const res = await POST(
      req({
        action: "checkin",
        bookingId: "b1",
        providerId: "u1",
        providerLat: -23.55,
        providerLng: -46.63,
        clientAddressLat: -23.55,
        clientAddressLng: -46.63,
      }),
    )
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect((parsed.body as any).success).toBe(true)
    expect(mockValidateGeoCheckin).toHaveBeenCalledOnce()
  })

  it("generate-pin — returns 400 when bookingId missing", async () => {
    const res = await POST(req({ action: "generate-pin" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
  })

  it("generate-pin — returns PIN on success", async () => {
    mockGenerateEscrowPIN.mockResolvedValue({ pin: "123456", expiresAt: "2026-01-01T00:00:00Z" })
    const res = await POST(req({ action: "generate-pin", bookingId: "b1" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect((parsed.body as any).success).toBe(true)
    expect((parsed.body as any).data.pin).toBe("123456")
  })

  it("release-escrow — returns 400 when missing parameters", async () => {
    const res = await POST(req({ action: "release-escrow", bookingId: "b1" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(400)
  })

  it("release-escrow — validates escrow release", async () => {
    mockValidateEscrowRelease.mockResolvedValue({ success: true, released: true })
    const res = await POST(
      req({ action: "release-escrow", bookingId: "b1", pin: "123456", escrowAmount: 100 }),
    )
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(200)
    expect((parsed.body as any).success).toBe(true)
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireUser).mockRejectedValueOnce(new HttpError(401, "Não autorizado"))
    const res = await POST(req({ action: "checkin" }))
    const parsed = await parseResponse(res)
    expect(parsed.status).toBe(401)
  })
})
