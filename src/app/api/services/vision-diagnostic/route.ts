export const dynamic = "force-dynamic"

import { analyzeServicePhoto } from "@/lib/vision-diagnostic"
import { requireUser } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { visionDiagnosticSchema } from "@/lib/validators"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.services.vision-diagnostic.POST", async (req) => {
  await requireUser()
  await assertRateLimit(req, RATE_LIMITS.general)
  const body = await req.json()
  const parsed = visionDiagnosticSchema.parse(body)

  const result = await analyzeServicePhoto(parsed)

  return Response.json({
    success: true,
    data: result,
  })
})
