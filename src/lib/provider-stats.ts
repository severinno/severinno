/**
 * provider-stats.ts
 *
 * Queries the `mv_provider_stats` materialized view for pre-computed
 * provider statistics (avg rating, review count, completed bookings, favorites).
 *
 * The MV is auto-refreshed by PostgreSQL triggers on Review, Booking, and
 * Favorite tables (see migration 20260724120000_mv_provider_stats).
 *
 * This eliminates the expensive GROUP BY + COUNT subqueries that were
 * previously computed on every provider listing request.
 */

import { db } from "@/lib/db"
import { withCache } from "@/lib/redis"

// Cache TTL for provider stats (30s — balances freshness with performance)
const PROVIDER_STATS_CACHE_TTL = 30

export interface ProviderStatsRow {
  providerId: string
  avgRating: number
  reviewCount: number
  completedBookingCount: number
  favoriteCount: number
}

/**
 * Fetch pre-computed stats for a list of provider IDs from the MV.
 *
 * Returns a Map<providerId, stats> for O(1) lookups.
 * Falls back to empty map if the MV query fails (graceful degradation).
 */
export async function getProviderStatsMap(
  providerIds: string[],
): Promise<Map<string, ProviderStatsRow>> {
  if (providerIds.length === 0) return new Map()

  const cacheKey = `provider-stats:${providerIds.sort().join(",")}`

  try {
    const rows = await withCache<ProviderStatsRow[]>(
      cacheKey,
      async () => {
        // Use raw query since MV is not a Prisma model
        const result = await db.$queryRawUnsafe<ProviderStatsRow[]>(
          `SELECT
            provider_id AS "providerId",
            avg_rating AS "avgRating",
            review_count AS "reviewCount",
            completed_booking_count AS "completedBookingCount",
            favorite_count AS "favoriteCount"
           FROM mv_provider_stats
           WHERE provider_id = ANY($1::text[])`,
          providerIds,
        )
        return result
      },
      PROVIDER_STATS_CACHE_TTL,
    )

    const map = new Map<string, ProviderStatsRow>()
    for (const row of rows) {
      map.set(row.providerId, row)
    }
    return map
  } catch (err) {
    // MV might not exist yet — degrade gracefully
    console.warn("[provider-stats] MV query failed, falling back:", err)
    return new Map()
  }
}

/**
 * Refresh the materialized view (admin-triggered, non-blocking).
 *
 * Uses CONCURRENTLY to avoid locking the view during refresh.
 * Should be called periodically or after bulk data changes.
 */
export async function refreshProviderStats(): Promise<void> {
  try {
    await db.$executeRawUnsafe(
      "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_provider_stats",
    )
  } catch (err) {
    console.warn("[provider-stats] Refresh failed:", err)
  }
}
