export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, badRequest, handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * GET /api/provider/service-zone
 * Returns the provider's custom GeoJSON service zone polygon.
 *
 * POST /api/provider/service-zone
 * body: { polygon: GeoJSON.Polygon }
 * Saves the provider's custom service zone.
 */
export async function GET(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito a prestadores")
    }

    const provider = await db.user.findUnique({
      where: { id: session.userId },
      select: { servicePolygon: true, lat: true, lng: true, radiusKm: true },
    })

    return NextResponse.json({
      ok: true,
      polygon: provider?.servicePolygon ?? null,
      center: provider ? { lat: provider.lat, lng: provider.lng } : null,
      radiusKm: provider?.radiusKm ?? 25,
    })
  } catch (e) {
    return handleError(e)
  }
}

export async function POST(request: Request) {
  try {
    await assertRateLimit(request, RATE_LIMITS.general)
    const session = await requireUser()
    if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
      throw forbidden("Acesso restrito a prestadores")
    }

    const body = (await request.json()) as { polygon?: unknown }

    if (!body.polygon) {
      throw badRequest("Campo 'polygon' (GeoJSON Polygon) é obrigatório")
    }

    const MAX_VERTICES = 1000

    // Basic GeoJSON validation
    const polygon = body.polygon as Record<string, unknown>
    if (polygon.type !== "Polygon" || !Array.isArray(polygon.coordinates)) {
      throw badRequest("Formato GeoJSON inválido. Esperado type 'Polygon' com coordinates")
    }

    const ring = polygon.coordinates as number[][][]
    if (!ring[0] || ring[0].length < 4) {
      throw badRequest("O polígono precisa de no mínimo 4 vértices (3 pontos + fechamento)")
    }

    if (ring[0].length > MAX_VERTICES) {
      throw badRequest(`O polígono excede o limite de ${MAX_VERTICES} vértices`)
    }

    // Validate ring is closed (first point == last point)
    const first = ring[0]![0]
    const last = ring[0]![ring[0].length - 1]
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      throw badRequest("O anel do polígono deve ser fechado (primeiro ponto = último ponto)")
    }

    // Validate coordinate ranges
    for (const point of ring[0]) {
      if (!Array.isArray(point) || point.length < 2) {
        throw badRequest("Coordenada inválida no polígono")
      }
      const [lng, lat] = point
      if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        throw badRequest("Coordenada fora do range válido no polígono")
      }
    }

    await db.user.update({
      where: { id: session.userId },
      data: { servicePolygon: body.polygon as object },
    })

    return NextResponse.json({
      ok: true,
      message: "Zona de atendimento salva com sucesso",
      vertexCount: ring[0].length,
    })
  } catch (e) {
    return handleError(e)
  }
}
