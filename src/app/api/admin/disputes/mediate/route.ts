export const dynamic = "force-dynamic"

import { requireRole } from "@/lib/auth"
import { mediateDispute, DisputeCase } from "@/lib/dispute-mediator"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { disputeMediationSchema } from "@/lib/validators"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.admin.disputes.mediate.POST", async (req) => {
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
})
