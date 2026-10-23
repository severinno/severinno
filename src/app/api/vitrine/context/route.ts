export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { cacheControlPublic } from "@/lib/api-server"
import { withCache } from "@/lib/redis"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"
import { resolveRegionalContext } from "@/lib/regional-intelligence/engine"
import type { WeatherCondition, RegionalContext } from "@/lib/regional-intelligence/types"

export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)

    const { searchParams } = new URL(request.url)
    const latStr = searchParams.get("lat")
    const lngStr = searchParams.get("lng")
    const cityParam = searchParams.get("city")
    const stateParam = searchParams.get("state")
    const weatherParam = searchParams.get("weather") as WeatherCondition | null

    const lat = latStr ? parseFloat(latStr) : null
    const lng = lngStr ? parseFloat(lngStr) : null
    const city = cityParam || "Governador Valadares"
    const state = stateParam || "MG"

    const citySlug = city
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "-")

    const cacheKey = `vitrine:context:${citySlug}:${weatherParam ?? "auto"}`

    const contextData = await withCache(cacheKey, async (): Promise<RegionalContext> => {
      let activeProvidersCount = 18
      let bookingsLast24h = 24
      let topServiceName = "Técnico Especializado"

      try {
        const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

        const [providersCount, bookingsCount, recentBooking] = await Promise.all([
          db.user.count({
            where: {
              role: "PROVIDER",
              city: { contains: city, mode: "insensitive" },
            },
          }),
          db.booking.count({
            where: {
              createdAt: { gte: since24h },
            },
          }),
          db.booking.findFirst({
            where: {
              createdAt: { gte: since24h },
            },
            include: {
              service: {
                select: { title: true },
              },
            },
            orderBy: { createdAt: "desc" },
          }),
        ])

        if (providersCount > 0) activeProvidersCount = providersCount
        if (bookingsCount > 0) bookingsLast24h = bookingsCount
        if (recentBooking?.service?.title) topServiceName = recentBooking.service.title
      } catch (dbErr) {
        logger.warn(dbErr, "[VitrineContext] Falling back to heuristic platform events metrics")
      }

      return resolveRegionalContext({
        lat,
        lng,
        city,
        state,
        forcedWeather: weatherParam ?? undefined,
        platformEvents: {
          activeProvidersNearby: activeProvidersCount,
          bookingsLast24h,
          topTrendingServiceName: topServiceName,
          demandSpike: true,
          recentSocialProofNotice: `${bookingsLast24h} serviços agendados recentemente em ${city} e região`,
        },
      })
    })

    return cacheControlPublic(NextResponse.json(contextData, { status: 200 }), 60)
  } catch (error) {
    logger.error(error, "[VitrineContext] Failed to resolve regional context")
    // Safe graceful degradation fallback
    const fallback = resolveRegionalContext()
    return cacheControlPublic(NextResponse.json(fallback, { status: 200 }), 30)
  }
}
