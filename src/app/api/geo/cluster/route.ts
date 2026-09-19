export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleError } from "@/lib/api-server"
import { isPostGISAvailable } from "@/lib/postgis"
import { withCache } from "@/lib/redis"
import { latLngToH3, h3ToLatLng, h3ToGeoBoundary, h3ResolutionForZoom } from "@/lib/h3-grid"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

/**
 * GET /api/geo/cluster
 *
 * Server-side H3 hexagonal clustering for map viewport queries.
 * Given a bounding box (minLat/minLng/maxLat/maxLng), returns providers
 * grouped into H3 cells. Each cell includes:
 *   - center coordinates (for marker placement)
 *   - provider count
 *   - GeoJSON boundary (for hex rendering)
 *   - provider IDs (for drill-down)
 *
 * Resolutions:
 *   - zoom < 10:  res 6 (~3.2km cells) — city overview
 *   - zoom 10-13: res 7 (~1.2km cells) — neighborhood
 *   - zoom 14+:   res 8 (~460m cells) — street level
 *
 * Query params:
 *   - minLat, minLng, maxLat, maxLng (required)
 *   - zoom (optional, default 12)
 *   - categoryId (optional)
 *   - limit (optional, default 500)
 *
 * Cached for 30 seconds per viewport + zoom combination.
 */

type ClusterCell = {
  h3Index: string
  center: { lat: number; lng: number }
  count: number
  boundary: Array<[number, number]>
  providerIds: string[]
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    await assertRateLimit(request, RATE_LIMITS.geo)
    const minLat = Number(searchParams.get("minLat"))
    const minLng = Number(searchParams.get("minLng"))
    const maxLat = Number(searchParams.get("maxLat"))
    const maxLng = Number(searchParams.get("maxLng"))
    const zoom = Number(searchParams.get("zoom") ?? "12")
    const categoryId = searchParams.get("categoryId") || undefined
    const rawLimit = Number(searchParams.get("limit") ?? "500")
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 1000) : 500

    // Validate bounding box
    if (
      !Number.isFinite(minLat) ||
      !Number.isFinite(minLng) ||
      !Number.isFinite(maxLat) ||
      !Number.isFinite(maxLng)
    ) {
      return NextResponse.json(
        { error: "Parâmetros minLat, minLng, maxLat, maxLng são obrigatórios" },
        { status: 400 },
      )
    }

    // Limit bounding box size to prevent full-table scans (max ~200km per side)
    const bboxLatSpan = Math.abs(maxLat - minLat)
    const bboxLngSpan = Math.abs(maxLng - minLng)
    if (bboxLatSpan > 2 || bboxLngSpan > 2) {
      return NextResponse.json(
        { error: "Bounding box excede o tamanho máximo permitido (2° por lado)" },
        { status: 400 },
      )
    }

    // Check PostGIS availability
    let pgAvailable = false
    try {
      pgAvailable = await isPostGISAvailable()
    } catch (err) {
      logger.debug(
        { err },
        "[geo-cluster] postgis availability check failed, falling back to prisma",
      )
      pgAvailable = false
    }

    const resolution = h3ResolutionForZoom(zoom)
    const cacheKey = `cluster:${minLat.toFixed(3)}:${minLng.toFixed(3)}:${maxLat.toFixed(3)}:${maxLng.toFixed(3)}:${resolution}:${categoryId ?? "all"}`

    const cells = await withCache<ClusterCell[]>(
      cacheKey,
      async () => {
        if (pgAvailable) {
          return await clusterWithPostGIS(
            minLat,
            minLng,
            maxLat,
            maxLng,
            resolution,
            categoryId,
            limit,
          )
        }
        return await clusterWithPrisma(
          minLat,
          minLng,
          maxLat,
          maxLng,
          resolution,
          categoryId,
          limit,
        )
      },
      30, // 30s cache
    )

    return NextResponse.json({
      cells,
      resolution,
      zoom,
      bbox: { minLat, minLng, maxLat, maxLng },
      totalProviders: cells.reduce((sum, c) => sum + c.count, 0),
      cellCount: cells.length,
    })
  } catch (e) {
    return handleError(e)
  }
}

