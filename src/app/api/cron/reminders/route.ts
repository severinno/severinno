export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { sendMail, bookingReminderHtml } from "@/lib/mail"
import { sendPushNotification } from "@/lib/push"
import { captureError } from "@/lib/sentry"
import { handleError } from "@/lib/api-server"
import {
  notifyPaymentReminder,
  notifyReviewRequest,
  notifyPaymentConfirmed,
} from "@/lib/notifications"

export async function GET(request: Request) {
  try {
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)

    // 1. Upcoming 24h reminders
    const bookings = await db.booking.findMany({
      where: {
        scheduledAt: { gte: in23h, lte: in24h },
        status: { in: ["PENDING", "CONFIRMED"] },
        reminderSentAt: null,
      },
      include: {
        client: { select: { id: true, name: true, email: true } },
        provider: { select: { id: true, name: true } },
        service: { select: { title: true } },
      },
    })

    let sent = 0
    for (const booking of bookings) {
      const scheduledDate = booking.scheduledAt.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

      if (booking.client.email) {
        sendMail({
          to: booking.client.email,
          subject: `Lembrete: ${booking.service.title} amanhã — Severinno`,
          html: bookingReminderHtml({
            name: booking.client.name,
            serviceName: booking.service.title,
            providerName: booking.provider.name,
            scheduledAt: scheduledDate,
          }),
        }).catch((err) => {
          captureError(err, {
            bookingId: booking.id,
            clientId: booking.client.id,
            context: "cron reminder email",
          })
        })
      }

      sendPushNotification(
        booking.clientId,
        "Lembrete de agendamento",
        `Você tem um agendamento com ${booking.provider.name} amanhã!`,
      ).catch((err) => {
        captureError(err, {
          bookingId: booking.id,
          clientId: booking.client.id,
          context: "cron reminder push",
        })
      })

      await db.booking.update({
        where: { id: booking.id },
        data: { reminderSentAt: now },
      })

      sent++
    }

    // 2. Pending payment reminders (> 2h created, PIX, unpaid)
    const unpaidBookings = await db.booking.findMany({
      where: {
        paymentStatus: "PENDING",
        status: { in: ["PENDING", "CONFIRMED"] },
        createdAt: { lte: twoHoursAgo },
        paymentMethod: "PIX",
      },
      include: {
        payment: { select: { qrCode: true } },
      },
      take: 20,
    })

    let paymentRemindersSent = 0
    for (const ub of unpaidBookings) {
      notifyPaymentReminder(ub.clientId, ub.id, ub.amount, ub.payment?.qrCode ?? undefined).catch(
        () => {},
      )
      paymentRemindersSent++
    }

    // 3. Review request reminders (completed > 48h ago without review)
    const completedWithoutReview = await db.booking.findMany({
      where: {
        status: "COMPLETED",
        updatedAt: { lte: twoDaysAgo },
        reviews: { none: {} },
      },
      include: {
        provider: { select: { name: true } },
      },
      take: 20,
    })

    let reviewRequestsSent = 0
    for (const cwr of completedWithoutReview) {
      notifyReviewRequest(cwr.clientId, cwr.id, cwr.provider.name).catch((err) =>
        logger.warn({ err }, "cron notification failed (fire-and-forget)"),
      )
      reviewRequestsSent++
    }

    // 4. Escrow auto-release (HELD > 72h without open disputes)
    const threeDaysAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000)
    const heldBookingsToRelease = await db.booking.findMany({
      where: {
        paymentStatus: "HELD",
        status: "COMPLETED",
        updatedAt: { lte: threeDaysAgo },
        disputes: { none: { status: "OPEN" } },
      },
      take: 20,
    })

    let escrowAutoReleasedCount = 0
    for (const hb of heldBookingsToRelease) {
      await db.$transaction([
        db.booking.update({
          where: { id: hb.id },
          data: {
            paymentStatus: "PAID",
            escrowReleasedAt: now,
          },
        }),
        db.payment.updateMany({
          where: { bookingId: hb.id },
          data: {
            status: "PAID",
            paidAt: now,
          },
        }),
      ])

      notifyPaymentConfirmed(hb.providerId, hb.id, hb.amount).catch((err) =>
        logger.warn({ err }, "cron notification failed (fire-and-forget)"),
      )
      escrowAutoReleasedCount++
    }

    logger.info(
      {
        sent,
        paymentRemindersSent,
        reviewRequestsSent,
        escrowAutoReleasedCount,
        total: bookings.length,
      },
      "cron reminders processed with extended WhatsApp lifecycle and escrow auto-release",
    )

    return NextResponse.json({
      ok: true,
      sent,
      paymentRemindersSent,
      reviewRequestsSent,
      escrowAutoReleasedCount,
    })
  } catch (e) {
    return handleError(e)
  }
}
