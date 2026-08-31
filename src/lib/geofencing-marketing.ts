/**
 * Geofencing Marketing Engine — proactive client notifications.
 *
 * When a provider enters a zone with active potential clients:
 *   - Sends push notification: "⚡ {provider} está perto de você!"
 *   - Includes deep link to provider profile
 *
 * Uses PostGIS ST_DWithin for efficient spatial queries.
 * Debounced per client/provider pair to avoid notification spam.
 */
import { db } from "@/lib/db"
import { getClient } from "@/lib/redis"
import logger from "@/lib/logger"

const MARKETING_DEBOUNCE_KEY = "geo:marketing:debounce:"
const MARKETING_DEBOUNCE_MINUTES = 60 // Notify max once per hour per pair
const MARKETING_RADIUS_KM = 5 // Notify clients within 5km of provider

type MarketingGeofenceResult = {
  notified: number
  skipped: number
  errors: number
}

/**
 * Check nearby clients and send marketing push notifications.
 * Called when a provider updates their location.
 */
export async function triggerMarketingGeofence(
  providerId: string,
  providerName: string,
  lat: number,
  lng: number,
): Promise<MarketingGeofenceResult> {
  const result = { notified: 0, skipped: 0, errors: 0 }

  try {
    // Find active clients within radius who have location set
    const nearbyClients = await db.$queryRaw<
      Array<{ id: string; name: string; distance_km: number }>
    >`
      SELECT u.id, u.name,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(u."lat", u."lng"), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)::geography
        ) / 1000.0 AS distance_km
      FROM "User" u
      WHERE u.role = 'CLIENT'
        AND u.active = true
        AND u.lat IS NOT NULL
        AND u.lng IS NOT NULL
        AND u.id != ${providerId}
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint(u."lat", u."lng"), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${lng}::float, ${lat}::float), 4326)::geography,
          ${MARKETING_RADIUS_KM * 1000}
        )
      ORDER BY distance_km ASC
      LIMIT 50
    `

    for (const client of nearbyClients) {
      const debounceKey = `${MARKETING_DEBOUNCE_KEY}${providerId}:${client.id}`

      // Check debounce
      const redisClient = getClient()
      if (redisClient) {
        const lastNotified = await redisClient.get(debounceKey)
        if (lastNotified) {
          result.skipped++
          continue
        }
      }

      // Send push notification
      try {
        await db.notification.create({
          data: {
            userId: client.id,
            type: "PROVIDER_NEARBY",
            title: `⚡ ${providerName} está perto de você!`,
            body: `A ${Math.round(client.distance_km * 10)}00m de distância. Confira os serviços disponíveis.`,
            read: false,
          },
        })

        // Set debounce
        if (redisClient) {
          await redisClient.setex(
            debounceKey,
            MARKETING_DEBOUNCE_MINUTES * 60,
            Date.now().toString(),
          )
        }

        result.notified++
      } catch (err) {
        logger.error({ err, clientId: client.id }, "marketing geofence push failed")
        result.errors++
      }
    }
  } catch (err) {
    logger.error({ err, providerId }, "marketing geofence query failed")
    result.errors++
  }

  if (result.notified > 0) {
    logger.info(
      { providerId, ...result },
      "marketing geofence triggered",
    )
  }

  return result
}
