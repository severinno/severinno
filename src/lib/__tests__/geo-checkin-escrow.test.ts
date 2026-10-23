import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  generateEscrowPIN,
  validateGeoCheckin,
  validateEscrowRelease,
  generatePresenceToken,
  validatePresenceCheckin,
  type CheckinAttempt,
} from "../geo-checkin-escrow"

describe("geo-checkin-escrow.ts — PIN Generation & Anti-Spoofing", () => {
  // A asserção expiresAt > Date.now() compara dois instantes do relógio real:
  // se o TTL fosse curto e a execução demorasse, a janela fecharia no meio do
  // teste (flake). Congela SÓ Date num horário neutro — determinístico.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-01-05T15:00:00.000Z")) // 12:00 BRT
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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

describe("validateEscrowRelease — PIN Verification & Fund Release", () => {
  it("rejects release when no PIN exists for the booking", async () => {
    const result = await validateEscrowRelease("non-existent-booking", "1234", 150)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("Nenhum PIN ativo")
  })

  it("rejects release with incorrect PIN (constant-time verification)", async () => {
    const escrow = await generateEscrowPIN("booking-release-test")
    const wrongPin = escrow.pin === "0000" ? "1111" : "0000"

    const result = await validateEscrowRelease("booking-release-test", wrongPin, 250)
    expect(result.success).toBe(false)
    expect(result.reason).toContain("PIN incorreto")
  })

  it("successfully releases escrow when PIN is valid and single-use", async () => {
    const escrow = await generateEscrowPIN("booking-valid-release")
    const result = await validateEscrowRelease("booking-valid-release", escrow.pin, 350.5)

    expect(result.success).toBe(true)
    expect(result.bookingId).toBe("booking-valid-release")
    expect(result.releasedAmount).toBe(350.5)
    expect(result.releasedAt).toBeDefined()

    // Second attempt should fail (single-use PIN consumed)
    const replayAttempt = await validateEscrowRelease("booking-valid-release", escrow.pin, 350.5)
    expect(replayAttempt.success).toBe(false)
  })
})

describe("generatePresenceToken & validatePresenceCheckin — Geofence Fallback", () => {
  it("generates 6-digit presence token and QR payload with 15min expiry", async () => {
    const tokenData = await generatePresenceToken("booking-presence-1")
    expect(tokenData.bookingId).toBe("booking-presence-1")
    expect(tokenData.token).toMatch(/^\d{6}$/)
    expect(new Date(tokenData.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const parsedQr = JSON.parse(tokenData.qrPayload)
    expect(parsedQr.type).toBe("severinno-presence-checkin")
    expect(parsedQr.bookingId).toBe("booking-presence-1")
    expect(parsedQr.token).toBe(tokenData.token)
  })

  it("validates checkin with clean 6-digit token", async () => {
    const tokenData = await generatePresenceToken("booking-presence-2")
    const result = await validatePresenceCheckin("booking-presence-2", tokenData.token, "prov-1")

    expect(result.success).toBe(true)
    expect(result.checkedInAt).toBeDefined()
    expect(result.distanceMeters).toBe(0)
  })

  it("validates checkin with scanned JSON QR payload", async () => {
    const tokenData = await generatePresenceToken("booking-presence-3")
    const result = await validatePresenceCheckin(
      "booking-presence-3",
      tokenData.qrPayload,
      "prov-1",
    )

    expect(result.success).toBe(true)
    expect(result.checkedInAt).toBeDefined()
  })

  it("rejects checkin with wrong token and prevents replay on successful token", async () => {
    const tokenData = await generatePresenceToken("booking-presence-4")

    // Wrong token
    const wrong = await validatePresenceCheckin("booking-presence-4", "999999", "prov-1")
    expect(wrong.success).toBe(false)
    expect(wrong.reason).toContain("Código de presença incorreto")

    // Correct token succeeds
    const ok = await validatePresenceCheckin("booking-presence-4", tokenData.token, "prov-1")
    expect(ok.success).toBe(true)

    // Replay fails (token was consumed)
    const replay = await validatePresenceCheckin("booking-presence-4", tokenData.token, "prov-1")
    expect(replay.success).toBe(false)
  })
})
