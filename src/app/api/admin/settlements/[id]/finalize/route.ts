export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withParams } from "@/lib/api-route"

/**
 * POST /api/admin/settlements/[id]/finalize
 *
 * Mark a settlement period as finalized.
 */
export const POST = withParams<{ id: string }>(
  "api.admin.settlements.:id.finalize.POST",
  async (request, { params }) => {
    const session = await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.settlements)
    const { id } = await params

    const body = (await request.json().catch(() => ({}))) as {
      notes?: string
    }

    const period = await db.settlementPeriod.findUnique({ where: { id } })
    if (!period) {
      return NextResponse.json({ error: "Período não encontrado." }, { status: 404 })
    }
    if (period.status === "FINALIZED") {
      return NextResponse.json({ error: "Período já finalizado." }, { status: 409 })
    }

    const updated = await db.settlementPeriod.update({
      where: { id },
      data: {
        status: "FINALIZED",
        finalizedAt: new Date(),
        finalizedBy: session.userId,
        notes: body.notes ?? period.notes,
      },
      include: {
        providers: {
          include: {
            provider: { select: { id: true, name: true, email: true } },
          },
        },
      },
    })

    return NextResponse.json({ period: updated })
  },
)
