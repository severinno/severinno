export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { calculateTravelFee } from "@/lib/travel-fee"
import { badRequest, notFound, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * GET /api/geo/travel-fee?providerId=X&clientLat=Y&clientLng=Z
 * Returns a transparent breakdown of the travel fee for the given provider → client route.
 */
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.geo)
    const { searchParams } = new URL(request.url)

    const providerId = searchParams.get("providerId")
    const clientLatStr = searchParams.get("clientLat")
    const clientLngStr = searchParams.get("clientLng")

    if (!providerId || !clientLatStr || !clientLngStr) {
      throw badRequest("Parâmetros 'providerId', 'clientLat' e 'clientLng' são obrigatórios")
    }

    const clientLat = Number(clientLatStr)
    const clientLng = Number(clientLngStr)

    if (isNaN(clientLat) || isNaN(clientLng)) {
      throw badRequest("Coordenadas do cliente inválidas")
    }

    if (clientLat < -90 || clientLat > 90 || clientLng < -180 || clientLng > 180) {
      throw badRequest("Coordenadas do cliente fora do range válido")
    }

    const provider = await db.user.findUnique({
      where: { id: providerId, role: "PROVIDER", active: true },
      select: {
        id: true,
        name: true,
        lat: true,
        lng: true,
        travelFeePolicy: true,
      },
    })

    if (!provider || !provider.lat || !provider.lng) {
      throw notFound("Prestador não encontrado ou sem coordenadas registradas")
    }

    const policy = (provider.travelFeePolicy as Record<string, number> | null) ?? {}

    const breakdown = await calculateTravelFee(
      provider.lat,
      provider.lng,
      clientLat,
      clientLng,
      policy,
    )

    return NextResponse.json({
      ok: true,
      provider: { id: provider.id, name: provider.name },
      ...breakdown,
    })
  } catch (e) {
    return handleError(e)
  }
}
