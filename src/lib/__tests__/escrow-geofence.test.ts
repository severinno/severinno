import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  validateEscrowGeofence,
  DEFAULT_MAX_GEOFENCE_DISTANCE_KM,
  GEOFENCE_TIERS,
} from "../escrow-geofence"
import { AlertingService } from "../alerting-service"

describe("validateEscrowGeofence (src/lib/escrow-geofence.ts)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("approves when provider is within the service location radius", () => {
    // Praça da Sé, SP: -23.5505, -46.6333
    // Pátio do Colégio, SP (aprox 350m): -23.5489, -46.6328
    const result = validateEscrowGeofence({
      providerLocation: { lat: -23.5489, lng: -46.6328 },
      serviceLocation: { lat: -23.5505, lng: -46.6333 },
    })

    expect(result.valid).toBe(true)
    expect(result.status).toBe("VERIFIED")
    expect(result.distanceKm).toBeLessThan(DEFAULT_MAX_GEOFENCE_DISTANCE_KM)
  })

  it("approves high-precision STRICT presence within 50 meters", () => {
    // 25 meters apart
    const result = validateEscrowGeofence({
      providerLocation: { lat: -23.5505, lng: -46.6333, accuracyM: 8 },
      serviceLocation: { lat: -23.55065, lng: -46.63335 },
      precisionTier: "STRICT",
    })

    expect(result.valid).toBe(true)
    expect(result.status).toBe("VERIFIED")
    expect(result.distanceKm).toBeLessThanOrEqual(GEOFENCE_TIERS.STRICT)
  })

  it("rejects degraded GPS fix when accuracy exceeds maximum acceptable threshold", () => {
    // Provider is physically close, but GNSS sensor reports a degraded accuracy of 150m (cell tower fix)
    const result = validateEscrowGeofence({
      providerLocation: { lat: -23.5505, lng: -46.6333, accuracyM: 150 },
      serviceLocation: { lat: -23.5505, lng: -46.6333 },
      precisionTier: "STRICT",
    })

    expect(result.valid).toBe(false)
    expect(result.status).toBe("INACCURATE_GPS_FIX")
    expect(result.reason).toContain("Sinal de GPS impreciso")
  })

  it("detects deviation and rejects when provider is far from the service location", () => {
    // Praça da Sé (-23.5505, -46.6333) vs Av Paulista (-23.5615, -46.6559) ~2.7km
    const result = validateEscrowGeofence({
      providerLocation: { lat: -23.5615, lng: -46.6559 },
      serviceLocation: { lat: -23.5505, lng: -46.6333 },
      maxAllowedDistanceKm: 1.0,
      bookingId: "booking-geo-1",
    })

    expect(result.valid).toBe(false)
    expect(result.status).toBe("DEVIATION_DETECTED")
    expect(result.distanceKm).toBeGreaterThan(1.0)
    expect(result.reason).toContain("Prestador a")
  })

  it("detects teleportation/anti-spoofing velocity anomalies", () => {
    // 20 km jump in 10 seconds (~7,200 km/h)
    const now = Date.now()
    const result = validateEscrowGeofence({
      providerLocation: { lat: -23.5505, lng: -46.6333, accuracyM: 10 },
      serviceLocation: { lat: -23.5505, lng: -46.6333 },
      previousLocation: {
        lat: -23.7,
        lng: -46.8,
        timestampMs: now - 10_000,
      },
      currentTimestampMs: now,
      precisionTier: "STRICT",
    })

    expect(result.valid).toBe(false)
    expect(result.status).toBe("DEVIATION_DETECTED")
    expect(result.reason).toContain("Deslocamento fisicamente implausível")
  })

  it("dispatches incident alert when notifyOnDeviation is true and deviation occurs", () => {
    const alertSpy = vi.spyOn(AlertingService, "sendAlert").mockResolvedValue(true)

    const result = validateEscrowGeofence({
      providerLocation: { lat: -23.5615, lng: -46.6559 },
      serviceLocation: { lat: -23.5505, lng: -46.6333 },
      maxAllowedDistanceKm: 1.0,
      bookingId: "booking-fraud-99",
      notifyOnDeviation: true,
    })

    expect(result.valid).toBe(false)
    expect(alertSpy).toHaveBeenCalledTimes(1)
    expect(alertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("Alerta de Fraude"),
        severity: "WARNING",
        source: "EscrowGeofenceValidator",
      }),
    )
  })
})
