import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFindFirst, mockFindMany } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({
  db: { user: { findFirst: mockFindFirst, findMany: mockFindMany } },
}))
vi.mock("../geo-settings", () => ({
  getGeoSettings: vi.fn().mockResolvedValue({
    viacepEnabled: false,
    viacepBaseUrl: "https://viacep.com.br",
  }),
}))
vi.mock("../geo-metrics", () => ({
  trackGeoLatency: vi.fn((_s: unknown, fn: () => unknown) => fn()),
}))
vi.mock("../redis", () => ({ withCache: vi.fn((_k: unknown, fn: () => unknown) => fn()) }))
vi.mock("../viacep-rate-limit", () => ({ rateLimitedViaCEP: vi.fn((fn: () => unknown) => fn()) }))
vi.mock("../geo-circuit-breakers", () => ({
  viacepBreaker: {
    execute: vi.fn((_fn: () => unknown) => {
      throw new Error("circuit open")
    }),
  },
  nominatimBreaker: {
    execute: vi.fn((_fn: () => unknown) => {
      throw new Error("circuit open")
    }),
  },
}))
vi.mock("../geo-query-log", () => ({ recordCEP: vi.fn() }))
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
  geoCallCounts: { cep: 0 },
  geoFallbackCounts: { cep: 0 },
}))

import { geocodeCEP } from "../geo-viacep"

describe("geo-viacep.ts — CEP Lookup", () => {
  beforeEach(() => {
    mockFindFirst.mockReset()
  })

  it("rejects CEP with less than 8 digits", async () => {
    await expect(geocodeCEP("123")).rejects.toThrow("CEP inválido")
  })

  it("cleans hyphenated CEP and queries DB", async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(geocodeCEP("01310-100")).rejects.toThrow("CEP não encontrado")
  })

  it("cleans CEP with non-digit characters", async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(geocodeCEP("01.310-100")).rejects.toThrow("CEP não encontrado")
  })

  it("returns local DB result when ViaCEP is disabled", async () => {
    mockFindFirst.mockResolvedValue({
      cep: "01310-100",
      street: "Avenida Paulista",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
    })

    const result = await geocodeCEP("01310100")
    expect(result.street).toBe("Avenida Paulista")
    expect(result.city).toBe("São Paulo")
    expect(result.state).toBe("SP")
  })

  it("throws when no provider matches the CEP", async () => {
    mockFindFirst.mockResolvedValue(null)
    await expect(geocodeCEP("99999999")).rejects.toThrow("CEP não encontrado")
  })
})
