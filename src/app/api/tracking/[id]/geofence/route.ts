import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { calculateRouteAndEta } from "@/lib/osrm"
import { sendWhatsApp } from "@/lib/whatsapp"
import { badRequest, forbidden, notFound, handleError } from "@/lib/api-server"
import logger from "@/lib/logger"

const GEOFENCE_DISTANCE_KM = 1.0
const GEOFENCE_DURATION_MIN = 5

/**
 * POST /api/tracking/[id]/geofence
 * body: { providerLat, providerLng }
 *
 * Evaluates real-time provider position against the booking destination.
 * If the provider is within 1 km or ≤5 min ETA (and no prior alert was sent),
 * dispatches a WhatsApp notification to the client.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser()
    const { id: bookingId } = await params

    const body = (await request.json()) as {
      providerLat?: number
      providerLng?: number
    }

    if (!body.providerLat || !body.providerLng) {
      throw badRequest("Posição do prestador (providerLat, providerLng) é obrigatória")
    }

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        providerId: true,
        clientId: true,
        lat: true,
        lng: true,
        status: true,
        geofenceAlertSentAt: true,
        client: { select: { name: true } },
        provider: { select: { name: true } },
      },
    })

    if (!booking) {
      throw notFound("Agendamento não encontrado")
    }

    if (session.userId !== booking.providerId && session.role !== "ADMIN") {
      throw forbidden("Apenas o prestador do agendamento pode enviar posição")
    }

    if (!booking.lat || !booking.lng) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: "Agendamento sem coordenadas de destino",
      })
    }

    // Already sent — idempotent
    if (booking.geofenceAlertSentAt) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: "Alerta já enviado anteriormente",
        sentAt: booking.geofenceAlertSentAt,
      })
    }

    // Calculate real ETA from current provider position to booking destination
    const route = await calculateRouteAndEta(
      body.providerLat,
      body.providerLng,
      booking.lat,
      booking.lng,
    )

    const shouldTrigger =
      route.distanceKm <= GEOFENCE_DISTANCE_KM ||
      route.durationMin <= GEOFENCE_DURATION_MIN

    if (!shouldTrigger) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        distanceKm: route.distanceKm,
        durationMin: route.durationMin,
      })
    }

    // Fire geofence alert — WhatsApp notification to client
    const providerName = booking.provider?.name ?? "O prestador"
    const etaText = route.durationMin <= 1
      ? "menos de 1 minuto"
      : `aproximadamente ${route.durationMin} minutos`

    await sendWhatsApp({
      userId: booking.clientId,
      title: `🚗 ${providerName} está chegando!`,
      body: `${providerName} está a ${etaText} do seu endereço. Fique de prontidão!`,
      url: `/?view=client.bookings&id=${bookingId}`,
    })

    // Mark alert as sent (idempotent guard)
    await db.booking.update({
      where: { id: bookingId },
      data: { geofenceAlertSentAt: new Date() },
    })

    logger.info(
      { bookingId, distanceKm: route.distanceKm, durationMin: route.durationMin },
      "Geofence alert triggered and WhatsApp sent",
    )

    return NextResponse.json({
      ok: true,
      triggered: true,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      message: `Alerta enviado: ${providerName} está a ${etaText}`,
    })
  } catch (e) {
    return handleError(e)
  }
}
