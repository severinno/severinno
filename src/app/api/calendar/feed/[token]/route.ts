export const dynamic = "force-dynamic"

import { createHmac, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { generateIcsFeed, type CalendarEvent } from "@/lib/calendar-sync"
import { notFound } from "@/lib/api-server"
import { addHours } from "date-fns"
import { getTimezoneFromCoords } from "@/lib/geo-timezone"
import { withParams } from "@/lib/api-route"

/**
 * GET /api/calendar/feed/[token]
 * Serves live RFC 5545 iCalendar feed to external calendar clients (Google Calendar, Apple, Outlook).
 */

export function generateCalendarToken(providerId: string): string {
  const secret =
    process.env.AUTH_SECRET || process.env.SESSION_SECRET || "severinno-calendar-secret"
  const sig = createHmac("sha256", secret).update(`cal:${providerId}`).digest("hex").slice(0, 24)
  return `${providerId}_${sig}`
}

export function verifyCalendarToken(token: string): string | null {
  if (!token || typeof token !== "string" || !token.includes("_")) return null

  const [providerId, sig] = token.split("_")
  if (!providerId || !sig) return null

  const secret =
    process.env.AUTH_SECRET || process.env.SESSION_SECRET || "severinno-calendar-secret"
  const expected = createHmac("sha256", secret)
    .update(`cal:${providerId}`)
    .digest("hex")
    .slice(0, 24)

  if (sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return providerId
  }

  return null
}

/**
 * GET /api/calendar/feed/[token]
 * Serves live RFC 5545 iCalendar feed to external calendar clients (Google Calendar, Apple, Outlook).
 */
export const GET = withParams<{ token: string }>(
  "api.calendar.feed.:token.GET",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.general)

    const { token } = await params
    const providerId = verifyCalendarToken(token)

    if (!providerId) {
      throw notFound("Token de calendário inválido ou expirado")
    }

    const provider = await db.user.findFirst({
      where: {
        id: providerId,
        role: "PROVIDER",
        active: true,
      },
      select: {
        id: true,
        name: true,
      },
    })

    if (!provider) {
      throw notFound("Prestador não encontrado para este feed")
    }

    // Fetch upcoming and recent confirmed bookings
    const bookings = await db.booking.findMany({
      where: {
        providerId: provider.id,
        status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
        scheduledAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: {
        id: true,
        scheduledAt: true,
        lat: true,
        lng: true,
        address: true,
        status: true,
        service: { select: { title: true } },
        client: { select: { name: true, phone: true } },
      },
      orderBy: { scheduledAt: "asc" },
      take: 100,
    })

    const events: CalendarEvent[] = bookings.map((b) => {
      const start = new Date(b.scheduledAt)
      const end = addHours(start, 2)
      const clientPhoneDisplay = b.client.phone || "Não informado"

      return {
        id: b.id,
        title: `${b.service.title} — ${b.client.name}`,
        description: `Cliente: ${b.client.name}\nTelefone: ${clientPhoneDisplay}\nStatus: ${b.status}`,
        location: b.address,
        start,
        end,
        status: "CONFIRMED",
        timezone: getTimezoneFromCoords(b.lat, b.lng),
      }
    })

    const icsContent = generateIcsFeed(`Severinno — ${provider.name}`, events)

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="agenda-${provider.id}.ics"`,
        "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
      },
    })
  },
)
