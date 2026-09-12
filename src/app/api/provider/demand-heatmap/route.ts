export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, handleError } from "@/lib/api-server"
import { haversineKm } from "@/lib/geo-server"
import { latLngToH3, h3ToLatLng, h3ResolutionForZoom } from "@/lib/h3-grid"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export type HeatmapPoint = {
  lat: number
  lng: number
  weight: number // 0.1 to 1.0
  count: number
  label?: string
}

/**
 * GET /api/provider/demand-heatmap
 * Returns aggregated geospatial demand points (search activity, quotes, bookings)
 * around the provider's operating base.
 */

export async function GET(request: Request) {
  try {
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito a prestadores e administradores")
    }
    await assertRateLimit(request, RATE_LIMITS.general)

    const { searchParams } = new URL(request.url)
    const zoomParam = searchParams.get("zoom")
    const rawZoom = zoomParam ? Number(zoomParam) : 12
    const zoom = Number.isFinite(rawZoom) ? Math.max(0, Math.min(22, Math.round(rawZoom))) : 12
    const h3Res = h3ResolutionForZoom(zoom)

    const provider = await db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, lat: true, lng: true, radiusKm: true, city: true },
    })

    const centerLat = provider?.lat ?? Number(process.env.DEFAULT_CENTER_LAT ?? -23.5505)
    const centerLng = provider?.lng ?? Number(process.env.DEFAULT_CENTER_LNG ?? -46.6333)
    const radius = provider?.radiusKm ?? 25

    // 1. Fetch recent bookings with location
    const recentBookings = await db.booking.findMany({
      where: {
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        lat: { not: 0 },
      },
      select: {
        lat: true,
        lng: true,
        service: { select: { title: true } },
      },
      take: 100,
    })

    // 2. Aggregate points into H3 hexagonal clusters (~1.2km per cell at res 7)
    const clusters = new Map<
      string,
      { lat: number; lng: number; count: number; labels: Set<string> }
    >()

    for (const b of recentBookings) {
      if (!b.lat || !b.lng) continue
      const dist = haversineKm(centerLat, centerLng, b.lat, b.lng)
      if (dist > radius * 1.5) continue

      const h3Index = latLngToH3(b.lat, b.lng, h3Res)
      const existing = clusters.get(h3Index)
      if (existing) {
        existing.count++
        if (b.service.title) existing.labels.add(b.service.title)
      } else {
        const center = h3ToLatLng(h3Index)
        clusters.set(h3Index, {
          lat: center.lat,
          lng: center.lng,
          count: 1,
          labels: b.service.title ? new Set([b.service.title]) : new Set(),
        })
      }
    }

    // 3. Normalize weights
    const clusterList = Array.from(clusters.values())
    const maxCount = Math.max(1, ...clusterList.map((c) => c.count))

    const points: HeatmapPoint[] = clusterList.map((c) => ({
      lat: c.lat,
      lng: c.lng,
      weight: Math.round((c.count / maxCount) * 10) / 10,
      count: c.count,
      label: c.labels.size > 0 ? Array.from(c.labels).slice(0, 3).join(", ") : undefined,
    }))

    return NextResponse.json({
      center: { lat: centerLat, lng: centerLng },
      radiusKm: radius,
      city: provider?.city || "Região",
      totalDemandEvents: clusterList.reduce((a, b) => a + b.count, 0),
      h3Resolution: h3Res,
      zoom,
      points,
    })
  } catch (e) {
    return handleError(e)
  }
}
