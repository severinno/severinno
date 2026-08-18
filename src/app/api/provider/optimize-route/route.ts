import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { optimizeDailyRoute, type RouteStop } from "@/lib/route-optimizer"
import { forbidden, badRequest, handleError } from "@/lib/api-server"
import { startOfDay, endOfDay, parseISO } from "date-fns"

/**
 * GET /api/provider/optimize-route?date=YYYY-MM-DD
 * Returns the optimal visiting order for all bookings on a given day,
 * including total km savings and estimated time between stops.
 */
export async function GET(request: Request) {
  try {
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito a prestadores")
    }

    const { searchParams } = new URL(request.url)
    const dateStr = searchParams.get("date")

    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw badRequest("Parâmetro 'date' obrigatório no formato YYYY-MM-DD")
    }

    const targetDate = parseISO(dateStr)
    const dayStart = startOfDay(targetDate)
    const dayEnd = endOfDay(targetDate)

    // 1. Fetch provider base location
    const provider = await db.user.findUnique({
      where: { id: session.userId },
      select: { lat: true, lng: true, name: true },
    })

    if (!provider?.lat || !provider?.lng) {
      return NextResponse.json({
        ok: false,
        error: "Defina seu endereço base no perfil para usar o otimizador de rotas",
      }, { status: 422 })
    }

    // 2. Fetch confirmed bookings for the day
    const bookings = await db.booking.findMany({
      where: {
        providerId: session.userId,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
        scheduledAt: { gte: dayStart, lte: dayEnd },
        lat: { not: 0 },
        lng: { not: 0 },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        scheduledAt: true,
        client: { select: { name: true, district: true } },
        service: { select: { title: true } },
      },
      orderBy: { scheduledAt: "asc" },
    })

    if (bookings.length === 0) {
      return NextResponse.json({
        ok: true,
        date: dateStr,
        message: "Nenhum agendamento confirmado com endereço para esta data",
        orderedStops: [],
        totalDistanceKm: 0,
        totalDurationMin: 0,
        savingsVsOriginalKm: 0,
        savingsPercent: 0,
      })
    }

    // 3. Build stops list
    const stops: RouteStop[] = bookings.map((b) => ({
      id: b.id,
      label: `${b.service.title} — ${b.client.name} (${b.client.district ?? ""})`,
      lat: b.lat,
      lng: b.lng,
      scheduledAt: b.scheduledAt,
    }))

    // 4. Optimize the route
    const result = await optimizeDailyRoute(
      { lat: provider.lat, lng: provider.lng },
      stops,
    )

    return NextResponse.json({
      ok: true,
      date: dateStr,
      providerBase: { name: provider.name, lat: provider.lat, lng: provider.lng },
      ...result,
    })
  } catch (e) {
    return handleError(e)
  }
}
