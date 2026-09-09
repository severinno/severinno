/**
 * Waypoints — multi-stop tracking for bookings.
 *
 * Provides ordered waypoint management for bookings with multiple stops.
 * The geofencing engine can use getCurrentWaypoint() to determine which
 * stop the provider should be approaching next.
 */
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo-server"
import logger from "@/lib/logger"

// waypointDb exists after prisma migrate dev (schema has Waypoint model)
// Type assertion needed because prisma generate hasn't run in this env
const waypointDb = (db as Record<string, unknown>)["waypoint"] as {
  findMany: (args: unknown) => Promise<WaypointData[]>
  update: (args: unknown) => Promise<WaypointData>
}

export type WaypointData = {
  id: string
  bookingId: string
  order: number
  label: string | null
  lat: number
  lng: number
  arrivalEstimate: Date | null
  arrivedAt: Date | null
  geofenceRadiusMeters: number
}

/**
 * Fetch ordered waypoints for a booking.
 */
export async function getWaypoints(bookingId: string): Promise<WaypointData[]> {
  const waypoints = await waypointDb.findMany({
    where: { bookingId },
    orderBy: { order: "asc" },
  })
  return waypoints
}

/**
 * Find the next unvisited waypoint closest to the provider's current position.
 *
 * Uses a simple heuristic: among all waypoints without an arrivedAt timestamp,
 * pick the one nearest to the provider. This handles the case where a provider
 * may skip stops or arrive out of order.
 */
export async function getCurrentWaypoint(
  bookingId: string,
  providerLat: number,
  providerLng: number,
): Promise<WaypointData | null> {
  const unvisited = await waypointDb.findMany({
    where: {
      bookingId,
      arrivedAt: null,
    },
    orderBy: { order: "asc" },
  })

  if (unvisited.length === 0) return null

  let nearest = unvisited[0]
  let nearestDist = Infinity

  for (const wp of unvisited) {
    const dist = haversineKm(providerLat, providerLng, wp.lat, wp.lng)
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = wp
    }
  }

  return nearest
}

/**
 * Mark a waypoint as arrived.
 */
export async function markWaypointArrived(waypointId: string): Promise<WaypointData> {
  const waypoint = await waypointDb.update({
    where: { id: waypointId },
    data: { arrivedAt: new Date() },
  })
  logger.info({ waypointId, bookingId: waypoint.bookingId }, "waypoint: marked as arrived")
  return waypoint
}

/**
 * Calculate route progress for a booking.
 */
export async function calculateRouteProgress(
  bookingId: string,
): Promise<{ completed: number; total: number; current: number }> {
  const waypoints = await waypointDb.findMany({
    where: { bookingId },
    orderBy: { order: "asc" },
    select: { id: true, arrivedAt: true, order: true },
  })

  if (waypoints.length === 0) {
    return { completed: 0, total: 0, current: 0 }
  }

  const completed = waypoints.filter((wp) => wp.arrivedAt !== null).length
  // current = order of the first unvisited waypoint (1-indexed)
  const nextUnvisited = waypoints.find((wp) => wp.arrivedAt === null)
  const current = nextUnvisited ? nextUnvisited.order : waypoints.length

  return { completed, total: waypoints.length, current }
}
