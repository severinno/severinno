/**
 * Provider Location Cache — 3-tier location lookup with Redis GEO.
 *
 * Tier 1: In-memory Map (< 1ms)
 * Tier 2: Redis GEO sorted set (< 5ms, shared across instances)
 * Tier 3: PostGIS ST_DWithin (< 50ms, always available)
 *
 * Used by: geofencing, reverseGeocodeLocal, searchNearbyProvidersFast
 */
import { db } from "@/lib/db"
import { cacheGet, cacheSet, getClient } from "@/lib/redis"
import { haversineKm } from "@/lib/geo-shared"
import logger from "./logger"

const REDIS_GEO_KEY = "geo:provider-locations"
const CACHE_TTL_S = 3600 // 1h

// ── In-memory tier ────────────────────────────────────────────────────────

interface LocationEntry {
  lat: number
  lng: number
  updatedAt: number
}

const memoryStore = new Map<string, LocationEntry>()

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Cache a provider's location across all tiers.
 */
export async function cacheProviderLocation(
  providerId: string,
  lat: number,
  lng: number,
): Promise<void> {
  if (!providerId || !lat || !lng) return

  // Tier 1: In-memory
  memoryStore.set(providerId, { lat, lng, updatedAt: Date.now() })

  // Tier 2: Redis GEO
  try {
    const client = getClient()
    if (client) {
      await client.geoadd(REDIS_GEO_KEY, lng, lat, providerId)
    }
  } catch {
    // Redis unavailable
  }

  // Tier 3: Cache individual lookup
  try {
    await cacheSet(`geo:location:${providerId}`, { lat, lng }, CACHE_TTL_S)
  } catch {
    // Cache unavailable
  }
}

/**
 * Get a provider's cached location (3-tier lookup).
 */
export async function getCachedProviderLocation(
  providerId: string,
): Promise<{ lat: number; lng: number } | null> {
  // Tier 1: In-memory
  const mem = memoryStore.get(providerId)
  if (mem) return { lat: mem.lat, lng: mem.lng }

  // Tier 2: Redis cache
  try {
    const cached = await cacheGet<{ lat: number; lng: number }>(`geo:location:${providerId}`)
    if (cached) {
      memoryStore.set(providerId, { ...cached, updatedAt: Date.now() })
      return cached
    }
  } catch {
    // Redis unavailable
  }

  // Tier 3: PostGIS
  try {
    const user = await db.user.findUnique({
      where: { id: providerId },
      select: { lat: true, lng: true },
    })
    if (user?.lat && user?.lng) {
      const loc = { lat: user.lat, lng: user.lng }
      memoryStore.set(providerId, { ...loc, updatedAt: Date.now() })
      try { await cacheSet(`geo:location:${providerId}`, loc, CACHE_TTL_S) } catch { /* */ }
      return loc
    }
  } catch {
    // DB unavailable
  }

  return null
}

/**
 * Find nearest provider using cached locations (sub-5ms with in-memory tier).
 */
export async function findNearestCached(
  centerLat: number,
  centerLng: number,
  radiusKm: number = 25,
  limit: number = 10,
): Promise<Array<{ id: string; distanceKm: number }>> {
  // Tier 1: In-memory scan
  if (memoryStore.size > 0) {
    const nearby: Array<{ id: string; distanceKm: number }> = []
    for (const [id, loc] of memoryStore.entries()) {
      const dist = haversineKm(centerLat, centerLng, loc.lat, loc.lng)
      if (dist <= radiusKm) {
        nearby.push({ id, distanceKm: Math.round(dist * 10) / 10 })
      }
    }
    if (nearby.length > 0) {
      nearby.sort((a, b) => a.distanceKm - b.distanceKm)
      return nearby.slice(0, limit)
    }
  }

  // Tier 2: Redis GEO
  try {
    const client = getClient()
    if (client) {
      const results = await client.georadius(
        REDIS_GEO_KEY, centerLng, centerLat, radiusKm, "km",
        "WITHDIST", "COUNT", limit, "ASC",
      )
      if (results.length > 0) {
        return results.map((r) => {
          const [id, dist] = r as [string, string]
          return { id, distanceKm: Math.round(Number(dist) * 10) / 10 }
        })
      }
    }
  } catch {
    // Redis unavailable
  }

  // Tier 3: PostGIS
  try {
    const rows = await db.$queryRaw<Array<{ id: string; distance_km: number }>>`
      SELECT id, ST_Distance(
        location,
        ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)::geography
      ) / 1000 AS distance_km
      FROM "User"
      WHERE role = 'PROVIDER' AND active = true AND "deletedAt" IS NULL
        AND location IS NOT NULL
        AND ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint(${centerLng}, ${centerLat}), 4326)::geography,
          ${radiusKm * 1000}
        )
      ORDER BY distance_km ASC
      LIMIT ${limit}
    `
    return rows.map((r) => ({ id: r.id, distanceKm: Math.round(r.distance_km * 10) / 10 }))
  } catch {
    return []
  }
}

/**
 * Seed all active providers into the in-memory + Redis GEO tiers.
 * Called on server startup.
 */
export async function seedProviderLocations(): Promise<number> {
  try {
    const providers = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        deletedAt: null,
        lat: { not: null },
        lng: { not: null },
      },
      select: { id: true, lat: true, lng: true },
    })

    let count = 0
    const client = getClient()

    for (const p of providers) {
      if (p.lat && p.lng) {
        memoryStore.set(p.id, { lat: p.lat, lng: p.lng, updatedAt: Date.now() })
        count++
      }
    }

    // Batch GEOADD to Redis (pipeline for performance)
    if (client && providers.length > 0) {
      const pipeline = client.pipeline()
      for (const p of providers) {
        if (p.lat && p.lng) {
          pipeline.geoadd(REDIS_GEO_KEY, p.lng, p.lat, p.id)
        }
      }
      await pipeline.exec()
    }

    logger.info({ count, redisPipeline: !!client }, "geo-location-cache: seeded provider locations")
    return count
  } catch (err) {
    logger.warn({ err }, "geo-location-cache: failed to seed from DB")
    return 0
  }
}

/**
 * Get cache stats for monitoring.
 */
export function getLocationCacheStats(): {
  memoryEntries: number
  redisKey: string
} {
  return {
    memoryEntries: memoryStore.size,
    redisKey: REDIS_GEO_KEY,
  }
}
