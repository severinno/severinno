import { NextRequest, NextResponse } from "next/server"
import { mediateDispute, DisputeCase } from "@/lib/dispute-mediator"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const dispute: DisputeCase = body

    if (!dispute.bookingId || !dispute.clientComplaint) {
      return NextResponse.json(
        { success: false, error: "bookingId and clientComplaint are required" },
        { status: 400 }
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
      { status: 500 }
    )
  }
}
