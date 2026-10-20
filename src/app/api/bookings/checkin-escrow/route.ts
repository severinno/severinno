export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import {
  validateGeoCheckin,
  generateEscrowPIN,
  validateEscrowRelease,
} from "@/lib/geo-checkin-escrow"
import { requireUser } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { checkinEscrowSchema } from "@/lib/validators"
import { db } from "@/lib/db"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.bookings.checkin-escrow.POST", async (req) => {
  await requireUser()
  await assertRateLimit(req, RATE_LIMITS.bookings)
  const body = await req.json()
  const parsed = checkinEscrowSchema.parse(body)

  switch (parsed.action) {
    case "checkin": {
      const result = validateGeoCheckin({
        bookingId: parsed.bookingId,
        providerId: parsed.providerId,
        providerLat: parsed.providerLat,
        providerLng: parsed.providerLng,
        clientAddressLat: parsed.clientAddressLat,
        clientAddressLng: parsed.clientAddressLng,
      })

      if (result.success) {
        // Dispara notificação de chegada (WhatsApp + Push + In-App) para o cliente
        try {
          const booking = await db.booking.findUnique({
            where: { id: parsed.bookingId },
            select: {
              clientId: true,
              provider: { select: { name: true } },
              service: { select: { title: true } },
            },
          })
          if (booking) {
            const { notifyProviderArrived } = await import("@/lib/notifications")
            notifyProviderArrived(
              booking.clientId,
              parsed.bookingId,
              booking.provider.name,
              booking.service?.title ?? "Serviço",
            ).catch(() => {})
          }
        } catch {
          // Best effort notification
        }
      }

      return NextResponse.json({ success: result.success, data: result })
    }

    case "generate-pin": {
      const pin = await generateEscrowPIN(parsed.bookingId)
      return NextResponse.json({ success: true, data: pin })
    }

    case "release-escrow": {
      const result = await validateEscrowRelease(parsed.bookingId, parsed.pin, parsed.escrowAmount)

      if (result.success) {
        const now = new Date()
        try {
          const booking = await db.booking.findUnique({
            where: { id: parsed.bookingId },
            select: { id: true, providerId: true, clientId: true, amount: true, status: true },
          })

          if (booking) {
            const [bookingUpdateResult] = await db.$transaction([
              db.booking.updateMany({
                where: {
                  id: parsed.bookingId,
                  escrowReleasedAt: null,
                },
                data: {
                  status: "COMPLETED",
                  paymentStatus: "PAID",
                  escrowReleasedAt: now,
                },
              }),
              db.payment.updateMany({
                where: { bookingId: parsed.bookingId, status: { not: "PAID" } },
                data: {
                  status: "PAID",
                  paidAt: now,
                },
              }),
            ])

            if (bookingUpdateResult.count > 0) {
              // Notifica o prestador via WhatsApp (assíncrono)
              const { notifyPaymentConfirmed } = await import("@/lib/notifications")
              const { toMoneyNumber } = await import("@/lib/money")
              notifyPaymentConfirmed(
                booking.providerId,
                booking.id,
                toMoneyNumber(booking.amount),
              ).catch(() => {})

              // Bônus de Fidelidade Severinno Clube (+10 pts)
              const { awardPoints } = await import("@/lib/loyalty")
              awardPoints(booking.clientId, "booking_completed").catch(() => {})
              awardPoints(booking.providerId, "booking_completed").catch(() => {})

              // Bônus de Indicação se primeiro agendamento
              const { processReferralFirstBookingConversion } = await import("@/lib/referral")
              processReferralFirstBookingConversion(
                booking.id,
                booking.clientId,
                booking.providerId,
              ).catch(() => {})
            }
          }
        } catch {
          // Se falhar a persistência, o resultado do PIN ainda é retornado,
          // mas sem travar o endpoint
        }
      }

      return NextResponse.json({ success: result.success, data: result })
    }
  }
})
