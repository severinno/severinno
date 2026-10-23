export const dynamic = "force-dynamic"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { calculate1xNDistanceMatrix } from "@/lib/osrm-table"
import { matrixEtaSchema } from "@/lib/validators"

import { withRoute } from "@/lib/api-route"

export const POST = withRoute("api.geo.matrix-eta.POST", async (req) => {
  await assertRateLimit(req, RATE_LIMITS.geo)
  const body = await req.json()
  const parsed = matrixEtaSchema.parse(body)

  const results = await calculate1xNDistanceMatrix(parsed.origin, parsed.destinations)

  // Sort by fastest duration / distance
  results.sort((a, b) => a.durationMinutes - b.durationMinutes || a.distanceKm - b.distanceKm)

  return Response.json({
    success: true,
    count: results.length,
    origin: parsed.origin,
    results,
  })
})
