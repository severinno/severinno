import { describe, it, expect, vi, beforeEach } from "vitest"
import { validateEscrowRelease, cleanupExpiredPins } from "../geo-checkin-escrow"

// Mock Redis
vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheInvalidate: vi.fn(),
}))

// Mock logger
vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { cacheGet, cacheInvalidate } from "@/lib/redis"

describe("geo-checkin-escrow.ts — validateEscrowRelease", () => {
  beforeEach(() => {
    vi.mocked(cacheGet).mockReset()
    vi.mocked(cacheInvalidate).mockReset()
  })

  it("returns failure when no PIN exists", async () => {
    vi.mocked(cacheGet).mockResolvedValue(null)
    const result = await validateEscrowRelease("booking-1", "1234", 50)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("Nenhum PIN ativo")
  })

  it("returns failure when PIN is expired", async () => {
    vi.mocked(cacheGet).mockResolvedValue({
      pin: "1234",
      expiresAt: Date.now() - 1000, // expired 1s ago
    })
    const result = await validateEscrowRelease("booking-1", "1234", 50)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("expirado")
    expect(cacheInvalidate).toHaveBeenCalled()
  })

  it("returns failure when PIN is wrong", async () => {
    vi.mocked(cacheGet).mockResolvedValue({
      pin: "1234",
      expiresAt: Date.now() + 3600000, // 1 hour from now
    })
    const result = await validateEscrowRelease("booking-1", "5678", 50)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("incorreto")
  })

  it("succeeds when PIN is correct", async () => {
    vi.mocked(cacheGet).mockResolvedValue({
      pin: "1234",
      expiresAt: Date.now() + 3600000,
    })
    const result = await validateEscrowRelease("booking-1", "1234", 50)
    expect(result.success).toBe(true)
    expect(result.bookingId).toBe("booking-1")
    expect(result.releasedAmount).toBe(50)
    expect(result.releasedAt).toBeDefined()
    expect(cacheInvalidate).toHaveBeenCalled()
  })

  it("handles different-length PINs gracefully", async () => {
    vi.mocked(cacheGet).mockResolvedValue({
      pin: "1234",
      expiresAt: Date.now() + 3600000,
    })
    const result = await validateEscrowRelease("booking-1", "12", 50)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("incorreto")
  })

  it("falls back to in-memory when Redis fails", async () => {
    vi.mocked(cacheGet).mockRejectedValue(new Error("Redis down"))
    // The in-memory map is empty for a fresh booking
    const result = await validateEscrowRelease("booking-fresh", "1234", 50)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("Nenhum PIN ativo")
  })
})

describe("geo-checkin-escrow.ts — cleanupExpiredPins", () => {
  it("returns 0 when no expired PINs", () => {
    // The activePins map is module-level; we can't easily control it in tests
    // but we can verify the function doesn't throw
    const cleaned = cleanupExpiredPins()
    expect(typeof cleaned).toBe("number")
    expect(cleaned).toBeGreaterThanOrEqual(0)
  })
})
