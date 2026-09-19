export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleError, notFound } from "@/lib/api-server"
import { getRoute } from "@/lib/routing"
import { requireUser } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.general)
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const latStr = searchParams.get("lat")
    const lngStr = searchParams.get("lng")

    const booking = await db.booking.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        scheduledAt: true,
        address: true,
        createdAt: true,
        lat: true,
        lng: true,
        clientId: true,
        providerId: true,
        provider: { select: { id: true, name: true, avatarUrl: true } },
        client: { select: { id: true, name: true } },
        service: { select: { id: true, title: true, basePrice: true } },
        amount: true,
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")

    if (
      session.userId !== booking.clientId &&
      session.userId !== booking.providerId &&
      session.role !== "ADMIN"
    ) {
      return NextResponse.json({ error: "Acesso restrito" }, { status: 403 })
    }

    const { clientId: _, providerId: __, ...bookingSafe } = booking

    let routeInfo: {
      distanceKm: number
      durationMin: number
      polyline: [number, number][] | null
    } | null = null
    if (latStr && lngStr) {
      const pLat = parseFloat(latStr)
      const pLng = parseFloat(lngStr)
      if (
        Number.isFinite(pLat) &&
        Number.isFinite(pLng) &&
        pLat >= -90 &&
        pLat <= 90 &&
        pLng >= -180 &&
        pLng <= 180
      ) {
        const route = await getRoute([pLat, pLng], [booking.lat, booking.lng])
        routeInfo = {
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          polyline: route.polyline,
        }
      }
    }

    return NextResponse.json({ booking: bookingSafe, route: routeInfo })
  } catch (e) {
    return handleError(e)
  }
}
