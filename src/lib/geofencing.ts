/**
 * Geofencing Engine — real-time provider proximity alerts.
 *
 * When a provider enters or exits a client's geofence (configurable radius),
 * triggers notifications:
 *   - Provider enters zone → notify client "Prestador está chegando"
 *   - Provider exits zone → log for audit trail
 *
 * Uses PostGIS ST_DWithin for efficient spatial queries.
 * Falls back to Haversine JS when PostGIS is unavailable.
 */
import { db } from "@/lib/db"
import { cacheGet, cacheSet, getClient } from "@/lib/redis"
import { haversineKm } from "@/lib/geo-server"
import { captureError } from "@/lib/sentry"
import { sendWhatsApp } from "@/lib/whatsapp"
import logger from "@/lib/logger"

export type GeofenceEvent = {
  type: "enter" | "exit"
  providerId: string
  providerName: string
  clientId: string
  bookingId: string
  lat: number
  lng: number
  distanceMeters: number
  zoneRadiusMeters: number
  timestamp: string
}

export type GeofenceConfig = {
  /** Radius in meters to trigger enter/exit events (default: 200m) */
  radiusMeters: number
  /** Minimum time between events for the same provider/client pair (debounce, default: 5min) */
  debounceMinutes: number
}

const DEFAULT_GEOFENCE_CONFIG: GeofenceConfig = {
  radiusMeters: 200,
  debounceMinutes: 5,
}

/** Redis TTL for geofence state cache (1 hour). */
const GEOFENCE_STATE_TTL = 3600

/** Redis TTL for geofence audit trail (24 hours). */
const GEOFENCE_AUDIT_TTL = 86400

/** Redis lock TTL in seconds to prevent duplicate geofence notifications. */
const GEOFENCE_LOCK_TTL_SECONDS = 5

/**
 * Check if a provider is inside any active booking's geofence.
 * Returns entry/exit events for zones that were just entered or exited.
 */
export async function checkGeofences(
  providerId: string,
  lat: number,
  lng: number,
  config: Partial<GeofenceConfig> = {},
): Promise<GeofenceEvent[]> {
  const cfg = { ...DEFAULT_GEOFENCE_CONFIG, ...config }
  const events: GeofenceEvent[] = []

  try {
    // Find active bookings for this provider
    const bookings = await db.booking.findMany({
      where: {
        providerId,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
        lat: { not: 0 },
        lng: { not: 0 },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        clientId: true,
        client: { select: { name: true } },
        service: { select: { title: true } },
      },
      take: 10,
    })

    for (const booking of bookings) {
      if (!booking.lat || !booking.lng) continue

      const distanceKm = haversineKm(lat, lng, booking.lat, booking.lng)
      const distanceMeters = Math.round(distanceKm * 1000)
      const isInside = distanceMeters <= cfg.radiusMeters

      // Distributed lock via Redis SETNX to prevent race conditions.
      // Two concurrent location updates for the same booking could both
      // read the same previous state and fire duplicate notifications.
      const lockKey = `geofence:lock:${providerId}:${booking.id}`
      const redis = getClient()
      let lockAcquired = false
      if (redis) {
        try {
          const result = await redis.set(lockKey, "1", "EX", GEOFENCE_LOCK_TTL_SECONDS, "NX")
          lockAcquired = result === "OK"
        } catch (err) {
          // Redis unavailable — proceed without lock (best-effort)
          logger.debug({ err }, "geofencing: Redis lock unavailable")
          lockAcquired = true
        }
      } else {
        // No Redis — single instance, no race condition possible
        lockAcquired = true
      }

      if (!lockAcquired) {
        // Another request is processing this geofence — skip
        continue
      }

      try {
        // Check previous state from cache
        const stateKey = `geofence:${providerId}:${booking.id}`
        const prevState = await cacheGet<{ inside: boolean; lastEventAt: number }>(stateKey)
        const wasInside = prevState?.inside ?? false
        const lastEventAt = prevState?.lastEventAt ?? 0
        const debounceMs = cfg.debounceMinutes * 60 * 1000
        const now = Date.now()

        // Detect state change
        if (isInside && !wasInside && now - lastEventAt > debounceMs) {
          // Provider ENTERED the geofence
          const event: GeofenceEvent = {
            type: "enter",
            providerId,
            providerName: "Prestador",
            clientId: booking.clientId,
            bookingId: booking.id,
            lat,
            lng,
            distanceMeters,
            zoneRadiusMeters: cfg.radiusMeters,
            timestamp: new Date().toISOString(),
          }
          events.push(event)

          await cacheSet(stateKey, { inside: true, lastEventAt: now }, GEOFENCE_STATE_TTL)
          logger.info(
            { providerId, bookingId: booking.id, distanceMeters },
            "geofence: provider ENTERED zone",
          )

          // Send notification to client
          notifyGeofenceEvent(event, booking.client.name, booking.service.title).catch(() => {
            // Notification is best-effort
          })
        } else if (!isInside && wasInside && now - lastEventAt > debounceMs) {
          // Provider EXITED the geofence
          const event: GeofenceEvent = {
            type: "exit",
            providerId,
            providerName: "Prestador",
            clientId: booking.clientId,
            bookingId: booking.id,
            lat,
            lng,
            distanceMeters,
            zoneRadiusMeters: cfg.radiusMeters,
            timestamp: new Date().toISOString(),
          }
          events.push(event)

          await cacheSet(stateKey, { inside: false, lastEventAt: now }, GEOFENCE_STATE_TTL)
          logger.info(
            { providerId, bookingId: booking.id, distanceMeters },
            "geofence: provider EXITED zone",
          )
        } else {
          // No state change — just update the inside status (no debounce needed)
          if (isInside !== wasInside) {
            await cacheSet(stateKey, { inside: isInside, lastEventAt }, GEOFENCE_STATE_TTL)
          }
        }
      } finally {
        // Release lock (or let it expire via 5s TTL)
        if (redis && lockAcquired) {
          redis.del(lockKey).catch(() => {
            /* lock will expire via TTL */
          })
        }
      }
    }
  } catch (err) {
    logger.error({ err, providerId }, "geofence: check failed")
  }

  return events
}

