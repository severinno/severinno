export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { cacheControlPublic, noStoreJson } from "@/lib/api-server"
import { withCache } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"

/**
 * Public density metrics for radius suggestions (aggregate only, no PII).
 *
 * GET /api/providers/density?lat=&lng=
 *
 * Two aggregate shapes in ONE response, computed from the same filters as the
 * public catalog (role=PROVIDER, active, verified, not deleted, has location):
 *
 *   rings     — how many providers lie within each canonical radius
 *               (1, 2, 5, 10, 15, 25, 50 km). One PostGIS pass with FILTER;
 *               this is the geometric density that the client-side radius
 *               suggestion (src/lib/geo-radius.ts → refineRadiusWithDensity)
 *               uses to shrink/grow the accuracy-based suggestion.
 *   districts — density per NEIGHBORHOOD (User.district, "bairro"): providers
 *               within 25 km grouped by district, ordered by count, with the
 *               distance of the closest provider of that district. Purely
 *               informational (UI hint: "bairro mais denso: X").
 *
 * Everything is COUNT/GROUP-BY aggregation — no provider rows, no PII, same
 * allowlist spirit as the public catalog. Coordinates are rounded to 2
 * decimals for the cache key (~1.1 km cells, TTL 5 min): density changes on
 * seed/reindex timescales, not per-request.
 */

const RING_RADII_KM = [1, 2, 5, 10, 15, 25, 50] as const
const DISTRICT_WINDOW_KM = 25
const DISTRICT_LIMIT = 8

const BASE_FILTERS = `
  u.role = 'PROVIDER'
  AND u.active = true
  AND u.verified = true
  AND u."deletedAt" IS NULL
  AND u.location IS NOT NULL`

type RingsRow = {
  r1: number
  r2: number
  r5: number
  r10: number
  r15: number
  r25: number
  r50: number
}
type DistrictRow = {
  district: string
  city: string | null
  count: number
  minDistanceKm: number | null
}

async function computeDensity(lat: number, lng: number) {
  const ringsPromise = db.$queryRawUnsafe<RingsRow[]>(
    `SELECT
       COUNT(*) FILTER (WHERE ST_DWithin(u.location, c.center, $3))::int  AS "r1",
       COUNT(*) FILTER (WHERE ST_DWithin(u.location, c.center, $4))::int  AS "r2",
       COUNT(*) FILTER (WHERE ST_DWithin(u.location, c.center, $5))::int  AS "r5",
       COUNT(*) FILTER (WHERE ST_DWithin(u.location, c.center, $6))::int  AS "r10",
       COUNT(*) FILTER (WHERE ST_DWithin(u.location, c.center, $7))::int  AS "r15",
       COUNT(*) FILTER (WHERE ST_DWithin(u.location, c.center, $8))::int  AS "r25",
       COUNT(*) FILTER (WHERE ST_DWithin(u.location, c.center, $9))::int  AS "r50"
     FROM "User" u
     CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS center) c
     WHERE ${BASE_FILTERS}
       AND ST_DWithin(u.location, c.center, 50000)`,
    lng,
    lat,
    ...RING_RADII_KM.map((km) => km * 1000),
  )

  const districtsPromise = db.$queryRawUnsafe<DistrictRow[]>(
    `SELECT u.district,
            MAX(u.city) AS city,
            COUNT(*)::int AS count,
            MIN(ST_Distance(u.location, c.center))::float / 1000.0 AS "minDistanceKm"
     FROM "User" u
     CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS center) c
     WHERE ${BASE_FILTERS}
       AND u.district IS NOT NULL
       AND u.district <> ''
       AND ST_DWithin(u.location, c.center, $3)
     GROUP BY u.district
     ORDER BY count DESC, u.district ASC
     LIMIT $4`,
    lng,
    lat,
    DISTRICT_WINDOW_KM * 1000,
    DISTRICT_LIMIT,
  )

  const [ringsRows, districtRows] = await Promise.all([ringsPromise, districtsPromise])

  const counts = ringsRows[0] ?? { r1: 0, r2: 0, r5: 0, r10: 0, r15: 0, r25: 0, r50: 0 }
  const rings = RING_RADII_KM.map((radiusKm) => ({
    radiusKm,
    count: Math.max(0, Number(counts[`r${radiusKm}` as keyof RingsRow] ?? 0)),
  }))

  return {
    rings,
    districts: districtRows.map((d) => ({
      district: String(d.district),
      city: d.city ?? null,
      count: Math.max(0, Number(d.count ?? 0)),
      minDistanceKm:
        d.minDistanceKm == null || !Number.isFinite(Number(d.minDistanceKm))
          ? null
          : Math.round(Number(d.minDistanceKm) * 100) / 100,
    })),
  }
}

export const GET = withRoute("api.providers.density.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.providers)
  const { searchParams } = new URL(request.url)
  // Não usar Number(param) direto: Number(null) === 0 (e "" → 0) faria uma
  // requisição sem coordenadas virar consulta no ponto (0, 0).
  const latRaw = searchParams.get("lat")?.trim()
  const lngRaw = searchParams.get("lng")?.trim()
  const lat = Number(latRaw)
  const lng = Number(lngRaw)

  if (
    !latRaw ||
    !lngRaw ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return noStoreJson({ error: "Coordenadas 'lat' e 'lng' inválidas" }, { status: 400 })
  }

  // ~1.1 km cache cells: suggestions don't need pinpoint accuracy and nearby
  // GPS fixes share one cache entry.
  const latR = lat.toFixed(2)
  const lngR = lng.toFixed(2)
  const data = await withCache(
    `providers:density:${latR}:${lngR}`,
    () => computeDensity(lat, lng),
    300,
  )

  return cacheControlPublic(NextResponse.json(data), 120)
})
