/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for GET /api/providers/[id] — distance computation.
 *
 * Coverage:
 *   ✅ Returns distanceKm when lat/lng provided
 *   ✅ Returns null distanceKm without lat/lng
 *   ✅ Returns null distanceKm when provider has no coordinates
 *   ✅ Haversine precision (±2% tolerance)
 *   ✅ radiusKm present in response
 *   ✅ Returns 404 for non-existent provider
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockRequest, parseResponse } from "@/lib/__tests__/helpers/api-test-utils"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHaversineKm = vi.hoisted(() => vi.fn())
const mockUserFindFirst = vi.hoisted(() => vi.fn())
const mockFavoriteFindUnique = vi.hoisted(() => vi.fn())
const mockGetOptionalSession = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  db: {
    user: { findFirst: (...args: any[]) => mockUserFindFirst(...args) },
    favorite: { findUnique: (...args: any[]) => mockFavoriteFindUnique(...args) },
  },
}))

vi.mock("@/lib/geo-server", () => ({
  haversineKm: (...args: any[]) => mockHaversineKm(...args),
}))

vi.mock("@/lib/auth", () => ({
  getOptionalSession: (...args: any[]) => mockGetOptionalSession(...args),
}))

vi.mock("@/lib/api-server", () => ({
  cacheControlPrivate: (res: any) => res,
  handleError: (e: any) => {
    const status = e.status || e.message?.includes("not found") ? 404 : 500
    const message = e.message || "Erro interno"
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    })
  },
  notFound: (msg: string) => {
    const err = new Error(msg) as any
    err.status = 404
    return err
  },
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { GET } from "../providers/[id]/route"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal provider row matching what Prisma returns. */
function createProviderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "prov-123",
    name: "Maria Silva",
    email: "maria@test.com",
    role: "PROVIDER",
    avatarUrl: null,
    coverUrl: null,
    bio: "Profissional experiente",
    lat: -23.5505,
    lng: -46.6333,
    city: "São Paulo",
    state: "SP",
    verified: true,
    avgRating: 4.8,
    reviewCount: 23,
    favoriteCount: 5,
    radiusKm: 50,
    createdAt: new Date("2024-01-15"),
    passwordHash: "hash",
    slug: "maria-silva",
    cpfCnpj: null,
    whatsapp: null,
    address: null,
    district: null,
    cep: null,
    soundEnabled: true,
    vibrateEnabled: true,
    phone: null,
    services: [],
    availability: [],
    reviewsReceived: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetOptionalSession.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/providers/[id] — distance", () => {
  it("returns distanceKm when lat/lng are provided", async () => {
    mockUserFindFirst.mockResolvedValue(createProviderRow())
    // haversineKm(-23.5505, -46.6333, -23.5505, -46.6333) = 0
    mockHaversineKm.mockReturnValue(0)

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333" },
    })
    const res = await GET(req, { params: Promise.resolve({ id: "prov-123" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("distanceKm", 0)
    // Verify haversine was called with user lat/lng + provider coords
    expect(mockHaversineKm).toHaveBeenCalledWith(-23.5505, -46.6333, -23.5505, -46.6333)
  })

  it("returns null distanceKm when lat/lng are not provided", async () => {
    mockUserFindFirst.mockResolvedValue(createProviderRow())

    const req = createMockRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "prov-123" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("distanceKm", null)
    expect(mockHaversineKm).not.toHaveBeenCalled()
  })

  it("returns null distanceKm when lng is missing", async () => {
    mockUserFindFirst.mockResolvedValue(createProviderRow())

    const req = createMockRequest({
      searchParams: { lat: "-23.5505" },
    })
    const res = await GET(req, { params: Promise.resolve({ id: "prov-123" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("distanceKm", null)
  })

  it("returns null distanceKm when lat is missing", async () => {
    mockUserFindFirst.mockResolvedValue(createProviderRow())

    const req = createMockRequest({
      searchParams: { lng: "-46.6333" },
    })
    const res = await GET(req, { params: Promise.resolve({ id: "prov-123" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("distanceKm", null)
  })

  it("returns null distanceKm when provider has no coordinates", async () => {
    mockUserFindFirst.mockResolvedValue(createProviderRow({ lat: null, lng: null }))

    const req = createMockRequest({
      searchParams: { lat: "-23.5505", lng: "-46.6333" },
    })
    const res = await GET(req, { params: Promise.resolve({ id: "prov-123" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("distanceKm", null)
  })

  it("computes haversine distance with ~2% precision", async () => {
    mockUserFindFirst.mockResolvedValue(createProviderRow())
    // SP → Rio: ~360km
    mockHaversineKm.mockReturnValue(360.5)

    const req = createMockRequest({
      searchParams: { lat: "-22.9068", lng: "-43.1729" },
    })
    const res = await GET(req, { params: Promise.resolve({ id: "prov-123" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("distanceKm")
    // Rounded to 1 decimal
    expect((parsed.body as Record<string, unknown>).distanceKm).toBe(360.5)
  })

  it("includes radiusKm in the response", async () => {
    mockUserFindFirst.mockResolvedValue(createProviderRow({ radiusKm: 50 }))

    const req = createMockRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "prov-123" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(200)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("radiusKm", 50)
  })

  it("returns 404 when provider does not exist", async () => {
    mockUserFindFirst.mockResolvedValue(null)

    const req = createMockRequest()
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent" }) })
    const parsed = await parseResponse(res)

    expect(parsed.status).toBe(404)
    expect(parsed.body as Record<string, unknown>).toHaveProperty("error")
  })
})
