/**
 * Severinno Marketplace SaaS — Escrow Geofence Anti-Fraud Engine
 *
 * Cross-references real-time provider telemetry GPS coordinates against
 * the client's service location address to validate physical presence
 * before releasing escrow funds or completing service bookings.
 *
 * High-Precision Multi-Tier Engine:
 *   - STRICT (50m): Physical arrival at client's home/building (required for escrow release)
 *   - ARRIVAL (150m): Block/street vicinity
 *   - PROXIMITY (500m): Proximity alert to client
 */

import { haversineKm } from "./geo-shared"
import logger from "./logger"
import { AlertingService } from "./alerting-service"

export interface Coordinates {
  lat: number
  lng: number
  /** GNSS 68% confidence accuracy radius in meters reported by device */
  accuracyM?: number | null
}

export type GeofenceTier = "STRICT" | "ARRIVAL" | "PROXIMITY"

export const GEOFENCE_TIERS = {
  STRICT: 0.05, // 50 meters
  ARRIVAL: 0.15, // 150 meters
  PROXIMITY: 0.5, // 500 meters
} as const

export const MAX_TRUSTED_ACCURACY_METERS = 35 // GPS error must be <= 35m for escrow
export const DEFAULT_MAX_GEOFENCE_DISTANCE_KM = 0.5 // Default perimeter (500m)

export interface GeofenceValidationOptions {
  providerLocation: Coordinates
  serviceLocation: Coordinates
  /** Explicit maximum allowed distance in km. If omitted, derives from precisionTier or defaults to 0.5km. */
  maxAllowedDistanceKm?: number
  /** High-precision tier: STRICT (50m), ARRIVAL (150m), or PROXIMITY (500m). */
  precisionTier?: GeofenceTier
  /** Maximum acceptable GPS sensor error in meters (default: 35m for STRICT/ARRIVAL). */
  maxAllowedAccuracyMeters?: number
  bookingId?: string
  notifyOnDeviation?: boolean
  /** Prior recorded location and timestamp to detect teleportation/spoofing */
  previousLocation?: {
    lat: number
    lng: number
    timestampMs: number
  }
  currentTimestampMs?: number
}

export interface GeofenceValidationResult {
  valid: boolean
  distanceKm: number
  maxAllowedDistanceKm: number
  accuracyM?: number | null
  status: "VERIFIED" | "DEVIATION_DETECTED" | "INACCURATE_GPS_FIX"
  reason?: string
}

/**
 * Validates that the provider is physically within the agreed service geofence
 * and has a reliable, high-precision GNSS fix.
 */
export function validateEscrowGeofence(
  options: GeofenceValidationOptions,
): GeofenceValidationResult {
  const {
    providerLocation,
    serviceLocation,
    precisionTier,
    bookingId,
    notifyOnDeviation = false,
    previousLocation,
    currentTimestampMs,
  } = options

  // 1. Resolve distance threshold based on tier or explicit override
  const maxAllowedDistanceKm =
    options.maxAllowedDistanceKm ??
    (precisionTier ? GEOFENCE_TIERS[precisionTier] : DEFAULT_MAX_GEOFENCE_DISTANCE_KM)

  const maxAccuracy =
    options.maxAllowedAccuracyMeters ??
    (precisionTier === "PROXIMITY" ? 100 : MAX_TRUSTED_ACCURACY_METERS)

  // 2. GNSS Accuracy Gate: reject degraded fixes (cell tower / Wi-Fi drift)
  if (
    typeof providerLocation.accuracyM === "number" &&
    Number.isFinite(providerLocation.accuracyM) &&
    providerLocation.accuracyM > maxAccuracy
  ) {
    const accuracyRounded = Math.round(providerLocation.accuracyM)
    const reason = `Sinal de GPS impreciso (margem de erro de ±${accuracyRounded}m superior ao limite de ±${maxAccuracy}m). Aguarde fix de alta precisão a céu aberto.`

    logger.warn(
      { bookingId, providerLocation, accuracyM: accuracyRounded, maxAccuracy },
      `[ESCROW_GEOFENCE] Fix imprecisa rejeitada: ${reason}`,
    )

    return {
      valid: false,
      distanceKm: 0,
      maxAllowedDistanceKm,
      accuracyM: accuracyRounded,
      status: "INACCURATE_GPS_FIX",
      reason,
    }
  }

  // 3. Anti-Spoofing: verify physical speed plausibility between consecutive readings
  if (previousLocation && currentTimestampMs) {
    const elapsedHours = (currentTimestampMs - previousLocation.timestampMs) / (1000 * 60 * 60)
    if (elapsedHours > 0 && elapsedHours < 1) {
      const movedKm = haversineKm(
        previousLocation.lat,
        previousLocation.lng,
        providerLocation.lat,
        providerLocation.lng,
      )
      const speedKmH = movedKm / elapsedHours
      // Above 180 km/h in urban territory indicates mocked locations or GPS teleportation
      if (speedKmH > 180) {
        const reason = `Deslocamento fisicamente implausível (${Math.round(speedKmH)} km/h). Possível simulação ou anomalia de sinal.`
        logger.warn({ bookingId, speedKmH }, `[ESCROW_GEOFENCE] Anti-spoofing alert: ${reason}`)

        return {
          valid: false,
          distanceKm: Math.round(movedKm * 1000) / 1000,
          maxAllowedDistanceKm,
          accuracyM: providerLocation.accuracyM,
          status: "DEVIATION_DETECTED",
          reason,
        }
      }
    }
  }

  // 4. Calculate geodesic distance
  const distanceKm = haversineKm(
    providerLocation.lat,
    providerLocation.lng,
    serviceLocation.lat,
    serviceLocation.lng,
  )

  const roundedDistanceKm = Math.round(distanceKm * 1000) / 1000
  const valid = distanceKm <= maxAllowedDistanceKm

  if (!valid) {
    const distanceMeters = Math.round(distanceKm * 1000)
    const maxMeters = Math.round(maxAllowedDistanceKm * 1000)
    const reason = `Prestador a ${distanceMeters}m do local do serviço (máximo permitido: ${maxMeters}m)`

    logger.warn(
      { bookingId, providerLocation, serviceLocation, distanceKm: roundedDistanceKm },
      `[ESCROW_GEOFENCE] Desvio detectado: ${reason}`,
    )

    if (notifyOnDeviation) {
      void AlertingService.sendAlert({
        title: "Alerta de Fraude: Desvio de Geofence no Escrow",
        message: `Tentativa de liberação/conclusão de agendamento ${bookingId ? `#${bookingId}` : ""} com prestador fora do perímetro contratado (${distanceMeters}m de distância).`,
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
      accuracyM: providerLocation.accuracyM,
      status: "DEVIATION_DETECTED",
      reason,
    }
  }

  return {
    valid: true,
    distanceKm: roundedDistanceKm,
    maxAllowedDistanceKm,
    accuracyM: providerLocation.accuracyM,
    status: "VERIFIED",
  }
}
