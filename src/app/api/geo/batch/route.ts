export const dynamic = "force-dynamic"

/**
 * POST /api/geo/batch — Batch geocoding endpoint.
 *
 * Geocodes up to 50 addresses in a single request.
 * Uses PostGIS local DB first (fast), falls back to Nominatim for unknown addresses.
 *
 * Body: { addresses: string[], limit?: number }
 * Response: { results: Array<{ query, lat, lng, displayName, source }> }
 */
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { withCache } from "@/lib/redis"
import { trackGeoLatency } from "@/lib/geo-metrics"
import { rateLimitedNominatim } from "@/lib/nominatim-rate-limit"
import { nominatimBreaker } from "@/lib/geo-circuit-breakers"
import { getGeoSettings } from "@/lib/geo-settings"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { z } from "zod"
import { parseBody } from "@/lib/api-middleware"

const geoBatchSchema = z.object({
  addresses: z.array(z.string().min(1).max(500)).min(1).max(50),
})

type BatchResult = {
  query: string
  lat: number | null
  lng: number | null
  displayName: string | null
  source: "local-db" | "nominatim" | "not-found"
}

async function geocodeLocal(
  address: string,
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  try {
    const q = address.trim()
    if (!q) return null

    // Try exact city match first (B-tree index)
    const users = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        lat: { not: null },
        lng: { not: null },
        OR: [
          { city: { equals: q, mode: "insensitive" } },
          { city: { startsWith: q, mode: "insensitive" } },
          { street: { contains: q, mode: "insensitive" } },
          { district: { contains: q, mode: "insensitive" } },
        ],
      },
      select: { lat: true, lng: true, street: true, district: true, city: true, state: true },
      take: 1,
      orderBy: { avgRating: "desc" },
    })

    if (users.length > 0 && users[0]!.lat != null && users[0]!.lng != null) {
      const u = users[0]!
      return {
        lat: u.lat!,
        lng: u.lng!,
        displayName: [u.street, u.district, u.city, u.state].filter(Boolean).join(", "),
      }
    }
    return null
  } catch {
    return null
  }
}

async function geocodeNominatim(
  address: string,
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  try {
    const settings = await getGeoSettings()
    if (!settings.nominatimEnabled) return null

    const result = await nominatimBreaker.execute(async () => {
      const url = `${settings.nominatimBaseUrl}/search?format=jsonv2&q=${encodeURIComponent(address)}&limit=1&accept-language=pt-BR`
      const r = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": settings.userAgent },
        signal: AbortSignal.timeout(5000),
      })
      if (!r.ok) throw new Error(`Nominatim HTTP ${r.status}`)
      return r.json()
    })

    const data = result as Array<{ lat: string; lon: string; display_name?: string }>
    if (data.length > 0) {
      return {
        lat: Number.parseFloat(data[0]!.lat),
        lng: Number.parseFloat(data[0]!.lon),
        displayName: data[0]!.display_name ?? address,
      }
    }
    return null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    // Batch is expensive (up to 50 Nominatim calls per request) — strict limit
    await assertRateLimit(request, RATE_LIMITS.geoBatch)
    const { addresses } = await parseBody(request, geoBatchSchema)

    // Process sequentially with 1s delay between Nominatim calls
    // (Nominatim rate limit: 1 req/s). Local DB hits are instant.
    const results: BatchResult[] = []
    let lastNominatimCall = 0

    for (const address of addresses) {
      const trimmed = address.trim()
      if (!trimmed) {
        results.push({
          query: address,
          lat: null,
          lng: null,
          displayName: null,
          source: "not-found",
        })
        continue
      }

      // Try cache first
      const cacheKey = `geo:batch:${trimmed.toLowerCase()}`
      const cached = await withCache<{
        lat: number
        lng: number
        displayName: string
        source: string
      } | null>(
        cacheKey,
        async () => {
          // Try local DB first (fast, no rate limit)
          const local = await geocodeLocal(trimmed)
          if (local) return { ...local, source: "local-db" }

          // Respect Nominatim 1 req/s rate limit
          const now = Date.now()
          const elapsed = now - lastNominatimCall
          if (elapsed < 1000) {
            await new Promise((r) => setTimeout(r, 1000 - elapsed))
          }
          lastNominatimCall = Date.now()

          // Fall back to Nominatim
          const result = await trackGeoLatency("nominatim", () =>
            rateLimitedNominatim(() => geocodeNominatim(trimmed)),
          )
          return result ? { ...result, source: "nominatim" } : null
        },
        86400, // 24h cache
      )

      if (cached) {
        results.push({
          query: address,
          lat: cached.lat,
          lng: cached.lng,
          displayName: cached.displayName,
          source: cached.source as "local-db" | "nominatim",
        })
      } else {
        results.push({
          query: address,
          lat: null,
          lng: null,
          displayName: null,
          source: "not-found",
        })
      }
    }

    const found = results.filter((r) => r.lat !== null).length

    return NextResponse.json({
      results,
      stats: {
        total: addresses.length,
        found,
        notFound: addresses.length - found,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
