import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { mediateDispute, DisputeCase } from "@/lib/dispute-mediator"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

export async function POST(req: NextRequest) {
  await requireRole("ADMIN")
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const body = await req.json()
    const dispute: DisputeCase = body

    if (!dispute.bookingId || !dispute.clientComplaint) {
      return NextResponse.json(
        { success: false, error: "bookingId and clientComplaint are required" },
        { status: 400 },
      )
    }

    const recommendation = await mediateDispute(dispute)

    return NextResponse.json({
      success: true,
      data: recommendation,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Mediation failed" },
      { status: 500 },
    )
  }
}
