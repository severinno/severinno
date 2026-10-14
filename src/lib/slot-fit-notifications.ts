/**
 * slot-fit-notifications.ts — Proactive notifications for schedule slot fits
 *
 * When an incoming or updated booking represents a "PERFECT" fit in the provider's
 * planned daily route (detour <= 3 km), pro-actively dispatches notifications via:
 * 1. Push Notification with direct route link
 * 2. WhatsApp message via Evolution API
 * 3. In-app notification and Realtime event
 */

import { db } from "@/lib/db"
import { cacheGet, cacheSet } from "@/lib/redis"
import logger from "@/lib/logger"
import { evaluateBestSlotFit, type RouteStop } from "@/lib/smart-slot-fit"
import { sendPushNotification } from "@/lib/push"
import { sendText, formatPhone, isValidWhatsApp } from "@/lib/evolution"
import { emitRealtime } from "@/lib/realtime-client"

const log = logger.child({ module: "slot-fit-notifications" })

export interface SlotFitNotificationPayload {
  providerId: string
  bookingId: string
  serviceTitle: string
  scheduledAt: Date
  detourKm: number
  addedMinutes: number
}

export interface CheckSlotFitResult {
  eligible: boolean
  notified: boolean
  fitQuality?: "PERFECT" | "GOOD" | "TIGHT"
  detourKm?: number
  reason?: string
}

/**
 * Sends multi-channel notifications when a booking is an optimal schedule fit
 */
export async function notifyPerfectSlotFit(payload: SlotFitNotificationPayload): Promise<boolean> {
  const { providerId, bookingId, serviceTitle, scheduledAt, detourKm, addedMinutes } = payload

  const dateIso = scheduledAt.toISOString().split("T")[0]
  const dateFormatted = scheduledAt.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  })
  const timeFormatted = scheduledAt.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })

  const title = "✨ Encaixe Perfeito de Agenda!"
  const body = `O agendamento de "${serviceTitle}" (${dateFormatted} às ${timeFormatted}) desvia apenas ${detourKm} km da sua rota planejada (+${addedMinutes} min).`
  const routeUrl = `/provider/routes?date=${dateIso}`

  // 1. In-app notification
  try {
    const notif = await db.notification.create({
      data: {
        userId: providerId,
        type: "ROUTE_SLOT_FIT",
        title,
        body,
        read: false,
      },
      select: { id: true, createdAt: true },
    })

    // Realtime dispatch
    emitRealtime(`user:${providerId}`, {
      type: "notification",
      data: {
        id: notif.id,
        type: "ROUTE_SLOT_FIT",
        title,
        body,
        routeUrl,
      },
    }).catch(() => {})
  } catch (err) {
    log.warn({ err, providerId }, "Failed to create in-app notification for slot fit")
  }

  // 2. Web Push Notification
  try {
    await sendPushNotification(providerId, title, body, routeUrl, {
      notificationType: "ROUTE_OPTIMIZED",
      bookingId,
      tag: `slot-fit:${bookingId}`,
    })
  } catch (err) {
    log.warn({ err, providerId }, "Failed to send push notification for slot fit")
  }

  // 3. WhatsApp Proactive Message (best-effort)
  try {
    const provider = await db.user.findUnique({
      where: { id: providerId },
      select: { whatsapp: true, name: true },
    })

    if (provider?.whatsapp) {
      const formatted = formatPhone(provider.whatsapp)
      if (isValidWhatsApp(formatted)) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://severinno.com.br"
        const fullLink = `${appUrl}${routeUrl}`
        const whatsappText = `✨ *Encaixe Perfeito na sua Rota!*\n\nOlá, ${provider.name || "Prestador"}! O novo agendamento para *${serviceTitle}* no dia *${dateFormatted} às ${timeFormatted}* encaixa perfeitamente no seu trajeto (apenas *+${detourKm} km* de deslocamento).\n\nAcesse seu painel para confirmar e traçar a rota otimizada no Google Maps/Waze:\n${fullLink}`

        await sendText(formatted, whatsappText)
        log.info({ providerId, bookingId }, "WhatsApp slot-fit alert sent successfully")
      }
    }
  } catch (err) {
    log.warn({ err, providerId }, "Failed to send WhatsApp for slot fit")
  }

  return true
}

/**
 * Checks if a booking constitutes a "PERFECT" slot fit on the provider's day schedule,
 * and if so, sends proactive notifications (idempotent via Redis cache).
 */
export async function checkAndNotifyBookingSlotFit(bookingId: string): Promise<CheckSlotFitResult> {
  const idempotencyKey = `slot_fit:notified:${bookingId}`
  const alreadyNotified = await cacheGet<boolean>(idempotencyKey)
  if (alreadyNotified) {
    return { eligible: false, notified: false, reason: "already_notified" }
  }

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      providerId: true,
      scheduledAt: true,
      lat: true,
      lng: true,
      address: true,
      status: true,
      service: { select: { title: true } },
    },
  })

  if (!booking || !booking.lat || !booking.lng || !booking.scheduledAt) {
    return { eligible: false, notified: false, reason: "missing_coordinates_or_date" }
  }

  const candidateDate = new Date(booking.scheduledAt)
  const startOfDay = new Date(candidateDate)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(candidateDate)
  endOfDay.setHours(23, 59, 59, 999)

  // Find other confirmed/in-progress bookings for this provider on the same day
  const dailyBookings = await db.booking.findMany({
    where: {
      providerId: booking.providerId,
      id: { not: booking.id },
      status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
      scheduledAt: { gte: startOfDay, lte: endOfDay },
    },
    include: {
      service: { select: { title: true } },
    },
    orderBy: { scheduledAt: "asc" },
  })

  // If there are no other bookings on that day, it's the only stop (not a route fit)
  if (dailyBookings.length === 0) {
    return { eligible: false, notified: false, reason: "single_stop_on_day" }
  }

  const existingStops: RouteStop[] = dailyBookings.map((b) => ({
    id: b.id,
    title: b.service?.title || "Atendimento",
    address: b.address || "",
    lat: b.lat as number,
    lng: b.lng as number,
  }))

  const baseLocation = {
    lat: existingStops[0].lat,
    lng: existingStops[0].lng,
  }

  const fitResult = evaluateBestSlotFit(baseLocation, existingStops, {
    id: booking.id,
    title: booking.service?.title || "Novo Serviço",
    address: booking.address || undefined,
    lat: booking.lat,
    lng: booking.lng,
  })

  if (fitResult.bestSlot.fitQuality === "PERFECT") {
    // Set 7-day TTL on idempotency key
    await cacheSet(idempotencyKey, true, 7 * 24 * 60 * 60)

    await notifyPerfectSlotFit({
      providerId: booking.providerId,
      bookingId: booking.id,
      serviceTitle: booking.service?.title || "Serviço",
      scheduledAt: candidateDate,
      detourKm: fitResult.bestSlot.addedDetourKm,
      addedMinutes: fitResult.bestSlot.addedTravelMinutes,
    })

    return {
      eligible: true,
      notified: true,
      fitQuality: "PERFECT",
      detourKm: fitResult.bestSlot.addedDetourKm,
    }
  }

  return {
    eligible: false,
    notified: false,
    fitQuality: fitResult.bestSlot.fitQuality,
    detourKm: fitResult.bestSlot.addedDetourKm,
    reason: "not_perfect_fit",
  }
}
