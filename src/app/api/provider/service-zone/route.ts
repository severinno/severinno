export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, badRequest } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/provider/service-zone
 * Returns the provider's custom GeoJSON service zone polygon.
 *
 * POST /api/provider/service-zone
 * body: { polygon: GeoJSON.Polygon }
 * Saves the provider's custom service zone.
 */
export const GET = withRoute("api.provider.service-zone.GET", async (_request) => {
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
})

export const POST = withRoute("api.provider.service-zone.POST", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()
  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    throw forbidden("Acesso restrito a prestadores")
  }

  const body = (await request.json()) as { polygon?: unknown }

  if (!body.polygon) {
    throw badRequest("Campo 'polygon' (GeoJSON Polygon) é obrigatório")
  }

  // Basic GeoJSON validation
  const polygon = body.polygon as Record<string, unknown>
  if (polygon.type !== "Polygon" || !Array.isArray(polygon.coordinates)) {
    throw badRequest("Formato GeoJSON inválido. Esperado type 'Polygon' com coordinates")
  }

  const ring = polygon.coordinates as number[][][]
  if (!ring[0] || ring[0].length < 4) {
    throw badRequest("O polígono precisa de no mínimo 4 vértices (3 pontos + fechamento)")
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
})
