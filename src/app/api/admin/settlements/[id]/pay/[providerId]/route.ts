export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withParams } from "@/lib/api-route"

/**
 * POST /api/admin/settlements/[id]/pay/[providerId]
 *
 * Mark a specific provider's settlement as paid.
 */
export const POST = withParams<{ id: string; providerId: string }>(
  "api.admin.settlements.:id.pay.:providerId.POST",
  async (_request, { params }) => {
    const session = await requireRole("ADMIN")
    await assertRateLimit(_request, RATE_LIMITS.settlements)
    const { id, providerId } = await params

    const settlement = await db.providerSettlement.findUnique({
      where: { periodId_providerId: { periodId: id, providerId } },
    })

    if (!settlement) {
      return NextResponse.json({ error: "Repasse não encontrado." }, { status: 404 })
    }

    if (settlement.status === "PAID") {
      return NextResponse.json({ error: "Este repasse já foi pago." }, { status: 409 })
    }

    const updated = await db.providerSettlement.update({
      where: { id: settlement.id },
      data: {
        status: "PAID",
        paidAt: new Date(),
        paidBy: session.userId,
      },
      include: {
        provider: { select: { id: true, name: true, email: true } },
      },
    })

    return NextResponse.json({ settlement: updated })
  },
)
