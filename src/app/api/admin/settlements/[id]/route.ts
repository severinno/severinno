export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withParams } from "@/lib/api-route"

/**
 * GET /api/admin/settlements/[id] — get settlement period details
 */
export const GET = withParams<{ id: string }>(
  "api.admin.settlements.:id.GET",
  async (_request, { params }) => {
    await requireRole("ADMIN")
    await assertRateLimit(_request, RATE_LIMITS.settlements)
    const { id } = await params

    const period = await db.settlementPeriod.findUnique({
      where: { id },
      include: {
        providers: {
          orderBy: { totalAmount: "desc" },
          include: {
            provider: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
          },
        },
      },
    })

    if (!period) {
      return NextResponse.json({ error: "Período de repasse não encontrado." }, { status: 404 })
    }

    return NextResponse.json({ period })
  },
)

/**
 * POST /api/admin/settlements/[id] — not supported on this route.
 * Use /api/admin/settlements/[id]/finalize or /api/admin/settlements/[id]/pay/[providerId] instead.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Ação inválida. Use /finalize ou /pay/[providerId]." },
    { status: 400 },
  )
}
