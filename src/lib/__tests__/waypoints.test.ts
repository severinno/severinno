import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    waypoint: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("../db", () => ({ db: mockDb }))

vi.mock("../geo-server", () => ({
  haversineKm: (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  },
}))

import {
  getWaypoints,
  getCurrentWaypoint,
  markWaypointArrived,
  calculateRouteProgress,
} from "../waypoints"

const BOOKING_ID = "booking-123"

const waypoints = [
  { id: "wp-1", bookingId: BOOKING_ID, order: 1, label: "Start", lat: -23.55, lng: -46.63, arrivalEstimate: null, arrivedAt: null, geofenceRadiusMeters: 200, createdAt: new Date(), updatedAt: new Date() },
  { id: "wp-2", bookingId: BOOKING_ID, order: 2, label: "Middle", lat: -23.56, lng: -46.64, arrivalEstimate: null, arrivedAt: null, geofenceRadiusMeters: 200, createdAt: new Date(), updatedAt: new Date() },
  { id: "wp-3", bookingId: BOOKING_ID, order: 3, label: "End", lat: -23.57, lng: -46.65, arrivalEstimate: null, arrivedAt: null, geofenceRadiusMeters: 200, createdAt: new Date(), updatedAt: new Date() },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getWaypoints", () => {
  it("returns waypoints in correct order", async () => {
    mockDb.waypoint.findMany.mockResolvedValue(waypoints)
    const result = await getWaypoints(BOOKING_ID)
    expect(result).toHaveLength(3)
    expect(result[0].order).toBe(1)
    expect(result[1].order).toBe(2)
    expect(result[2].order).toBe(3)
    expect(mockDb.waypoint.findMany).toHaveBeenCalledWith({
      where: { bookingId: BOOKING_ID },
      orderBy: { order: "asc" },
    })
  })

  it("returns empty array for booking with no waypoints", async () => {
    mockDb.waypoint.findMany.mockResolvedValue([])
    const result = await getWaypoints("empty-booking")
    expect(result).toHaveLength(0)
  })
})

describe("getCurrentWaypoint", () => {
  it("finds nearest unvisited waypoint", async () => {
    mockDb.waypoint.findMany.mockResolvedValue([waypoints[0], waypoints[2]])

    // Provider is near wp-3 (lat: -23.57, lng: -46.65)
    const result = await getCurrentWaypoint(BOOKING_ID, -23.571, -46.651)
    expect(result).not.toBeNull()
    expect(result!.id).toBe("wp-3")
  })

  it("returns null when all waypoints visited", async () => {
    mockDb.waypoint.findMany.mockResolvedValue([])
    const result = await getCurrentWaypoint(BOOKING_ID, -23.55, -46.63)
    expect(result).toBeNull()
  })

  it("returns null when no waypoints exist", async () => {
    mockDb.waypoint.findMany.mockResolvedValue([])
    const result = await getCurrentWaypoint(BOOKING_ID, -23.55, -46.63)
    expect(result).toBeNull()
  })

  it("prefers unvisited waypoint closest to provider", async () => {
    mockDb.waypoint.findMany.mockResolvedValue([waypoints[1], waypoints[2]])

    // Provider is near wp-3
    const result = await getCurrentWaypoint(BOOKING_ID, -23.569, -46.649)
    expect(result!.id).toBe("wp-3")
  })
})

describe("markWaypointArrived", () => {
  it("marks waypoint as arrived", async () => {
    const updated = { ...waypoints[0], arrivedAt: new Date() }
    mockDb.waypoint.update.mockResolvedValue(updated)
    const result = await markWaypointArrived("wp-1")
    expect(result.arrivedAt).not.toBeNull()
    expect(mockDb.waypoint.update).toHaveBeenCalledWith({
      where: { id: "wp-1" },
      data: { arrivedAt: expect.any(Date) },
    })
  })
})

describe("calculateRouteProgress", () => {
  it("returns correct counts when no waypoints", async () => {
    mockDb.waypoint.findMany.mockResolvedValue([])
    const result = await calculateRouteProgress(BOOKING_ID)
    expect(result).toEqual({ completed: 0, total: 0, current: 0 })
  })

  it("returns correct counts when none visited", async () => {
    mockDb.waypoint.findMany.mockResolvedValue(
      waypoints.map((w) => ({ ...w, arrivedAt: null })),
    )
    const result = await calculateRouteProgress(BOOKING_ID)
    expect(result).toEqual({ completed: 0, total: 3, current: 1 })
  })

  it("returns correct counts when some visited", async () => {
    const wp1Visited = { ...waypoints[0], arrivedAt: new Date(), id: "wp-1" }
    const wp2Visited = { ...waypoints[1], arrivedAt: new Date(), id: "wp-2" }
    mockDb.waypoint.findMany.mockResolvedValue([wp1Visited, wp2Visited, { ...waypoints[2], arrivedAt: null }])
    const result = await calculateRouteProgress(BOOKING_ID)
    expect(result).toEqual({ completed: 2, total: 3, current: 3 })
  })

  it("returns correct counts when all visited", async () => {
    const allVisited = waypoints.map((w) => ({ ...w, arrivedAt: new Date() }))
    mockDb.waypoint.findMany.mockResolvedValue(allVisited)
    const result = await calculateRouteProgress(BOOKING_ID)
    expect(result).toEqual({ completed: 3, total: 3, current: 3 })
  })
})
