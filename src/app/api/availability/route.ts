export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { availabilitySchema } from "@/lib/validators"
import { forbidden } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"

// GET: provider's own availability
export const GET = withRoute("api.availability.GET", async (request: Request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const session = await requireUser()
  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    throw forbidden("Apenas prestadores podem gerenciar expediente")
  }

  const items = await db.providerAvailability.findMany({
    where: { providerId: session.userId },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  })

  return NextResponse.json({ items })
})

// POST: upsert (replace) the provider's availability array
// Body: { items: Array<{ dayOfWeek, startTime, endTime, active }> }
export const POST = withRoute("api.availability.POST", async (request: Request) => {
  await assertRateLimit(request, RATE_LIMITS.general)

  const session = await requireUser()
  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    throw forbidden("Apenas prestadores podem gerenciar expediente")
  }

  const body = await request.json()
  const rawItems = Array.isArray(body?.items) ? body.items : []
  if (rawItems.length === 0) {
    // Clear all
    await db.providerAvailability.deleteMany({
      where: { providerId: session.userId },
    })
    return NextResponse.json({ items: [] })
  }

  // Validate every item
  const parsed = rawItems.map((it: Record<string, unknown>) =>
    availabilitySchema.parse(it),
  ) as Array<{ dayOfWeek: number; startTime: string; endTime: string; active: boolean }>

  // Validate startTime < endTime for each
  for (const it of parsed) {
    if (it.startTime >= it.endTime) {
      return NextResponse.json(
        {
          error: `Horário inválido para o dia ${it.dayOfWeek}: início deve ser anterior ao fim`,
        },
        { status: 400 },
      )
    }
  }

  // Replace strategy: delete all then create all (idempotent upsert)
  await db.$transaction([
    db.providerAvailability.deleteMany({
      where: { providerId: session.userId },
    }),
    ...parsed.map((it) =>
      db.providerAvailability.create({
        data: {
          providerId: session.userId,
          dayOfWeek: it.dayOfWeek,
          startTime: it.startTime,
          endTime: it.endTime,
          active: it.active,
        },
      }),
    ),
  ])

  const items = await db.providerAvailability.findMany({
    where: { providerId: session.userId },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  })

  return NextResponse.json({ items })
})
