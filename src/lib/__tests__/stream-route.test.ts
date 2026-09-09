import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindUnique = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockRequireUser = vi.hoisted(() => vi.fn())
const mockCacheGet = vi.hoisted(() => vi.fn())
const mockCacheSet = vi.hoisted(() => vi.fn())
const mockHandleError = vi.hoisted(() => vi.fn())
const mockAssertRateLimit = vi.hoisted(() => vi.fn())
const mockCheckGeofences = vi.hoisted(() => vi.fn())
const mockIndexProviderLocation = vi.hoisted(() => vi.fn())
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
}))

vi.mock("@/lib/redis", () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
}))

vi.mock("@/lib/api-server", () => ({
  handleError: mockHandleError,
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: mockAssertRateLimit,
  RATE_LIMITS: { general: { max: 100, windowMs: 60_000 } },
}))

vi.mock("@/lib/geofencing", () => ({
  checkGeofences: mockCheckGeofences,
}))

vi.mock("@/lib/redis-geo", () => ({
  indexProviderLocation: mockIndexProviderLocation,
}))

vi.mock("@/lib/logger", () => ({
  default: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: mockLoggerDebug,
  },
}))

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Import handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from "@/app/api/tracking/[id]/stream/route"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: "booking-1",
    providerId: "provider-1",
    clientId: "client-1",
    status: "CONFIRMED",
    ...overrides,
  }
}

function makeRequest() {
  return new Request("http://localhost/api/tracking/booking-1/stream", {
    method: "GET",
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/tracking/[id]/stream — SSE streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireUser.mockResolvedValue({ userId: "provider-1", role: "PROVIDER" })
    mockFindUnique.mockResolvedValue(makeBooking())
    mockAssertRateLimit.mockResolvedValue(undefined)
    mockCacheGet.mockResolvedValue(null)
    mockCheckGeofences.mockResolvedValue(null)
    mockIndexProviderLocation.mockResolvedValue(undefined)
    mockHandleError.mockReturnValue(
      new Response(JSON.stringify({ error: "Internal" }), { status: 500 }),
    )
  })

  it("returns 401 when not authenticated", async () => {
    mockRequireUser.mockRejectedValue(new Error("Unauthenticated"))
    const req = makeRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(401)
  })

  it("returns 404 when booking not found", async () => {
    mockFindUnique.mockResolvedValue(null)
    const req = makeRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent" }) })
    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toContain("não encontrado")
  })

  it("returns 403 when caller is not the provider or client", async () => {
    mockRequireUser.mockResolvedValue({ userId: "other-user", role: "CLIENT" })
    mockFindUnique.mockResolvedValue(makeBooking())
    const req = makeRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain("Acesso restrito")
  })

  it("returns proper SSE headers", async () => {
    const req = makeRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toBe("text/event-stream")
    expect(res.headers.get("Cache-Control")).toContain("no-cache")
  })

  it("allows access for clientId", async () => {
    mockRequireUser.mockResolvedValue({ userId: "client-1", role: "CLIENT" })
    const req = makeRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(200)
  })

  it("allows access for ADMIN role", async () => {
    mockRequireUser.mockResolvedValue({ userId: "admin-1", role: "ADMIN" })
    const req = makeRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "booking-1" }) })
    expect(res.status).toBe(200)
  })
})
