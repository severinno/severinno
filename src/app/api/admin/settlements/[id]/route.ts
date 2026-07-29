import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * GET /api/admin/settlements/[id] — get settlement period details
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
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
      return NextResponse.json(
        { error: "Período de repasse não encontrado." },
        { status: 404 },
      )
    }

    return NextResponse.json({ period })
  } catch (e) {
    return handleError(e)
  }
}

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
