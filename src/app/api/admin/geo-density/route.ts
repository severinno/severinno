export const dynamic = "force-dynamic"

/**
 * GET /api/admin/geo-density
 *
 * Agrega a densidade geoespacial de oferta (prestadores ativos) e demanda (agendamentos/buscas)
 * utilizando o particionamento hexagonal Uber H3 (resoluções 6 a 9).
 *
 * Retorna uma GeoJSON FeatureCollection pronta para renderização em mapa de calor (Heatmap/Choropleth).
 *
 * Parâmetros de Query (opcionais):
 *   - resolution: 6 | 7 | 8 | 9 (default: 7 — resolução de bairro ~4.1 km²)
 *
 * Requer autenticação de ADMIN.
 */

import { NextRequest, NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { db } from "@/lib/db"
import { clusterByH3, latLngToH3, h3ToGeoBoundary, h3ToLatLng } from "@/lib/h3-grid"

export async function GET(req: NextRequest) {
  try {
    await requireRole("ADMIN")

    const searchParams = req.nextUrl.searchParams
    const resParam = parseInt(searchParams.get("resolution") || "7", 10)
    const resolution = Math.max(6, Math.min(9, isNaN(resParam) ? 7 : resParam))

    // 1. Carregar prestadores ativos com coordenadas (Oferta)
    const providers = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        deletedAt: null,
        lat: { not: null },
        lng: { not: null },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
      },
    })

    const providerItems = providers
      .filter(
        (p): p is { id: string; lat: number; lng: number } => p.lat !== null && p.lng !== null,
      )
      .map((p) => ({ id: p.id, lat: p.lat, lng: p.lng }))

    // 2. Carregar agendamentos com coordenadas (Demanda)
    const bookings = await db.booking.findMany({
      where: {
        lat: { not: 0 },
        lng: { not: 0 },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
      },
      take: 1000,
    })

    const demandItems = bookings
      .filter((b) => b.lat !== 0 || b.lng !== 0)
      .map((b) => ({ id: b.id, lat: b.lat, lng: b.lng }))

    // 3. Agrupamento H3
    const providerClusters = clusterByH3(providerItems, resolution)
    const demandClusters = clusterByH3(demandItems, resolution)

    // Mapa unificado por H3Index
    const cellMap = new Map<
      string,
      {
        h3Index: string
        providerCount: number
        demandCount: number
      }
    >()

    for (const c of providerClusters) {
      cellMap.set(c.h3Index, {
        h3Index: c.h3Index,
        providerCount: c.count,
        demandCount: 0,
      })
    }

    for (const d of demandClusters) {
      const existing = cellMap.get(d.h3Index)
      if (existing) {
        existing.demandCount = d.count
      } else {
        cellMap.set(d.h3Index, {
          h3Index: d.h3Index,
          providerCount: 0,
          demandCount: d.count,
        })
      }
    }

    // 4. Montar GeoJSON FeatureCollection
    const features = Array.from(cellMap.values()).map((cell) => {
      const boundary = h3ToGeoBoundary(cell.h3Index)
      const center = h3ToLatLng(cell.h3Index)
      // Índice de oportunidade: alta demanda e poucos prestadores
      const opportunityScore = Number((cell.demandCount / (cell.providerCount + 0.5)).toFixed(2))

      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [boundary],
        },
        properties: {
          h3Index: cell.h3Index,
          center,
          providerCount: cell.providerCount,
          demandCount: cell.demandCount,
          opportunityScore,
          // Categoria de densidade
          densityCategory:
            cell.providerCount > 5
              ? "high_supply"
              : cell.demandCount > cell.providerCount
                ? "high_opportunity"
                : "balanced",
        },
      }
    })

    return NextResponse.json({
      type: "FeatureCollection",
      features,
      meta: {
        resolution,
        totalHexagons: features.length,
        totalProviders: providerItems.length,
        totalDemands: demandItems.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    return handleError(err)
  }
}
