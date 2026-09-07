export const dynamic = "force-dynamic"

import { NextRequest } from "next/server"
import { requireRole } from "@/lib/auth"
import { mediateDispute, DisputeCase } from "@/lib/dispute-mediator"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { handleError } from "@/lib/api-server"
import { disputeMediationSchema } from "@/lib/validators"

export async function POST(req: NextRequest) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(req, RATE_LIMITS.admin)
    const body = await req.json()
    const parsed = disputeMediationSchema.parse(body)

    const dispute: DisputeCase = parsed

    const recommendation = await mediateDispute(dispute)

    return Response.json({
      success: true,
      data: recommendation,
    })
  } catch (error) {
    return handleError(error)
  }
}
