import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleError, notFound } from "@/lib/api-server"
import { getRoute } from "@/lib/routing"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  try {
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
        provider: { select: { id: true, name: true, avatarUrl: true } },
        client: { select: { id: true, name: true } },
        service: { select: { id: true, title: true, basePrice: true } },
        amount: true,
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")

    let routeInfo: { distanceKm: number; durationMin: number } | null = null
    if (latStr && lngStr) {
      const pLat = parseFloat(latStr)
      const pLng = parseFloat(lngStr)
      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        const route = await getRoute([pLat, pLng], [booking.lat, booking.lng])
        routeInfo = {
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
        }
      }
    }

    return NextResponse.json({ booking, route: routeInfo })
  } catch (e) {
    return handleError(e)
  }
}
