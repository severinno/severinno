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
            select: { id: true, providerId: true, amount: true, status: true },
          })

          if (booking) {
            await db.$transaction([
              db.booking.update({
                where: { id: parsed.bookingId },
                data: {
                  status: "COMPLETED",
                  paymentStatus: "PAID",
                  escrowReleasedAt: now,
                },
              }),
              db.payment.updateMany({
                where: { bookingId: parsed.bookingId },
                data: {
                  status: "PAID",
                  paidAt: now,
                },
              }),
            ])

            // Notifica o prestador via WhatsApp (assíncrono)
            const { notifyPaymentConfirmed } = await import("@/lib/notifications")
            const { toMoneyNumber } = await import("@/lib/money")
            notifyPaymentConfirmed(
              booking.providerId,
              booking.id,
              toMoneyNumber(booking.amount),
            ).catch(() => {})
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
