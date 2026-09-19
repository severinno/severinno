/**
 * Tests for GET /api/provider/region-demand.
 *
 * Coverage:
 *   ✅ Returns 403 when not a PROVIDER
 *   ✅ Returns regionConfigured: false when provider has no location/radius
 *   ✅ PostGIS path: counts bookings and quotes via $queryRaw
 *   ✅ Haversine fallback: filters bookings/quotes in memory
 *   ✅ Edge cases: zero results, provider without lat, provider without radiusKm
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let _mockSession: { userId: string; role: "CLIENT" | "PROVIDER" | "ADMIN" } | null = null

const mockRequireUser = vi.hoisted(() => vi.fn())
const mockUserFindUnique = vi.hoisted(() => vi.fn())
const mockQueryRaw = vi.hoisted(() => vi.fn())
const mockBookingFindMany = vi.hoisted(() => vi.fn())
const mockQuoteFindMany = vi.hoisted(() => vi.fn())
const mockIsPostGISAvailable = vi.hoisted(() => vi.fn())
const mockHaversineKm = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth", () => ({
  requireUser: (...args: any[]) => mockRequireUser(...args),
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: (...args: any[]) => mockUserFindUnique(...args) },
    $queryRaw: (...args: any[]) => mockQueryRaw(...args),
    booking: { findMany: (...args: any[]) => mockBookingFindMany(...args) },
    quoteRequest: { findMany: (...args: any[]) => mockQuoteFindMany(...args) },
  },
}))

vi.mock("@/lib/postgis", () => ({
  isPostGISAvailable: (...args: any[]) => mockIsPostGISAvailable(...args),
}))

vi.mock("@/lib/geo-server", () => ({
  haversineKm: (...args: any[]) => mockHaversineKm(...args),
}))

vi.mock("@/lib/api-server", () => ({
  handleError: (e: any) => {
    const status = e.status || (e.message === "UNAUTHORIZED" ? 401 : 500)
    const message = e.status ? e.message : "Erro interno do servidor"
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    })
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { general: 100 },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Need to mock date-fns subDays to return a fixed date for deterministic tests
const mockSubDays = vi.hoisted(() => vi.fn())
vi.mock("date-fns", async () => {
  const actual = await vi.importActual("date-fns")
  return {
    ...(actual as object),
    subDays: (...args: any[]) => mockSubDays(...args),
  }
})

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET } from "../provider/region-demand/route"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEFAULT_PROVIDER = {
  id: "prov-123",
  lat: -23.5505,
  lng: -46.6333,
  radiusKm: 50,
  active: true,
}

const SAMPLE_BOOKINGS = [
  { lat: -23.55, lng: -46.63 }, // within 50km of provider
  { lat: -23.56, lng: -46.64 }, // within 50km
  { lat: -22.0, lng: -43.0 }, // far away (Rio de Janeiro, ~360km)
]

const SAMPLE_QUOTES = [
  { lat: -23.55, lng: -46.63 }, // within 50km
  { lat: -22.9, lng: -43.2 }, // far away (~360km)
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSession(
  overrides?: Partial<{ userId: string; role: "CLIENT" | "PROVIDER" | "ADMIN" }>,
) {
  _mockSession = {
    userId: "prov-123",
    role: "PROVIDER",
    ...overrides,
  }
  mockRequireUser.mockResolvedValue(_mockSession)
}

function mockProvider(overrides: Record<string, unknown> = {}) {
  mockUserFindUnique.mockResolvedValue({ ...DEFAULT_PROVIDER, ...overrides } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  _mockSession = null
  mockRequireUser.mockReset()
  mockUserFindUnique.mockReset()
  mockQueryRaw.mockReset()
  mockBookingFindMany.mockReset()
  mockQuoteFindMany.mockReset()
  mockIsPostGISAvailable.mockReset()
  mockHaversineKm.mockReset()
  mockSubDays.mockReturnValue(new Date("2026-07-01T00:00:00Z"))
})

// ===========================================================================
// Tests
// ===========================================================================

describe("GET /api/provider/region-demand — auth", () => {
  it("returns 403 when user is not a PROVIDER", async () => {
    setSession({ role: "CLIENT" })

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(403)
    expect(parsed.body).toHaveProperty("error")
  })

  it("returns 401 when not authenticated", async () => {
    mockRequireUser.mockRejectedValue(new Error("UNAUTHORIZED"))

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(401)
    expect(parsed.body).toHaveProperty("error")
  })
})

describe("GET /api/provider/region-demand — no location configured", () => {
  it("returns regionConfigured: false when provider has no lat", async () => {
    setSession()
    mockProvider({ lat: null })

    const _req = createMockRequest()
    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({
      total: 0,
      bookings: 0,
      quotes: 0,
      regionConfigured: false,
      providerLat: null,
      providerLng: null,
      radiusKm: null,
    })
  })

  it("returns regionConfigured: false when provider has no lng", async () => {
    setSession()
    mockProvider({ lng: null })

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({ regionConfigured: false })
  })

  it("returns regionConfigured: false when provider has no radiusKm", async () => {
    setSession()
    mockProvider({ radiusKm: null })

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({ regionConfigured: false })
  })

  it("returns regionConfigured: false when provider is not found", async () => {
    setSession()
    mockUserFindUnique.mockResolvedValue(null)

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({ regionConfigured: false })
  })
})

describe("GET /api/provider/region-demand — PostGIS path", () => {
  beforeEach(() => {
    setSession()
    mockProvider()
    mockIsPostGISAvailable.mockResolvedValue(true)
  })

  it("counts bookings and quotes via PostGIS ST_DWithin", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ count: BigInt(5) }]) // bookings
      .mockResolvedValueOnce([{ count: BigInt(3) }]) // quotes

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({
      total: 8,
      bookings: 5,
      quotes: 3,
      regionConfigured: true,
      providerLat: -23.5505,
      providerLng: -46.6333,
      radiusKm: 50,
    })
  })

  it("returns zero when no matching bookings or quotes", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([{ count: BigInt(0) }]) // bookings
      .mockResolvedValueOnce([{ count: BigInt(0) }]) // quotes

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({
      total: 0,
      bookings: 0,
      quotes: 0,
    })
  })

  it("returns zero when PostGIS returns empty array", async () => {
    mockQueryRaw
      .mockResolvedValueOnce([]) // bookings (no rows)
      .mockResolvedValueOnce([]) // quotes

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({ total: 0, bookings: 0, quotes: 0 })
  })
})

describe("GET /api/provider/region-demand — Haversine fallback", () => {
  beforeEach(() => {
    setSession()
    mockProvider()
    mockIsPostGISAvailable.mockResolvedValue(false)
  })

  it("counts only bookings and quotes within the provider's radius", async () => {
    mockBookingFindMany.mockResolvedValue(SAMPLE_BOOKINGS)
    mockQuoteFindMany.mockResolvedValue(SAMPLE_QUOTES)

    // Within 50km: first 2 bookings (0km), last booking (360km)
    // Within 50km: first quote (0km), second quote (360km)
    mockHaversineKm
      .mockReturnValueOnce(0) // booking 1: 0km ✓
      .mockReturnValueOnce(0.5) // booking 2: 0.5km ✓
      .mockReturnValueOnce(360) // booking 3: 360km ✗
      .mockReturnValueOnce(0) // quote 1: 0km ✓
      .mockReturnValueOnce(360) // quote 2: 360km ✗

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body).toMatchObject({
      total: 3,
      bookings: 2,
      quotes: 1,
      regionConfigured: true,
    })
  })

  it("filters out bookings with null lat/lng", async () => {
    mockBookingFindMany.mockResolvedValue([
      { lat: null, lng: null },
      { lat: -23.55, lng: -46.63 },
    ])
    mockQuoteFindMany.mockResolvedValue([])
    mockHaversineKm.mockReturnValue(0)

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    // Only 1 booking has valid coords
    expect(parsed.body).toMatchObject({ total: 1, bookings: 1, quotes: 0 })
    // Haversine should have been called only once (for the valid-coords booking)
    expect(mockHaversineKm).toHaveBeenCalledTimes(1)
  })

  it("filters out quotes with null lat/lng", async () => {
    mockBookingFindMany.mockResolvedValue([])
    mockQuoteFindMany.mockResolvedValue([
      { lat: null, lng: null },
      { lat: null, lng: -46.63 }, // partial coords
      { lat: -23.55, lng: -46.63 }, // valid
    ])
    mockHaversineKm.mockReturnValue(0)

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.body).toMatchObject({ total: 1, bookings: 0, quotes: 1 })
    expect(mockHaversineKm).toHaveBeenCalledTimes(1)
  })

  it("returns total 0 when nothing is within radius", async () => {
    mockBookingFindMany.mockResolvedValue(SAMPLE_BOOKINGS)
    mockQuoteFindMany.mockResolvedValue(SAMPLE_QUOTES)
    mockHaversineKm
      .mockReturnValueOnce(360)
      .mockReturnValueOnce(360)
      .mockReturnValueOnce(360)
      .mockReturnValueOnce(360)
      .mockReturnValueOnce(360)

    const res = await GET(new Request("http://localhost/api/provider/region-demand"))
    const parsed = await parseResponse(res)

    expect(parsed.body).toMatchObject({ total: 0, bookings: 0, quotes: 0 })
  })
})
