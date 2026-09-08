import { describe, it, expect } from "vitest"
import { generateEscrowPIN, validateGeoCheckin, type CheckinAttempt } from "../geo-checkin-escrow"

describe("geo-checkin-escrow.ts — PIN Generation & Anti-Spoofing", () => {
  it("generates a 4-digit PIN with valid expiration", async () => {
    const escrow = await generateEscrowPIN("booking-test-123")
    expect(escrow.pin).toMatch(/^\d{4}$/)
    expect(escrow.bookingId).toBe("booking-test-123")
    expect(new Date(escrow.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it("validates checkin when provider is within 150m and GPS accuracy is good", () => {
    const attempt: CheckinAttempt = {
      bookingId: "b-1",
      providerId: "p-1",
      providerLat: -23.5505,
      providerLng: -46.6333,
      clientAddressLat: -23.5506, // ~15m away
      clientAddressLng: -46.6334,
      accuracyMeters: 10,
    }

    const result = validateGeoCheckin(attempt)
    expect(result.success).toBe(true)
    expect(result.distanceMeters).toBeLessThanOrEqual(150)
    expect(result.checkedInAt).toBeDefined()
  })

  it("fails checkin when provider is farther than 150m", () => {
    const attempt: CheckinAttempt = {
      bookingId: "b-2",
      providerId: "p-2",
      providerLat: -23.5505,
      providerLng: -46.6333,
      clientAddressLat: -23.5605, // ~1.1km away
      clientAddressLng: -46.6333,
      accuracyMeters: 10,
    }

    const result = validateGeoCheckin(attempt)
    expect(result.success).toBe(false)
    expect(result.distanceMeters).toBeGreaterThan(150)
    expect(result.reason).toContain("Aproxime-se a menos de 150m")
  })

  it("anti-spoofing: rejects checkin with degraded GPS accuracy (>150m)", () => {
    const attempt: CheckinAttempt = {
      bookingId: "b-3",
      providerId: "p-3",
      providerLat: -23.5505,
      providerLng: -46.6333,
      clientAddressLat: -23.5505,
      clientAddressLng: -46.6333,
      accuracyMeters: 300, // Triangulação de antena / IP
    }

    const result = validateGeoCheckin(attempt)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("baixa precisão")
  })

  it("anti-spoofing: rejects impossible teleportation speed (>200 km/h)", () => {
    const now = Date.now()
    const fiveMinutesAgo = now - 5 * 60 * 1000

    const attempt: CheckinAttempt = {
      bookingId: "b-4",
      providerId: "p-4",
      providerLat: -23.5505, // São Paulo
      providerLng: -46.6333,
      clientAddressLat: -23.5505,
      clientAddressLng: -46.6333,
      accuracyMeters: 15,
      clientTimestamp: now,
      previousLocation: {
        lat: -22.9068, // Rio de Janeiro (~360km away in 5 min!)
        lng: -43.1729,
        timestamp: fiveMinutesAgo,
      },
    }

    const result = validateGeoCheckin(attempt)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("Inconsistência de deslocamento")
  })
})
