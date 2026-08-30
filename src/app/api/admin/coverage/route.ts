/**
 * GET /api/admin/coverage
 *
 * Returns all active providers with location data (lat, lng, radiusKm)
 * for rendering a coverage heat map on the admin dashboard.
 *
 * Also computes a simple grid-based coverage analysis to highlight
 * low-coverage areas.
 *
 * Response:
 * ```json
 * {
 *   "providers": [{ "id": "...", "name": "...", "lat": -23.55, "lng": -46.63, "radiusKm": 50, "city": "São Paulo", "state": "SP" }],
 *   "total": 42,
 *   "withLocation": 35,
 *   "grid": [
 *     { "lat": -23.55, "lng": -46.63, "density": 5, "gap": false },
 *     ...
 *   ]
 * }
 * ```
 */

import { handleError } from "@/lib/api-server"
import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo-server"

export type CoverageProvider = {
  id: string
  name: string
  lat: number
  lng: number
  radiusKm: number
  city: string | null
  state: string | null
}

export type CoverageGridCell = {
  lat: number
  lng: number
  /** Number of providers whose radius covers this cell center. */
  density: number
  /** True if density is below a configurable threshold (default 2). */
  gap: boolean
  /** Distance in km to the nearest provider (approximate). */
  nearestKm: number | null
}

export type CoverageResponse = {
  providers: CoverageProvider[]
  total: number
  withLocation: number
  grid: CoverageGridCell[]
  /** Bounding box of all provider locations, for map initial view. */
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null
}

// ── Grid config ───────────────────────────────────────────────────────────

/** Grid spacing in degrees (~11 km at equator). */
const GRID_STEP_DEG = 0.1

/** Radius of the sampling grid in degrees (~55 km around each provider). */
const GRID_RADIUS_DEG = 0.5

/** Minimum density to consider a cell "covered". */
const GAP_THRESHOLD = 2

// ── Route ────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await requireRole("ADMIN")

    // Fetch all active, verified providers with location data
    const users = await db.user.findMany({
      where: {
        role: "PROVIDER",
        active: true,
        lat: { not: null },
        lng: { not: null },
        radiusKm: { not: null, gt: 0 },
      },
      select: {
        id: true,
        name: true,
        lat: true,
        lng: true,
        radiusKm: true,
        city: true,
        state: true,
      },
    })

    const providers: CoverageProvider[] = users.map((u) => ({
      id: u.id,
      name: u.name,
      lat: u.lat!,
      lng: u.lng!,
      radiusKm: u.radiusKm!,
      city: u.city,
      state: u.state,
    }))

    const total = await db.user.count({
      where: { role: "PROVIDER", active: true },
    })

    // Compute bounding box
    let bounds: CoverageResponse["bounds"] = null
    if (providers.length > 0) {
      const lats = providers.map((p) => p.lat)
      const lngs = providers.map((p) => p.lng)
      bounds = {
        minLat: Math.min(...lats),
        maxLat: Math.max(...lats),
        minLng: Math.min(...lngs),
        maxLng: Math.max(...lngs),
      }
    }

    // Compute coverage grid
    const grid = computeCoverageGrid(providers)

    return NextResponse.json({
      providers,
      total,
      withLocation: providers.length,
      grid,
      bounds,
    })
  } catch (e) {
    return handleError(e)
  }
}

// ── Grid computation ──────────────────────────────────────────────────────

function computeCoverageGrid(providers: CoverageProvider[]): CoverageGridCell[] {
  if (providers.length === 0) return []

  const lats = providers.map((p) => p.lat)
  const lngs = providers.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  // Expand the sampling area by GRID_RADIUS_DEG to see coverage edges
  const sMinLat = minLat - GRID_RADIUS_DEG
  const sMaxLat = maxLat + GRID_RADIUS_DEG
  const sMinLng = minLng - GRID_RADIUS_DEG
  const sMaxLng = maxLng + GRID_RADIUS_DEG

  const cells: CoverageGridCell[] = []

  // Iterate with integer steps instead of `lat += GRID_STEP_DEG` to avoid
  // floating-point drift: e.g. -24.05 + 10 × 0.1 = -23.050000000000004 >
  // -23.05, which silently dropped the last row/column (100 cells instead
  // of the intended 11 × 11 for a ±0.5° sample area).
  const latSteps = Math.round((sMaxLat - sMinLat) / GRID_STEP_DEG)
  const lngSteps = Math.round((sMaxLng - sMinLng) / GRID_STEP_DEG)

  for (let i = 0; i <= latSteps; i++) {
    const lat = sMinLat + i * GRID_STEP_DEG
    for (let j = 0; j <= lngSteps; j++) {
      const lng = sMinLng + j * GRID_STEP_DEG
      let density = 0
      let nearestKm: number | null = null

      for (const p of providers) {
        const dist = haversineKm(lat, lng, p.lat, p.lng)
        if (dist <= p.radiusKm) {
          density++
        }
        if (nearestKm === null || dist < nearestKm) {
          nearestKm = Math.round(dist)
        }
      }

      cells.push({
        lat: round(lat, 2),
        lng: round(lng, 2),
        density,
        gap: density < GAP_THRESHOLD,
        nearestKm,
      })
    }
  }

  return cells
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}
