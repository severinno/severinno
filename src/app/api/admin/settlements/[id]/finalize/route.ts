import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

/**
 * POST /api/admin/settlements/[id]/finalize
 *
 * Mark a settlement period as finalized.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireRole("ADMIN")
    const { id } = await params

    const body = (await request.json().catch(() => ({}))) as {
      notes?: string
    }

    const period = await db.settlementPeriod.findUnique({ where: { id } })
    if (!period) {
      return NextResponse.json(
        { error: "Período não encontrado." },
        { status: 404 },
      )
    }
    if (period.status === "FINALIZED") {
      return NextResponse.json(
        { error: "Período já finalizado." },
        { status: 409 },
      )
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
  } catch (e) {
    return handleError(e)
  }
}
