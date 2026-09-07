export const dynamic = "force-dynamic"

import { NextRequest } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { optimizeDailyRoute2Opt } from "@/lib/tsp-route-optimizer"
import { routeOptimizationSchema } from "@/lib/validators"

export async function POST(req: NextRequest) {
  try {
    await requireRole("PROVIDER")
    await assertRateLimit(req, RATE_LIMITS.general)
    const body = await req.json()
    const parsed = routeOptimizationSchema.parse(body)

    const plan = optimizeDailyRoute2Opt(parsed.baseLocation, parsed.stops)

    return Response.json({
      success: true,
      data: plan,
    })
  } catch (e) {
    return handleError(e)
  }
}
