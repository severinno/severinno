export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { calculateRouteAndEta } from "@/lib/osrm"
import { sendWhatsApp } from "@/lib/whatsapp"
import { badRequest, forbidden, notFound } from "@/lib/api-server"
import { checkGeofences } from "@/lib/geofencing"
import { indexProviderLocation } from "@/lib/redis-geo"
import { haversineKm } from "@/lib/geo-server"
import logger from "@/lib/logger"

import { withParams } from "@/lib/api-route"
import { sendTrackingPosition } from "@/lib/realtime-client"

const GEOFENCE_DISTANCE_KM = 1.0
const GEOFENCE_DURATION_MIN = 5
const GEOFENCE_RADIUS_M = 200

/**
 * POST /api/tracking/[id]/geofence
 * body: { providerLat, providerLng }
 *
 * Unified geofence endpoint:
 *   1. Updates Redis GEO spatial index
 *   2. Runs geofencing engine (Haversine enter/exit with lock + debounce)
 *   3. If still not triggered, evaluates OSRM ETA as fallback trigger
 *   4. Sends WhatsApp "está chegando" on first trigger (idempotent)
 */
export const POST = withParams<{ id: string }>(
  "api.tracking.:id.geofence.POST",
  async (request, { params }) => {
    const session = await requireUser()
    const { id: bookingId } = await params

    const body = (await request.json()) as {
      providerLat?: number
      providerLng?: number
    }

    if (!body.providerLat || !body.providerLng) {
      throw badRequest("Posição do prestador (providerLat, providerLng) é obrigatória")
    }

    const { providerLat, providerLng } = body

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

    // 1. Keep spatial index fresh and broadcast live position to client via WebSocket
    indexProviderLocation(session.userId, providerLat, providerLng).catch(() => {})
    if (booking.clientId) {
      sendTrackingPosition({
        bookingId,
        clientId: booking.clientId,
        lat: providerLat,
        lng: providerLng,
      }).catch(() => {})
    }

    // 2. Run geofencing engine (Haversine enter/exit with distributed lock)
    const engineEvents = await checkGeofences(session.userId, providerLat, providerLng)

    // 3. Check if engine already triggered an enter event for this booking
    const engineTriggered = engineEvents.some(
      (e) => e.type === "enter" && e.bookingId === bookingId,
    )

    // 4. Idempotent guard — already sent
    if (booking.geofenceAlertSentAt) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        reason: "Alerta já enviado anteriormente",
        sentAt: booking.geofenceAlertSentAt,
        engineEvents: engineEvents.length,
      })
    }

    // 5. If engine didn't trigger, try OSRM ETA fallback
    if (!engineTriggered) {
      if (!booking.lat || !booking.lng) {
        return NextResponse.json({
          ok: true,
          triggered: false,
          reason: "Agendamento sem coordenadas de destino",
          engineEvents: engineEvents.length,
        })
      }

      const directDistanceKm = haversineKm(providerLat, providerLng, booking.lat, booking.lng)
      const directDistanceMeters = Math.round(directDistanceKm * 1000)

      // Fast path: Haversine already inside 200m zone — engine handles it
      if (directDistanceMeters <= GEOFENCE_RADIUS_M) {
        // Engine should have caught this, but log if it didn't
        logger.debug(
          { bookingId, distanceMeters: directDistanceMeters },
          "geofence: Haversine inside zone but engine didn't trigger",
        )
      }

      // OSRM ETA fallback for farther distances
      const route = await calculateRouteAndEta(providerLat, providerLng, booking.lat, booking.lng)
      const shouldTriggerByEta =
        route.distanceKm <= GEOFENCE_DISTANCE_KM || route.durationMin <= GEOFENCE_DURATION_MIN

      if (!shouldTriggerByEta) {
        return NextResponse.json({
          ok: true,
          triggered: false,
          distanceKm: route.distanceKm,
          durationMin: route.durationMin,
          engineEvents: engineEvents.length,
        })
      }
    }

    // 6. Trigger WhatsApp notification
    const providerName = booking.provider?.name ?? "O Prestador"
    const distanceMeters = Math.round(
      haversineKm(providerLat, providerLng, booking.lat ?? 0, booking.lng ?? 0) * 1000,
    )
    const distanceText =
      distanceMeters <= 100
        ? "muito perto"
        : distanceMeters <= 1000
          ? `a aproximadamente ${distanceMeters} metros`
          : `a aproximadamente ${(distanceMeters / 1000).toFixed(1)} km`

    await sendWhatsApp({
      userId: booking.clientId,
      title: `🚗 ${providerName} está chegando!`,
      body: `${providerName} está ${distanceText} do seu endereço. Fique de prontidão!`,
      url: `/?view=client.bookings&id=${bookingId}`,
    })

    // Mark alert as sent (idempotent guard)
    await db.booking.update({
      where: { id: bookingId },
      data: { geofenceAlertSentAt: new Date() },
    })

    logger.info(
      { bookingId, distanceMeters, engineEvents: engineEvents.length },
      "Geofence alert triggered (unified endpoint)",
    )

    return NextResponse.json({
      ok: true,
      triggered: true,
      distanceMeters,
      engineEvents: engineEvents.length,
      message: `Alerta enviado: ${providerName} está ${distanceText}`,
    })
  },
)
