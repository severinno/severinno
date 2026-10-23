/**
 * map-matching.ts — Snap-to-Road and Trajectory Projection Engine
 *
 * Mathematically projects noisy mobile GNSS coordinates onto the nearest
 * road segment of a route polyline, calculating:
 *   - The exact orthogonal projection point (lat, lng) on the asphalt
 *   - The road segment bearing (azimuth) for vehicle icon orientation
 *   - Cross-track distance (perpendicular error distance in meters)
 *   - Along-track progress (completion percentage of the route)
 *   - Off-route detection (when provider takes an alternative detour)
 */

import { haversineKm } from "./geo-shared"

export type Coordinate = [number, number] // [lng, lat] (GeoJSON / MapLibre standard)

export interface RoadSnapResult {
  /** Snapped coordinate [lng, lat] on the road centerline */
  snappedCoord: Coordinate
  /** Perpendicular cross-track distance from raw GPS to road in meters */
  distanceToRoadMeters: number
  /** Road segment bearing in degrees (0 = North, 90 = East, 180 = South, 270 = West) */
  bearing: number
  /** Index of the nearest route segment [i, i+1] */
  segmentIndex: number
  /** Whether the GPS fix is within the road corridor (e.g. <= 45m) */
  isMatched: boolean
}

/**
 * Calculates initial bearing (azimuth) between two coordinates in degrees [0, 360).
 */
export function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const toDeg = (rad: number) => (rad * 180) / Math.PI

  const dLng = toRad(lng2 - lng1)
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)

  const y = Math.sin(dLng) * Math.cos(phi2)
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng)

  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360
  return Math.round(bearing * 10) / 10
}

/**
 * Projects a point onto a line segment [p1, p2].
 * Returns the closest point on the segment and the normalized interpolation factor t [0, 1].
 */
function projectPointOnSegment(
  p: [number, number], // [lng, lat]
  p1: [number, number],
  p2: [number, number],
): { point: Coordinate; t: number } {
  const [x, y] = p
  const [x1, y1] = p1
  const [x2, y2] = p2

  // Latitude projection factor in radians for metric space accuracy (Plate Carrée metric projection)
  const meanLatRad = (((y1 + y2) / 2) * Math.PI) / 180
  const cosLat = Math.cos(meanLatRad)

  const dx = (x2 - x1) * cosLat
  const dy = y2 - y1

  if (dx === 0 && dy === 0) {
    return { point: [x1, y1], t: 0 }
  }

  // Projection scalar parameter t = dot(p - p1, p2 - p1) / len^2
  const px = (x - x1) * cosLat
  const py = y - y1

  let t = (px * dx + py * dy) / (dx * dx + dy * dy)
  t = Math.max(0, Math.min(1, t)) // Clamp to segment endpoints

  return {
    point: [x1 + t * (x2 - x1), y1 + t * (y2 - y1)],
    t,
  }
}

/**
 * Snaps a raw GPS point to the nearest road segment of a polyline.
 *
 * @param gpsCoord [lng, lat] raw measured GPS coordinate
 * @param polyline Array of [lng, lat] coordinates representing the road geometry
 * @param maxDistanceThresholdMeters Max deviation threshold to consider matched (default: 45m)
 */
export function snapToRoad(
  gpsCoord: Coordinate,
  polyline: Coordinate[] | null | undefined,
  maxDistanceThresholdMeters: number = 45,
): RoadSnapResult {
  const [gpsLng, gpsLat] = gpsCoord

  // If no polyline is available, return raw coordinate
  if (!polyline || polyline.length === 0) {
    return {
      snappedCoord: [gpsLng, gpsLat],
      distanceToRoadMeters: 0,
      bearing: 0,
      segmentIndex: 0,
      isMatched: false,
    }
  }

  // Single-point polyline (e.g. destination waypoint or stationary stop)
  if (polyline.length === 1) {
    const p = polyline[0]
    const distKm = haversineKm(gpsLat, gpsLng, p[1], p[0])
    const distMeters = Math.round(distKm * 1000 * 10) / 10
    const isMatched = distMeters <= maxDistanceThresholdMeters

    return {
      snappedCoord: isMatched ? [p[0], p[1]] : [gpsLng, gpsLat],
      distanceToRoadMeters: distMeters,
      bearing: 0,
      segmentIndex: 0,
      isMatched,
    }
  }

  let minDistanceMeters = Infinity
  let bestSnappedCoord: Coordinate = [gpsLng, gpsLat]
  let bestBearing = 0
  let bestSegmentIndex = 0

  for (let i = 0; i < polyline.length - 1; i++) {
    const p1 = polyline[i]
    const p2 = polyline[i + 1]

    const { point: candidatePoint } = projectPointOnSegment([gpsLng, gpsLat], p1, p2)
    const distKm = haversineKm(gpsLat, gpsLng, candidatePoint[1], candidatePoint[0])
    const distMeters = distKm * 1000

    if (distMeters < minDistanceMeters) {
      minDistanceMeters = distMeters
      bestSnappedCoord = [
        Math.round(candidatePoint[0] * 1e7) / 1e7,
        Math.round(candidatePoint[1] * 1e7) / 1e7,
      ]
      bestBearing = calculateBearing(p1[1], p1[0], p2[1], p2[0])
      bestSegmentIndex = i
    }
  }

  const isMatched = minDistanceMeters <= maxDistanceThresholdMeters

  return {
    snappedCoord: isMatched ? bestSnappedCoord : [gpsLng, gpsLat],
    distanceToRoadMeters: Math.round(minDistanceMeters * 10) / 10,
    bearing: bestBearing,
    segmentIndex: bestSegmentIndex,
    isMatched,
  }
}