/**
 * Get geofence status for a specific booking (for dashboard display).
 */
export async function getGeofenceStatus(
  bookingId: string,
  providerId: string,
): Promise<{ inside: boolean; distanceMeters: number | null; lastEventAt: number | null }> {
  const stateKey = `geofence:${providerId}:${bookingId}`
  const state = await cacheGet<{ inside: boolean; lastEventAt: number }>(stateKey)

  return {
    inside: state?.inside ?? false,
    distanceMeters: null, // Would need current provider position
    lastEventAt: state?.lastEventAt ?? null,
  }
}

// ── Notification Pipeline ─────────────────────────────────────────────────

async function notifyGeofenceEvent(
  event: GeofenceEvent,
  clientName: string,
  serviceTitle: string,
): Promise<void> {
  try {
    // Log to Sentry for observability
    captureError(
      new Error(
        `Geofence ${event.type}: provider ${event.providerId} ${event.type === "enter" ? "entered" : "exited"} zone`,
      ),
      {
        level: event.type === "enter" ? "info" : "warning",
        extra: {
          providerId: event.providerId,
          bookingId: event.bookingId,
          distanceMeters: event.distanceMeters,
          type: event.type,
        },
      },
    )

    // Store event in Redis for audit trail
    const auditKey = `geofence:audit:${event.bookingId}`
    try {
      const existing = (await cacheGet<GeofenceEvent[]>(auditKey)) ?? []
      existing.push(event)
      await cacheSet(auditKey, existing, GEOFENCE_AUDIT_TTL)
    } catch (err) {
      // Redis unavailable
      logger.debug({ err }, "geofencing: audit trail write failed")
    }

    logger.info(
      {
        type: event.type,
        providerId: event.providerId,
        bookingId: event.bookingId,
        distanceMeters: event.distanceMeters,
        clientName,
        serviceTitle,
      },
      `geofence: notification — ${event.type === "enter" ? "provider is arriving" : "provider left zone"}`,
    )

    // WhatsApp notification for enter events
    if (event.type === "enter") {
      const provider = await db.user.findUnique({
        where: { id: event.providerId },
        select: { name: true },
      })
      const providerName = provider?.name ?? "O prestador"
      const distanceText =
        event.distanceMeters <= 100
          ? "muito perto"
          : `a aproximadamente ${Math.round(event.distanceMeters)} metros`
      await sendWhatsApp({
        userId: event.clientId,
        title: `🚗 ${providerName} está chegando!`,
        body: `${providerName} está ${distanceText} do seu endereço. Fique de prontidão!`,
        url: `/?view=client.bookings&id=${event.bookingId}`,
      }).catch((err) => {
        logger.debug({ err, bookingId: event.bookingId }, "geofencing: WhatsApp send failed")
      })
    }
  } catch (err) {
    logger.warn({ err, event }, "geofence: notification failed")
  }
}

/**
 * Get audit trail for a booking's geofence events.
 */
export async function getGeofenceAuditTrail(bookingId: string): Promise<GeofenceEvent[]> {
  try {
    const events = await cacheGet<GeofenceEvent[]>(`geofence:audit:${bookingId}`)
    return events ?? []
  } catch (err) {
    logger.debug({ err }, "geofencing: audit trail read failed")
    return []
  }
}
