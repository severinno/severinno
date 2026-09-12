import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFindMany } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({
  db: { user: { findMany: mockFindMany } },
}))
vi.mock("../geo-settings", () => ({
  getGeoSettings: vi.fn().mockResolvedValue({
    nominatimEnabled: false,
    nominatimBaseUrl: "https://nominatim.openstreetmap.org",
    userAgent: "test",
  }),
}))
vi.mock("../geo-metrics", () => ({
  trackGeoLatency: vi.fn((_s: unknown, fn: () => unknown) => fn()),
}))
vi.mock("../redis", () => ({ withCache: vi.fn((_k: unknown, fn: () => unknown) => fn()) }))
vi.mock("../nominatim-rate-limit", () => ({
  rateLimitedNominatim: vi.fn((fn: () => unknown) => fn()),
}))
vi.mock("../geo-circuit-breakers", () => ({
  nominatimBreaker: {
    execute: vi.fn((_fn: () => unknown) => {
      throw new Error("circuit open")
    }),
  },
  viacepBreaker: {
    execute: vi.fn((_fn: () => unknown) => {
      throw new Error("circuit open")
    }),
  },
}))
vi.mock("../geo-query-log", () => ({
  recordSearch: vi.fn(),
  recordReverse: vi.fn(),
  recordCEP: vi.fn(),
}))
vi.mock("../geo-fetch", () => ({ geoFetchWithRetry: vi.fn() }))
vi.mock("../logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock("../tracing", () => ({
  traceSpan: vi.fn((_name: unknown, fn: (s: { setAttribute: () => void }) => unknown) =>
    fn({ setAttribute: vi.fn() }),
  ),
}))
vi.mock("../geo-stats", () => ({
  geoCallCounts: { search: 0, reverse: 0 },
  geoFallbackCounts: { search: 0, reverse: 0 },
}))

describe("geo-nominatim.ts — geocodeSearch (local fallback)", () => {
  beforeEach(() => {
    mockFindMany.mockReset()
  })

  it("empty query returns empty results", async () => {
    const { geocodeSearch } = await import("../geo-nominatim")
    const results = await geocodeSearch("")
    expect(results).toEqual([])
  })

  it("whitespace-only query returns empty results", async () => {
    const { geocodeSearch } = await import("../geo-nominatim")
    const results = await geocodeSearch("   ")
    expect(results).toEqual([])
  })

  it("circuit open + no DB results → falls to neighborhood catalog", async () => {
    mockFindMany.mockResolvedValue([])
    const { geocodeSearch } = await import("../geo-nominatim")
    const results = await geocodeSearch("Moema")
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0]!.city).toBe("São Paulo")
  })

  it("local DB results are returned for district query", async () => {
    mockFindMany.mockResolvedValue([
      {
        lat: -23.5606,
        lng: -46.6493,
        city: "São Paulo",
        state: "SP",
        district: "Bela Vista",
        street: "Av. Paulista",
        cep: "01310100",
      },
    ])
    const { geocodeSearch } = await import("../geo-nominatim")
    const results = await geocodeSearch("Bela Vista")
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(typeof results[0]!.lat).toBe("number")
    expect(typeof results[0]!.lng).toBe("number")
  })
})

describe("geo-nominatim.ts — reverseGeocode", () => {
  beforeEach(() => {
    mockFindMany.mockReset()
  })

  it("returns a result with displayName", async () => {
    mockFindMany.mockResolvedValue([])
    const { reverseGeocode } = await import("../geo-nominatim")
    const result = await reverseGeocode(-23.55, -46.63)
    expect(result).toBeDefined()
    expect(typeof result.displayName).toBe("string")
  })
})
