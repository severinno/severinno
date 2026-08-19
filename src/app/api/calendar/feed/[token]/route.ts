import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { generateIcsFeed, type CalendarEvent } from "@/lib/calendar-sync"
import { notFound, handleError } from "@/lib/api-server"
import { addHours } from "date-fns"

/**
 * GET /api/calendar/feed/[token]
 * Serves live RFC 5545 iCalendar feed to external calendar clients (Google Calendar, Apple, Outlook).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params

    if (!token || token.length < 8) {
      throw notFound("Token de calendário inválido")
    }

    // Find provider by id or slug matching token prefix
    const provider = await db.user.findFirst({
      where: {
        OR: [{ id: token }, { slug: token }],
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
      const end = addHours(start, 2) // Default 2h duration
      return {
        id: b.id,
        title: `${b.service.title} — ${b.client.name}`,
        description: `Cliente: ${b.client.name}\\nTelefone: ${b.client.phone || "Não informado"}\\nStatus: ${b.status}`,
        location: b.address,
        start,
        end,
        status: b.status === "COMPLETED" ? "CONFIRMED" : "CONFIRMED",
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
  } catch (e) {
    return handleError(e)
  }
}
