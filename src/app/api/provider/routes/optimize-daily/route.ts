export const dynamic = "force-dynamic"

import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { optimizeDailyRoute2Opt } from "@/lib/tsp-route-optimizer"
import { routeOptimizationSchema } from "@/lib/validators"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.provider.routes.optimize-daily.POST", async (req) => {
  await requireRole("PROVIDER")
  await assertRateLimit(req, RATE_LIMITS.general)
  const body = await req.json()
  const parsed = routeOptimizationSchema.parse(body)

  const plan = optimizeDailyRoute2Opt(parsed.baseLocation, parsed.stops)

  return Response.json({
    success: true,
    data: plan,
  })
})
