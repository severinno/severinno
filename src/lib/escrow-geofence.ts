/**
 * Severinno Marketplace SaaS — Escrow Geofence Anti-Fraud Engine
 *
 * Cross-references real-time provider telemetry GPS coordinates against
 * the client's service location address to validate physical presence
 * before releasing escrow funds or completing service bookings.
 */

import { haversineKm } from "./geo-shared"
import logger from "./logger"
import { AlertingService } from "./alerting-service"

export interface Coordinates {
  lat: number
  lng: number
}

export interface GeofenceValidationOptions {
  providerLocation: Coordinates
  serviceLocation: Coordinates
  maxAllowedDistanceKm?: number
  bookingId?: string
  notifyOnDeviation?: boolean
}

export interface GeofenceValidationResult {
  valid: boolean
  distanceKm: number
  maxAllowedDistanceKm: number
  status: "VERIFIED" | "DEVIATION_DETECTED"
  reason?: string
}

export const DEFAULT_MAX_GEOFENCE_DISTANCE_KM = 1.5

/**
 * Validates that the provider is physically within the agreed service geofence.
 */
export function validateEscrowGeofence(
  options: GeofenceValidationOptions,
): GeofenceValidationResult {
  const {
    providerLocation,
    serviceLocation,
    maxAllowedDistanceKm = DEFAULT_MAX_GEOFENCE_DISTANCE_KM,
    bookingId,
    notifyOnDeviation = false,
  } = options

  const distanceKm = haversineKm(
    providerLocation.lat,
    providerLocation.lng,
    serviceLocation.lat,
    serviceLocation.lng,
  )

  // Avaliação estrita da distância real sem relaxamento aritmético por arredondamento para baixo
  // (evita que 1.504km vire 1.50km e libere fundos fraudulentamente).
  const roundedDistanceKm = Math.round(distanceKm * 1000) / 1000
  const valid = distanceKm <= maxAllowedDistanceKm

  if (!valid) {
    const reason = `Prestador a ${roundedDistanceKm}km do local do serviço (máximo permitido: ${maxAllowedDistanceKm}km)`
    logger.warn(
      { bookingId, providerLocation, serviceLocation, distanceKm: roundedDistanceKm },
      `[ESCROW_GEOFENCE] Desvio detectado: ${reason}`,
    )

    if (notifyOnDeviation) {
      void AlertingService.sendAlert({
        title: "Alerta de Fraude: Desvio de Geofence no Escrow",
        message: `Tentativa de liberação/conclusão de agendamento ${bookingId ? `#${bookingId}` : ""} com prestador fora do perímetro contratado (${roundedDistanceKm}km de distância).`,
        severity: "WARNING",
        source: "EscrowGeofenceValidator",
        metadata: {
          bookingId: bookingId ?? "N/A",
          distanceKm: roundedDistanceKm,
          maxAllowedKm: maxAllowedDistanceKm,
        },
      })
    }

    return {
      valid: false,
      distanceKm: roundedDistanceKm,
      maxAllowedDistanceKm,
      status: "DEVIATION_DETECTED",
      reason,
    }
  }

  return {
    valid: true,
    distanceKm: roundedDistanceKm,
    maxAllowedDistanceKm,
    status: "VERIFIED",
  }
}
