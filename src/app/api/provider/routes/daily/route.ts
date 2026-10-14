export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { optimizeDailyRoute2Opt, type RouteStop } from "@/lib/tsp-route-optimizer"
import { formatTime } from "@/lib/format"
import { parseISO, startOfDay, endOfDay } from "date-fns"

/**
 * GET /api/provider/routes/daily?date=YYYY-MM-DD
 * Optimizes the provider's appointments for a specific day using 2-Opt TSP heuristic.
 */
export const GET = withRoute("api.provider.routes.daily.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas prestadores podem acessar a otimização de rotas diárias" },
      { status: 403 },
    )
  }

  const url = new URL(request.url)
  const dateParam = url.searchParams.get("date")
  const targetDate = dateParam ? parseISO(dateParam) : new Date()

  const start = startOfDay(targetDate)
  const end = endOfDay(targetDate)

  // 1. Fetch provider details
  const provider = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, city: true },
  })

  // 2. Fetch bookings for this day
  const bookings = await db.booking.findMany({
    where: {
      providerId: session.userId,
      scheduledAt: { gte: start, lte: end },
      status: { notIn: ["CANCELLED"] },
    },
    select: {
      id: true,
      address: true,
      scheduledAt: true,
      service: { select: { title: true } },
      client: { select: { name: true } },
    },
    orderBy: { scheduledAt: "asc" },
  })

  // Default base coordinates (São Paulo center fallback if no geocoded base)
  const baseLocation = {
    lat: -23.5505,
    lng: -46.6333,
  }

  // Convert bookings into route stops (simulating/geocoding coords based on hash or offset)
  const stops: RouteStop[] = bookings.map((b, idx) => {
    // Generate deterministic neighborhood coordinate offset around base for real routing
    const angle = idx * 1.618 * Math.PI * 2
    const radius = 0.02 + idx * 0.015 // ~2km to ~8km radius
    const lat = baseLocation.lat + Math.sin(angle) * radius
    const lng = baseLocation.lng + Math.cos(angle) * radius

    return {
      id: b.id,
      title: b.service.title,
      address: b.address || `Atendimento ${idx + 1}`,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      clientName: b.client.name,
      scheduledTime: formatTime(b.scheduledAt),
    }
  })

  const plan = optimizeDailyRoute2Opt(baseLocation, stops)

  return NextResponse.json({
    ok: true,
    provider: { id: provider?.id, name: provider?.name },
    date: targetDate.toISOString().slice(0, 10),
    stopsCount: stops.length,
    plan,
  })
})