/**
 * PostGIS path: uses ST_MakeEnvelope for fast spatial filtering,
 * then clusters results in TypeScript via H3.
 */
async function clusterWithPostGIS(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  resolution: number,
  categoryId: string | undefined,
  limit: number,
): Promise<ClusterCell[]> {
  const rows = categoryId
    ? await db.$queryRaw<Array<{ id: string; lat: number; lng: number }>>`
        SELECT u.id, u.lat, u.lng
        FROM "User" u
        WHERE
          u.role = 'PROVIDER'
          AND u.active = true
          AND u."deletedAt" IS NULL
          AND u.lat IS NOT NULL
          AND u.lng IS NOT NULL
          AND u.location IS NOT NULL
          AND u.location && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)::geography
          AND u."id" IN (
            SELECT s."providerId" FROM "Service" s
            WHERE s."categoryId" = ${categoryId} AND s.active = true
          )
        LIMIT ${limit}
      `
    : await db.$queryRaw<Array<{ id: string; lat: number; lng: number }>>`
        SELECT u.id, u.lat, u.lng
        FROM "User" u
        WHERE
          u.role = 'PROVIDER'
          AND u.active = true
          AND u."deletedAt" IS NULL
          AND u.lat IS NOT NULL
          AND u.lng IS NOT NULL
          AND u.location IS NOT NULL
          AND u.location && ST_MakeEnvelope(${minLng}, ${minLat}, ${maxLng}, ${maxLat}, 4326)::geography
        LIMIT ${limit}
      `

  return buildClusterCells(rows, resolution)
}

/**
 * Prisma fallback: uses findMany with lat/lng bounds filter.
 * Slower than PostGIS but works without the spatial extension.
 */
async function clusterWithPrisma(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  resolution: number,
  categoryId: string | undefined,
  limit: number,
): Promise<ClusterCell[]> {
  const where: Record<string, unknown> = {
    role: "PROVIDER",
    active: true,
    deletedAt: null,
    lat: { gte: minLat, lte: maxLat },
    lng: { gte: minLng, lte: maxLng },
  }

  if (categoryId) {
    const services = await db.service.findMany({
      where: { categoryId, active: true },
      select: { providerId: true },
    })
    const providerIds = [...new Set(services.map((s) => s.providerId))]
    if (providerIds.length === 0) return []
    where.id = { in: providerIds }
  }

  const users = await db.user.findMany({
    where: where as never,
    select: { id: true, lat: true, lng: true },
    take: limit,
  })

  return buildClusterCells(
    users
      .filter((u) => u.lat != null && u.lng != null)
      .map((u) => ({
        id: u.id,
        lat: u.lat!,
        lng: u.lng!,
      })),
    resolution,
  )
}

/**
 * Build H3 cluster cells from a flat list of providers.
 * Groups by H3 index, computes center + boundary for each cell.
 */
function buildClusterCells(
  rows: Array<{ id: string; lat: number; lng: number }>,
  resolution: number,
): ClusterCell[] {
  const groups = new Map<string, string[]>()

  for (const row of rows) {
    const h3Index = latLngToH3(row.lat, row.lng, resolution)
    const existing = groups.get(h3Index)
    if (existing) {
      existing.push(row.id)
    } else {
      groups.set(h3Index, [row.id])
    }
  }

  const cells: ClusterCell[] = []

  for (const [h3Index, providerIds] of groups.entries()) {
    const center = h3ToLatLng(h3Index)
    const boundary = h3ToGeoBoundary(h3Index)

    cells.push({
      h3Index,
      center,
      count: providerIds.length,
      boundary,
      providerIds,
    })
  }

  // Sort by count descending (densest clusters first)
  return cells.sort((a, b) => b.count - a.count)
}
