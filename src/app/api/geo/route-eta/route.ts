export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { calculateRouteAndEta } from "@/lib/osrm"
import { badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/geo/route-eta?originLat=-23.55&originLng=-46.63&destLat=-23.56&destLng=-46.64
 * Calculates driving distance, duration in minutes, and geometry between two points.
 */
export const GET = withRoute("api.geo.route-eta.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.geo)
  const { searchParams } = new URL(request.url)

  const originLatStr = searchParams.get("originLat")
  const originLngStr = searchParams.get("originLng")
  const destLatStr = searchParams.get("destLat")
  const destLngStr = searchParams.get("destLng")

  if (!originLatStr || !originLngStr || !destLatStr || !destLngStr) {
    throw badRequest("Parâmetros 'originLat', 'originLng', 'destLat' e 'destLng' são obrigatórios")
  }

  const originLat = Number(originLatStr)
  const originLng = Number(originLngStr)
  const destLat = Number(destLatStr)
  const destLng = Number(destLngStr)

  if (isNaN(originLat) || isNaN(originLng) || isNaN(destLat) || isNaN(destLng)) {
    throw badRequest("Coordenadas geográficas inválidas")
  }

  const route = await calculateRouteAndEta(originLat, originLng, destLat, destLng)

  return NextResponse.json({
    ok: true,
    route,
  })
})
