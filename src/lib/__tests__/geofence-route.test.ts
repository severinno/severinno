import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockRequireUser = vi.hoisted(() => vi.fn())
const mockCheckGeofences = vi.hoisted(() => vi.fn())
const mockIndexProviderLocation = vi.hoisted(() => vi.fn())
const mockHaversineKm = vi.hoisted(() => vi.fn())
const mockCalculateRouteAndEta = vi.hoisted(() => vi.fn())
const mockSendWhatsApp = vi.hoisted(() => vi.fn())
const mockLoggerInfo = vi.hoisted(() => vi.fn())
const mockLoggerDebug = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}))

vi.mock("@/lib/auth", () => ({
  requireUser: mockRequireUser,
  requireRole: vi.fn().mockResolvedValue({ role: "ADMIN" }),
}))

vi.mock("@/lib/geofencing", () => ({
  checkGeofences: mockCheckGeofences,
}))

vi.mock("@/lib/redis-geo", () => ({
  indexProviderLocation: mockIndexProviderLocation,
}))

vi.mock("@/lib/geo-server", () => ({
  haversineKm: mockHaversineKm,
}))

vi.mock("@/lib/osrm", () => ({
  calculateRouteAndEta: mockCalculateRouteAndEta,
}))

vi.mock("@/lib/whatsapp", () => ({
  sendWhatsApp: mockSendWhatsApp,
}))

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
}))

vi.mock("@/lib/api-server", () => ({
  badRequest: (msg: string) => new Error(`BAD_REQUEST: ${msg}`),
  forbidden: (msg: string) => new Error(`FORBIDDEN: ${msg}`),
  notFound: (msg: string) => new Error(`NOT_FOUND: ${msg}`),
  handleError: (e: unknown) => {
    const msg = e instanceof Error ? e.message : "Unknown error"
    if (msg.startsWith("NOT_FOUND")) return new Response(JSON.stringify({ error: msg }), { status: 404 })
    if (msg.startsWith("FORBIDDEN")) return new Response(JSON.stringify({ error: msg }), { status: 403 })
    if (msg.startsWith("BAD_REQUEST")) return new Response(JSON.stringify({ error: msg }), { status: 400 })
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  },
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: mockLoggerDebug,
  },
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from "@/app/api/tracking/[id]/geofence/route"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    providerId: "provider-1",
    clientId: "client-1",
    lat: -23.5505,
    lng: -46.6333,
    status: "CONFIRMED",
    geofenceAlertSentAt: null,
    client: { name: "Cliente Teste" },
    provider: { name: "João Silva" },
    ...overrides,
  }
}

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/tracking/booking-1/geofence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/tracking/[id]/geofence — unified endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ userId: "provider-1", role: "PROVIDER" })
    mockFindUnique.mockResolvedValue(makeBooking())
    mockIndexProviderLocation.mockResolvedValue(undefined)
    mockCheckGeofences.mockResolvedValue([])
    mockHaversineKm.mockReturnValue(0.05) // 50m
    mockCalculateRouteAndEta.mockResolvedValue({ distanceKm: 0.3, durationMin: 2 })
    mockSendWhatsApp.mockResolvedValue(undefined)
    mockUpdate.mockResolvedValue({})
  })

  it("returns 400 when providerLat/providerLng missing", async () => {
    const req = makeRequest({})
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(400)
  })

  it("returns 404 when booking not found", async () => {
    mockFindUnique.mockResolvedValue(null)
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "nonexistent" }) })
    expect(res.status).toBe(404)
  })

  it("returns 403 when caller is not the provider", async () => {
    mockRequireUser.mockResolvedValue({ userId: "other-user", role: "CLIENT" })
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(403)
  })

  it("allows ADMIN role", async () => {
    mockRequireUser.mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it("calls indexProviderLocation to keep spatial index fresh", async () => {
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(mockIndexProviderLocation).toHaveBeenCalledWith("provider-1", -23.55, -46.63)
  })

  it("runs geofencing engine", async () => {
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(mockCheckGeofences).toHaveBeenCalledWith("provider-1", -23.55, -46.63)
  })

  it("triggers when engine fires enter event for this booking", async () => {
    mockCheckGeofences.mockResolvedValue([
      {
        type: "enter",
        bookingId: "booking-1",
        providerId: "provider-1",
        distanceMeters: 50,
      },
    ])
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    const json = await res.json()
    expect(json.triggered).toBe(true)
    expect(json.engineEvents).toBe(1)
    expect(mockSendWhatsApp).toHaveBeenCalled()
    expect(mockUpdate).toHaveBeenCalled()
  })

  it("returns idempotent when geofenceAlertSentAt already set", async () => {
    mockFindUnique.mockResolvedValue(
      makeBooking({ geofenceAlertSentAt: new Date("2026-01-01") }),
    )
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    const json = await res.json()
    expect(json.triggered).toBe(false)
    expect(json.reason).toContain("já enviado")
    expect(mockSendWhatsApp).not.toHaveBeenCalled()
  })

  it("returns not triggered when OSRM ETA is too far", async () => {
    mockCalculateRouteAndEta.mockResolvedValue({ distanceKm: 5.0, durationMin: 15 })
    mockHaversineKm.mockReturnValue(5.0)
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    const json = await res.json()
    expect(json.triggered).toBe(false)
    expect(json.distanceKm).toBe(5.0)
  })

  it("triggers via OSRM ETA fallback when within 1km", async () => {
    mockCheckGeofences.mockResolvedValue([]) // engine didn't trigger
    mockCalculateRouteAndEta.mockResolvedValue({ distanceKm: 0.8, durationMin: 4 })
    mockHaversineKm.mockReturnValue(0.8)
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    const json = await res.json()
    expect(json.triggered).toBe(true)
    expect(mockSendWhatsApp).toHaveBeenCalled()
  })

  it("triggers via OSRM ETA fallback when ETA <= 5min", async () => {
    mockCheckGeofences.mockResolvedValue([])
    mockCalculateRouteAndEta.mockResolvedValue({ distanceKm: 3.0, durationMin: 4 })
    mockHaversineKm.mockReturnValue(3.0)
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    const json = await res.json()
    expect(json.triggered).toBe(true)
  })

  it("returns not triggered when booking has no coordinates", async () => {
    mockFindUnique.mockResolvedValue(makeBooking({ lat: 0, lng: 0 }))
    mockCheckGeofences.mockResolvedValue([])
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    const res = await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    const json = await res.json()
    expect(json.triggered).toBe(false)
    expect(json.reason).toContain("sem coordenadas")
  })

  it("sends correct WhatsApp message with distance text", async () => {
    mockCheckGeofences.mockResolvedValue([
      { type: "enter", bookingId: "booking-1", distanceMeters: 50 },
    ])
    mockHaversineKm.mockReturnValue(0.05) // 50m
    const req = makeRequest({ providerLat: -23.55, providerLng: -46.63 })
    await POST(req, { params: Promise.resolve({ id: "booking-1" }) })
    const call = mockSendWhatsApp.mock.calls[0][0]
    expect(call.title).toContain("João Silva")
    expect(call.body).toContain("muito perto")
  })
})
