/**
 * Tests for geofencing.ts — real-time provider proximity alerts.
 *
 * Coverage:
 *   ✅ checkGeofences: empty array when no active bookings
 *   ✅ checkGeofences: detects provider ENTERED geofence
 *   ✅ checkGeofences: detects provider EXITED geofence
 *   ✅ checkGeofences: respects debounce (no duplicate events within debounceMinutes)
 *   ✅ checkGeofences: handles Redis lock acquisition failure (skips booking)
 *   ✅ checkGeofences: handles missing Redis (single instance, no lock needed)
 *   ✅ checkGeofences: skips bookings with zero lat/lng
 *   ✅ checkGeofences: sends notification on enter event
 *   ✅ getGeofenceStatus: returns correct shape with inside/lastEventAt
 *   ✅ getGeofenceStatus: defaults when no cached state
 *   ✅ getGeofenceAuditTrail: returns events from cache
 *   ✅ getGeofenceAuditTrail: returns empty array on cache miss
 *   ✅ getGeofenceAuditTrail: returns empty array on Redis error
 *   ✅ checkGeofences: swallows top-level DB errors gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted before vi.mock — Vitest requirement)
// ---------------------------------------------------------------------------

const mockFindMany = vi.hoisted(() => vi.fn())
const mockCacheGet = vi.hoisted(() => vi.fn())
const mockCacheSet = vi.hoisted(() => vi.fn())
const mockGetClient = vi.hoisted(() => vi.fn())
const mockHaversineKm = vi.hoisted(() => vi.fn())
const mockCaptureError = vi.hoisted(() => vi.fn())
const mockLoggerInfo = vi.hoisted(() => vi.fn())
const mockLoggerWarn = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())
const mockLoggerDebug = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findMany: mockFindMany,
    },
  },
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
  getClient: mockGetClient,
}))

vi.mock("@/lib/geo-server", () => ({
  haversineKm: mockHaversineKm,
}))

vi.mock("@/lib/sentry", () => ({
  captureError: mockCaptureError,
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: mockLoggerDebug,
  },
}))

// ---------------------------------------------------------------------------
// Import module under test AFTER mocks
// ---------------------------------------------------------------------------

import { checkGeofences, getGeofenceStatus, getGeofenceAuditTrail } from "../geofencing"
import type { GeofenceEvent } from "../geofencing"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    lat: -23.5505,
    lng: -46.6333,
    clientId: "client-1",
    client: { name: "Cliente Teste" },
    service: { title: "Encanador" },
    ...overrides,
  }
}

const _ENTER_EVENT_BASE: Omit<GeofenceEvent, "lat" | "lng" | "distanceMeters" | "timestamp"> = {
  type: "enter",
  providerId: "provider-1",
  providerName: "Prestador",
  clientId: "client-1",
  bookingId: "booking-1",
  zoneRadiusMeters: 200,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeNow(ms: number) {
  vi.spyOn(Date, "now").mockReturnValue(ms)
}

// ---------------------------------------------------------------------------
// Before / After
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()

  // Default: no bookings found
  mockFindMany.mockResolvedValue([])

  // Default: cache miss
  mockCacheGet.mockResolvedValue(null)
  mockCacheSet.mockResolvedValue(undefined as unknown as string)

  // Default: no Redis client (single instance)
  mockGetClient.mockReturnValue(null)

  // Default: haversine returns 0.05 km (50m — inside default 200m radius)
  mockHaversineKm.mockReturnValue(0.05)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════
// checkGeofences
// ═══════════════════════════════════════════════════════════════════════════

describe("checkGeofences", () => {
  it("returns empty array when no active bookings", async () => {
    mockFindMany.mockResolvedValue([])

    const events = await checkGeofences("provider-1", -23.55, -46.63)

    expect(events).toEqual([])
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        providerId: "provider-1",
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
        lat: { not: 0 },
        lng: { not: 0 },
      },
      select: {
        id: true,
        lat: true,
        lng: true,
        clientId: true,
        client: { select: { name: true } },
        service: { select: { title: true } },
      },
      take: 10,
    })
  })

  it("detects provider ENTERED geofence (was outside, now inside)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    // Previous state: was outside
    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 0 })

    // Provider is 100m away → inside 200m radius
    mockHaversineKm.mockReturnValue(0.1)

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("enter")
    expect(events[0].providerId).toBe("provider-1")
    expect(events[0].bookingId).toBe("booking-1")
    expect(events[0].clientId).toBe("client-1")
    expect(events[0].distanceMeters).toBe(100)
    expect(events[0].zoneRadiusMeters).toBe(200)

    // State should be updated to inside
    expect(mockCacheSet).toHaveBeenCalledWith(
      "geofence:provider-1:booking-1",
      { inside: true, lastEventAt: expect.any(Number) },
      3600,
    )
  })

  it("detects provider EXITED geofence (was inside, now outside)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    // Previous state: was inside
    mockCacheGet.mockResolvedValue({ inside: true, lastEventAt: 0 })

    // Provider is 500m away → outside 200m radius
    mockHaversineKm.mockReturnValue(0.5)

    const events = await checkGeofences("provider-1", -23.56, -46.64)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("exit")
    expect(events[0].distanceMeters).toBe(500)

    // State should be updated to outside
    expect(mockCacheSet).toHaveBeenCalledWith(
      "geofence:provider-1:booking-1",
      { inside: false, lastEventAt: expect.any(Number) },
      3600,
    )
  })

  it("respects debounce — won't fire duplicate events within debounceMinutes", async () => {
    const now = Date.now()
    fakeNow(now)

    mockFindMany.mockResolvedValue([makeBooking()])

    // Previous state: was outside, with a very recent event
    const prevLastEventAt = now - 60_000 // 1 minute ago
    mockCacheGet.mockResolvedValue({
      inside: false,
      lastEventAt: prevLastEventAt,
    })

    // Provider is inside (50m)
    mockHaversineKm.mockReturnValue(0.05)

    // debounceMinutes = 5, so 1 min ago is within debounce window
    const events = await checkGeofences("provider-1", -23.551, -46.634, {
      debounceMinutes: 5,
    })

    expect(events).toEqual([])
    // State should still be updated but no event fired; lastEventAt preserved from prev state
    expect(mockCacheSet).toHaveBeenCalledWith(
      "geofence:provider-1:booking-1",
      { inside: true, lastEventAt: prevLastEventAt },
      3600,
    )
  })

  it("fires event when debounce window has elapsed", async () => {
    const now = Date.now()
    fakeNow(now)

    mockFindMany.mockResolvedValue([makeBooking()])

    // Previous state: was outside, event was 10 minutes ago (beyond 5min debounce)
    mockCacheGet.mockResolvedValue({
      inside: false,
      lastEventAt: now - 10 * 60_000,
    })

    mockHaversineKm.mockReturnValue(0.05)

    const events = await checkGeofences("provider-1", -23.551, -46.634, {
      debounceMinutes: 5,
    })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("enter")
  })

  it("handles Redis lock acquisition failure (skips booking)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])

    const mockRedis = {
      set: vi.fn().mockResolvedValue(null), // NX returns null → lock not acquired
      del: vi.fn().mockResolvedValue(1),
    }
    mockGetClient.mockReturnValue(mockRedis)

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    // Booking skipped because lock wasn't acquired
    expect(events).toEqual([])
    expect(mockCacheGet).not.toHaveBeenCalled()
  })

  it("handles missing Redis (single instance, no lock needed)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    mockGetClient.mockReturnValue(null) // no Redis
    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 0 })
    mockHaversineKm.mockReturnValue(0.05)

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    // Should proceed without lock and detect enter
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("enter")
    // No lock key set because no Redis
    expect(mockCacheGet).toHaveBeenCalledWith("geofence:provider-1:booking-1")
  })

  it("handles Redis lock error gracefully (proceeds without lock)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])

    const mockRedis = {
      set: vi.fn().mockRejectedValue(new Error("Connection refused")),
      del: vi.fn(),
    }
    mockGetClient.mockReturnValue(mockRedis)

    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 0 })
    mockHaversineKm.mockReturnValue(0.05)

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    // Should proceed because lock error sets lockAcquired = true
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("enter")
  })

  it("skips bookings with zero lat/lng", async () => {
    mockFindMany.mockResolvedValue([makeBooking({ lat: 0, lng: 0 })])

    const events = await checkGeofences("provider-1", -23.55, -46.63)

    expect(events).toEqual([])
    // haversineKm should not be called for zero-coord bookings
    expect(mockHaversineKm).not.toHaveBeenCalled()
  })

  it("sends notification on enter event", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 0 })
    mockHaversineKm.mockReturnValue(0.05)

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe("enter")

    // notifyGeofenceEvent is fire-and-forget; flush microtasks to let it resolve
    await vi.advanceTimersByTimeAsync(100)

    // captureError called inside notifyGeofenceEvent for observability
    expect(mockCaptureError).toHaveBeenCalled()
  })

  it("stores audit trail in cache after enter event", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    // State key returns outside state; audit key returns null (no prior events)
    mockCacheGet.mockImplementation(async (key: string) => {
      if (key.startsWith("geofence:audit:")) return null
      return { inside: false, lastEventAt: 0 }
    })
    mockHaversineKm.mockReturnValue(0.05)

    await checkGeofences("provider-1", -23.551, -46.634)

    // Flush fire-and-forget notifyGeofenceEvent
    await vi.advanceTimersByTimeAsync(100)

    // Audit trail should be stored via cacheSet
    const auditCall = mockCacheSet.mock.calls.find(([key]) => key === "geofence:audit:booking-1")
    expect(auditCall).toBeDefined()
    expect(auditCall![1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "enter", bookingId: "booking-1" })]),
    )
    expect(auditCall![2]).toBe(86400) // 24h TTL
  })

  it("swallows top-level DB errors gracefully", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection lost"))

    const events = await checkGeofences("provider-1", -23.55, -46.63)

    expect(events).toEqual([])
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "provider-1" }),
      "geofence: check failed",
    )
  })

  it("releases Redis lock after processing", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 0 })
    mockHaversineKm.mockReturnValue(0.05)

    const mockRedis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
    }
    mockGetClient.mockReturnValue(mockRedis)

    await checkGeofences("provider-1", -23.551, -46.634)

    expect(mockRedis.del).toHaveBeenCalledWith("geofence:lock:provider-1:booking-1")
  })

  it("does not fire event when provider stays inside (no state change)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    mockCacheGet.mockResolvedValue({ inside: true, lastEventAt: 0 }) // already inside
    mockHaversineKm.mockReturnValue(0.05) // still inside

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    expect(events).toEqual([])
    // No new cacheSet since isInside === wasInside
    expect(mockCacheSet).not.toHaveBeenCalled()
  })

  it("does not fire event when provider stays outside (no state change)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 0 }) // already outside
    mockHaversineKm.mockReturnValue(0.5) // still outside

    const events = await checkGeofences("provider-1", -23.56, -46.64)

    expect(events).toEqual([])
    expect(mockCacheSet).not.toHaveBeenCalled()
  })

  it("handles multiple bookings in a single call", async () => {
    mockFindMany.mockResolvedValue([
      makeBooking({ id: "booking-1", clientId: "c-1" }),
      makeBooking({ id: "booking-2", clientId: "c-2" }),
    ])
    // Both start outside
    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 0 })
    mockHaversineKm.mockReturnValue(0.05) // both inside

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    expect(events).toHaveLength(2)
    expect(events[0].bookingId).toBe("booking-1")
    expect(events[1].bookingId).toBe("booking-2")
  })

  it("updates state without firing event when entering under debounce", async () => {
    const now = Date.now()
    fakeNow(now)

    mockFindMany.mockResolvedValue([makeBooking()])

    const prevLastEventAt = now - 60_000 // 1 min ago → within 5 min debounce
    mockCacheGet.mockResolvedValue({
      inside: false,
      lastEventAt: prevLastEventAt,
    })
    mockHaversineKm.mockReturnValue(0.05) // inside

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    expect(events).toEqual([])
    // State should still be updated even without firing; lastEventAt preserved from prev state
    expect(mockCacheSet).toHaveBeenCalledWith(
      "geofence:provider-1:booking-1",
      { inside: true, lastEventAt: prevLastEventAt },
      3600,
    )
  })

  it("uses default config (radiusMeters=200, debounceMinutes=5)", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    mockCacheGet.mockResolvedValue(null) // no previous state → wasInside = false

    // Provider at exactly 200m — should be inside (<=)
    mockHaversineKm.mockReturnValue(0.2)

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    expect(events).toHaveLength(1)
    expect(events[0].zoneRadiusMeters).toBe(200)
  })

  it("provider at 201m is outside default 200m radius", async () => {
    mockFindMany.mockResolvedValue([makeBooking()])
    mockCacheGet.mockResolvedValue(null) // no previous state → wasInside = false

    // Provider at 201m — should be outside
    mockHaversineKm.mockReturnValue(0.201)

    const events = await checkGeofences("provider-1", -23.551, -46.634)

    expect(events).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// getGeofenceStatus
// ═══════════════════════════════════════════════════════════════════════════

describe("getGeofenceStatus", () => {
  it("returns correct shape with inside=true and lastEventAt from cache", async () => {
    mockCacheGet.mockResolvedValue({ inside: true, lastEventAt: 1700000000000 })

    const status = await getGeofenceStatus("booking-1", "provider-1")

    expect(status).toEqual({
      inside: true,
      distanceMeters: null,
      lastEventAt: 1700000000000,
    })
    expect(mockCacheGet).toHaveBeenCalledWith("geofence:provider-1:booking-1")
  })

  it("returns defaults when no cached state exists", async () => {
    mockCacheGet.mockResolvedValue(null)

    const status = await getGeofenceStatus("booking-1", "provider-1")

    expect(status).toEqual({
      inside: false,
      distanceMeters: null,
      lastEventAt: null,
    })
  })

  it("returns inside=false when cache has inside=false", async () => {
    mockCacheGet.mockResolvedValue({ inside: false, lastEventAt: 1700000000000 })

    const status = await getGeofenceStatus("booking-1", "provider-1")

    expect(status.inside).toBe(false)
    expect(status.lastEventAt).toBe(1700000000000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// getGeofenceAuditTrail
// ═══════════════════════════════════════════════════════════════════════════

describe("getGeofenceAuditTrail", () => {
  it("returns events from cache", async () => {
    const cachedEvents: GeofenceEvent[] = [
      {
        type: "enter",
        providerId: "provider-1",
        providerName: "Prestador",
        clientId: "client-1",
        bookingId: "booking-1",
        lat: -23.551,
        lng: -46.634,
        distanceMeters: 100,
        zoneRadiusMeters: 200,
        timestamp: "2025-01-01T00:00:00.000Z",
      },
      {
        type: "exit",
        providerId: "provider-1",
        providerName: "Prestador",
        clientId: "client-1",
        bookingId: "booking-1",
        lat: -23.56,
        lng: -46.64,
        distanceMeters: 500,
        zoneRadiusMeters: 200,
        timestamp: "2025-01-01T00:05:00.000Z",
      },
    ]
    mockCacheGet.mockResolvedValue(cachedEvents)

    const trail = await getGeofenceAuditTrail("booking-1")

    expect(trail).toEqual(cachedEvents)
    expect(mockCacheGet).toHaveBeenCalledWith("geofence:audit:booking-1")
  })

  it("returns empty array on cache miss", async () => {
    mockCacheGet.mockResolvedValue(null)

    const trail = await getGeofenceAuditTrail("booking-1")

    expect(trail).toEqual([])
  })

  it("returns empty array on Redis error", async () => {
    mockCacheGet.mockRejectedValue(new Error("Redis connection lost"))

    const trail = await getGeofenceAuditTrail("booking-1")

    expect(trail).toEqual([])
  })

  it("returns empty array when cache returns undefined", async () => {
    mockCacheGet.mockResolvedValue(undefined)

    const trail = await getGeofenceAuditTrail("booking-1")

    expect(trail).toEqual([])
  })
})
