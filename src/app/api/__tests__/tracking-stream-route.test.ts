import { describe, it, expect, vi, beforeEach } from "vitest"
import { POST as streamPOST } from "../tracking/[id]/stream/route"
import { POST as geofencePOST } from "../tracking/[id]/geofence/route"

const mockDb = vi.hoisted(() => ({
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const mockRealtime = vi.hoisted(() => ({
  sendTrackingPosition: vi.fn().mockResolvedValue(undefined),
  emitRealtime: vi.fn().mockResolvedValue(undefined),
}))

const mockRedisGeo = vi.hoisted(() => ({
  indexProviderLocation: vi.fn().mockResolvedValue(undefined),
}))

const mockGeofencing = vi.hoisted(() => ({
  checkGeofences: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/db", () => ({ default: mockDb, db: mockDb }))
vi.mock("@/lib/realtime-client", () => mockRealtime)
vi.mock("@/lib/redis-geo", () => mockRedisGeo)
vi.mock("@/lib/geofencing", () => mockGeofencing)
vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(true),
}))
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: "prov-1", role: "PROVIDER" }),
}))
vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { general: { interval: 60000, maxRequests: 100 } },
}))
const mockLoggerInstance = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))
vi.mock("@/lib/logger", () => ({
  default: mockLoggerInstance,
  logger: mockLoggerInstance,
}))

describe("Tracking live positions via WebSocket", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("POST /api/tracking/[id]/stream", () => {
    it("recebe posição do prestador e emite sendTrackingPosition para o cliente via WebSocket", async () => {
      mockDb.booking.findUnique.mockResolvedValueOnce({
        id: "b-1",
        providerId: "prov-1",
        clientId: "client-1",
        status: "IN_PROGRESS",
      })

      const req = new Request("http://localhost/api/tracking/b-1/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: -18.85, lng: -41.95, speed: 40 }),
      })

      const res = await streamPOST(req, { params: Promise.resolve({ id: "b-1" }) })
      const data = await res.json()

      expect(res.status).toBe(200)
      expect(data.ok).toBe(true)
      expect(mockRealtime.sendTrackingPosition).toHaveBeenCalledWith({
        bookingId: "b-1",
        clientId: "client-1",
        lat: -18.85,
        lng: -41.95,
      })
    })

    it("retorna 403 se o usuário não for o prestador atribuído", async () => {
      mockDb.booking.findUnique.mockResolvedValueOnce({
        id: "b-1",
        providerId: "outro-prestador",
        clientId: "client-1",
        status: "IN_PROGRESS",
      })

      const req = new Request("http://localhost/api/tracking/b-1/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: -18.85, lng: -41.95 }),
      })

      const res = await streamPOST(req, { params: Promise.resolve({ id: "b-1" }) })
      expect(res.status).toBe(403)
      expect(mockRealtime.sendTrackingPosition).not.toHaveBeenCalled()
    })
  })

  describe("POST /api/tracking/[id]/geofence", () => {
    it("emite sendTrackingPosition via WebSocket ao receber posição no geofence", async () => {
      mockDb.booking.findUnique.mockResolvedValueOnce({
        id: "b-1",
        providerId: "prov-1",
        clientId: "client-1",
        lat: -18.85,
        lng: -41.95,
        status: "IN_PROGRESS",
        geofenceAlertSentAt: new Date(),
        client: { name: "Maria" },
        provider: { name: "João" },
      })

      const req = new Request("http://localhost/api/tracking/b-1/geofence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerLat: -18.86, providerLng: -41.96 }),
      })

      const res = await geofencePOST(req, { params: Promise.resolve({ id: "b-1" }) })
      expect(res.status).toBe(200)
      expect(mockRealtime.sendTrackingPosition).toHaveBeenCalledWith({
        bookingId: "b-1",
        clientId: "client-1",
        lat: -18.86,
        lng: -41.96,
      })
    })
  })
})
