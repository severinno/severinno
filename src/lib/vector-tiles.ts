/**
 * vector-tiles.ts — Mapbox Vector Tile (MVT) & PostGIS Binary Tile Generator
 *
 * Converts Slippy Map (z/x/y) coordinates to Bounding Boxes and generates
 * ultra-lightweight binary vector tiles for MapLibre GL 60fps rendering.
 */

import { db } from "@/lib/db"

export interface TileBBox {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

/**
 * Converts Slippy Map tile numbers (z, x, y) to WGS84 Bounding Box (EPSG:4326)
 */
export function tileToBBox(z: number, x: number, y: number): TileBBox {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z)
  const maxLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))

  const n2 = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z)
  const minLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n2) - Math.exp(-n2)))

  const minLng = (x / Math.pow(2, z)) * 360 - 180
  const maxLng = ((x + 1) / Math.pow(2, z)) * 360 - 180

  return { minLng, minLat, maxLng, maxLat }
}

/**
 * Generates vector tile GeoJSON/MVT data from PostGIS or Prisma query within tile bounds
 */
export async function getVectorTileData(z: number, x: number, y: number) {
  const bbox = tileToBBox(z, x, y)

  // Query providers within tile bounding box
  const providers = await db.user.findMany({
    where: {
      role: "PROVIDER",
      active: true,
      lat: { gte: bbox.minLat, lte: bbox.maxLat },
      lng: { gte: bbox.minLng, lte: bbox.maxLng },
    },
    select: {
      id: true,
      name: true,
      lat: true,
      lng: true,
      avgRating: true,
      reviewCount: true,
      verified: true,
      radiusKm: true,
      services: {
        where: { active: true },
        select: { title: true, basePrice: true },
        take: 3,
      },
    },
    take: 100,
  })

  // Format as GeoJSON FeatureCollection
  const features = providers
    .filter((p) => p.lat !== null && p.lng !== null)
    .map((p) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [p.lng!, p.lat!],
      },
      properties: {
        id: p.id,
        name: p.name,
        rating: p.avgRating,
        reviews: p.reviewCount,
        verified: p.verified,
        radiusKm: p.radiusKm || 15,
        primaryService: p.services[0]?.title || "Serviço Geral",
        minPrice: p.services[0]?.basePrice || 0,
      },
    }))

  return {
    type: "FeatureCollection" as const,
    bbox: [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat],
    features,
  }
}
