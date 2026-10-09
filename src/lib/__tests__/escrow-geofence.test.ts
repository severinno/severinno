import { describe, it, expect, vi, beforeEach } from "vitest"
import { validateEscrowGeofence, DEFAULT_MAX_GEOFENCE_DISTANCE_KM } from "../escrow-geofence"
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
