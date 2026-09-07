export const dynamic = "force-dynamic"

import { NextRequest } from "next/server"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { calculate1xNDistanceMatrix } from "@/lib/osrm-table"
import { matrixEtaSchema } from "@/lib/validators"

export async function POST(req: NextRequest) {
  try {
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
  } catch (e) {
    return handleError(e)
  }
}
