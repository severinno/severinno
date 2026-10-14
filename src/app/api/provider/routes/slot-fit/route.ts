export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { evaluateBestSlotFit } from "@/lib/smart-slot-fit"
import { getProviderTransportMode } from "@/lib/provider-transport-preferences"
import { formatTime } from "@/lib/format"
import { parseISO, startOfDay, endOfDay } from "date-fns"
import { z } from "zod"

const slotFitSchema = z.object({
  date: z.string().min(10),
  lat: z.number(),
  lng: z.number(),
  title: z.string().min(2),
  address: z.string().optional(),
  durationMinutes: z.number().optional().default(60),
  transportMode: z.enum(["MOTO", "CAR", "BICYCLE"]).optional(),
})

/**
 * POST /api/provider/routes/slot-fit
 * Evaluates candidate appointment to find the "Encaixe Perfeito" with minimum travel detour.
 */
export const POST = withRoute("api.provider.routes.slot-fit.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas prestadores podem acessar a análise de encaixe de agenda" },
      { status: 403 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const {
    date,
    lat,
    lng,
    title,
    address,
    durationMinutes,
    transportMode: bodyMode,
  } = slotFitSchema.parse(body)

  const transportMode = bodyMode || (await getProviderTransportMode(session.userId))

  const targetDate = parseISO(date)
  const start = startOfDay(targetDate)
  const end = endOfDay(targetDate)

  const existingBookings = await db.booking.findMany({
    where: {
      providerId: session.userId,
      scheduledAt: { gte: start, lte: end },
      status: { notIn: ["CANCELLED"] },
    },
    select: {
      id: true,
      address: true,
      scheduledAt: true,
      service: { select: { title: true } },
      client: { select: { name: true } },
    },
    orderBy: { scheduledAt: "asc" },
  })

  const baseLocation = {
    lat: -23.5505,
    lng: -46.6333,
  }

  const existingStops = existingBookings.map((b, idx) => {
    const angle = idx * 1.618 * Math.PI * 2
    const radius = 0.02 + idx * 0.015
    const bLat = baseLocation.lat + Math.sin(angle) * radius
    const bLng = baseLocation.lng + Math.cos(angle) * radius

    return {
      id: b.id,
      title: b.service.title,
      address: b.address || `Atendimento ${idx + 1}`,
      lat: Number(bLat.toFixed(5)),
      lng: Number(bLng.toFixed(5)),
      clientName: b.client.name,
      scheduledTime: formatTime(b.scheduledAt),
    }
  })

  const fitResult = evaluateBestSlotFit(
    baseLocation,
    existingStops,
    {
      title,
      address,
      lat,
      lng,
      durationMinutes,
    },
    transportMode,
  )

  return NextResponse.json({
    ok: true,
    fit: fitResult,
  })
})
