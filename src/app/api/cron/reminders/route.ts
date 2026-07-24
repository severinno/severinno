import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { sendMail, bookingReminderHtml } from "@/lib/mail"
import { sendPushNotification } from "@/lib/push"
import { captureError } from "@/lib/sentry"
import { handleError } from "@/lib/api-server"

export async function GET(request: Request) {
  try {
    const auth = request.headers.get("authorization")
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const in23h = new Date(now.getTime() + 23 * 60 * 60 * 1000)

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
          captureError(err, { bookingId: booking.id, clientId: booking.client.id, context: "cron reminder email" })
        })
      }

      sendPushNotification(
        booking.clientId,
        "Lembrete de agendamento",
        `Você tem um agendamento com ${booking.provider.name} amanhã!`,
      ).catch((err) => {
        captureError(err, { bookingId: booking.id, clientId: booking.client.id, context: "cron reminder push" })
      })

      await db.booking.update({
        where: { id: booking.id },
        data: { reminderSentAt: now },
      })

      sent++
    }

    logger.info({ sent, total: bookings.length }, "cron reminders processed")
    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return handleError(e)
  }
}
