/**
 * Admin Demand Heatmap Analytics API
 *
 * GET /api/admin/analytics/demand
 * Returns aggregated geospatial demand points based on quotes and bookings.
 * Clusters coordinates by grid resolution and breaks down by service category.
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { getClient } from "@/lib/redis"
import logger from "@/lib/logger"
import { toMoneyNumber } from "@/lib/money"

const log = logger.child({ module: "analytics-demand-api" })

export type DemandPoint = {
  lat: number
  lng: number
  weight: number // intensity 1-100
  count: number
  category: string
  avgValue: number
}

export type CategoryStat = {
  name: string
  count: number
  percentage: number
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { role: true },
  })
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso negado" }, { status: 403 })
  }

  const { searchParams } = request.nextUrl
  const days = parseInt(searchParams.get("days") || "30", 10)
  const categoryFilter = searchParams.get("category") || "all"

  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const cacheKey = `analytics:demand:grid:${days}:${categoryFilter}`
  const redis = getClient()

  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        return new NextResponse(cached, {
          headers: {
            "Content-Type": "application/json",
            "X-Cache": "HIT",
          },
        })
      }
    } catch {
      // Best effort cache read
    }
  }

  try {
    // 1. Fetch quote requests with coordinates
    const quoteRequests = await db.quoteRequest.findMany({
      where: {
        createdAt: { gte: sinceDate },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        createdAt: true,
        items: {
          select: {
            price: true,
            service: {
              select: {
                title: true,
                category: { select: { name: true } },
              },
            },
          },
        },
      },
    })

    // 2. Fetch bookings with coordinates
    const bookings = await db.booking.findMany({
      where: {
        createdAt: { gte: sinceDate },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        amount: true,
        service: {
          select: {
            title: true,
            category: { select: { name: true } },
          },
        },
      },
    })

    // 3. Grid Clustering (round lat/lng to ~2km grid cell: 0.02 degrees)
    const gridMap = new Map<
      string,
      {
        latSum: number
        lngSum: number
        count: number
        totalValue: number
        categories: Record<string, number>
      }
    >()

    const categoryCounts: Record<string, number> = {}
    let totalItems = 0

    // Process quotes
    for (const q of quoteRequests) {
      if (!q.lat || !q.lng) continue
      const cat = q.items[0]?.service?.category?.name || "Geral"
      if (categoryFilter !== "all" && cat.toLowerCase() !== categoryFilter.toLowerCase()) {
        continue
      }

      totalItems++
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1

      const price = toMoneyNumber(q.items[0]?.price, 150)
      const key = `${q.lat.toFixed(2)},${q.lng.toFixed(2)}`
      const existing = gridMap.get(key) || {
        latSum: 0,
        lngSum: 0,
        count: 0,
        totalValue: 0,
        categories: {},
      }

      existing.latSum += q.lat
      existing.lngSum += q.lng
      existing.count += 1
      existing.totalValue += price
      existing.categories[cat] = (existing.categories[cat] || 0) + 1
      gridMap.set(key, existing)
    }

    // Process bookings
    for (const b of bookings) {
      if (!b.lat || !b.lng) continue
      const cat = b.service?.category?.name || "Geral"
      if (categoryFilter !== "all" && cat.toLowerCase() !== categoryFilter.toLowerCase()) {
        continue
      }

      totalItems++
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1

      const key = `${b.lat.toFixed(2)},${b.lng.toFixed(2)}`
      const existing = gridMap.get(key) || {
        latSum: 0,
        lngSum: 0,
        count: 0,
        totalValue: 0,
        categories: {},
      }

      existing.latSum += b.lat
      existing.lngSum += b.lng
      existing.count += 1
      existing.totalValue += toMoneyNumber(b.amount, 200)
      existing.categories[cat] = (existing.categories[cat] || 0) + 1
      gridMap.set(key, existing)
    }

    // Find max count for weight normalization
    let maxCount = 1
    for (const cluster of gridMap.values()) {
      if (cluster.count > maxCount) maxCount = cluster.count
    }

    // Build demand points
    const points: DemandPoint[] = []
    for (const cluster of gridMap.values()) {
      const dominantCategory =
        Object.entries(cluster.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || "Geral"

      points.push({
        lat: Number((cluster.latSum / cluster.count).toFixed(5)),
        lng: Number((cluster.lngSum / cluster.count).toFixed(5)),
        count: cluster.count,
        weight: Math.min(100, Math.round((cluster.count / maxCount) * 100)),
        category: dominantCategory,
        avgValue: Math.round(cluster.totalValue / cluster.count),
      })
    }

    // Top categories
    const categories: CategoryStat[] = Object.entries(categoryCounts)
      .map(([name, count]) => ({
        name,
        count,
        percentage: totalItems > 0 ? Math.round((count / totalItems) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)

    const responsePayload = {
      points,
      categories,
      summary: {
        totalDemandEvents: totalItems,
        totalClusters: points.length,
        periodDays: days,
      },
    }

    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(responsePayload), "EX", 600) // 10 min TTL
      } catch {
        // Best effort cache write
      }
    }

    return new NextResponse(JSON.stringify(responsePayload), {
      headers: {
        "Content-Type": "application/json",
        "X-Cache": "MISS",
      },
    })
  } catch (err) {
    log.error({ err }, "Error generating demand heatmap")
    return NextResponse.json({ error: "Erro ao carregar mapa de calor" }, { status: 500 })
  }
}
