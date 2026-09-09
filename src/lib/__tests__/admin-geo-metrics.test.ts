import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/admin/geo-metrics/route"
import { requireRole, AuthError } from "@/lib/auth"
import { SERVICE_LABELS } from "@/lib/geo-metrics"

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn(),
  AuthError: class AuthError extends Error {
    code: string
    status: number
    constructor(code: string) {
      super(code)
      this.name = "AuthError"
      this.code = code
      this.status = code === "FORBIDDEN" ? 403 : 401
    }
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: { admin: { prefix: "admin", max: 30, windowMs: 60000 } },
}))

vi.mock("@/lib/geo-observability", () => ({
  getGeoMetricsSnapshot: vi.fn().mockReturnValue({
    geofencing: {
      enterEvents: 10,
      exitEvents: 8,
      whatsappSent: 7,
      whatsappFailed: 1,
      lockContentions: 0,
      engineErrors: 0,
      osrmFallbackTriggers: 2,
    },
    timezone: {
      lookups: 50,
      fallbackToBrasilia: 3,
      byTimezone: { "America/Sao_Paulo": 40, "America/Manaus": 7 },
    },
    uptime: 12345.6,
  }),
}))

vi.mock("@/lib/geo-metrics", () => ({
  getGeoMetrics: vi.fn().mockReturnValue({
    services: {
      nominatim: {
        p50: 100,
        p95: 500,
        p99: 800,
        count: 100,
        errorRate: 0.01,
        lastSampleAt: 1700000000000,
        errorCount: 1,
      },
      viacep: {
        p50: 50,
        p95: 200,
        p99: 400,
        count: 200,
        errorRate: 0.005,
        lastSampleAt: 1700000000000,
        errorCount: 1,
      },
      postgis: {
        p50: 10,
        p95: 30,
        p99: 60,
        count: 300,
        errorRate: 0.002,
        lastSampleAt: 1700000000000,
        errorCount: 0,
      },
    },
    timestamp: 1700000000000,
    windowSeconds: 900,
  }),
  getGeoMetricsHistory: vi.fn().mockReturnValue([]),
  SERVICE_LABELS: {
    nominatim: "Nominatim",
    viacep: "ViaCEP",
    postgis: "PostGIS",
  },
}))

vi.mock("@/lib/geo-baselines", () => ({
  getP95Baselines: vi.fn().mockReturnValue({
    nominatim: 900,
    viacep: 500,
    postgis: 150,
  }),
}))

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(null),
    existsSync: vi.fn().mockReturnValue(false),
  }
})

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>()
  return {
    ...actual,
    join: vi.fn().mockReturnValue("/mock/path"),
  }
})

function mockRequest(url = "http://localhost:3000/api/admin/geo-metrics") {
  return new Request(url)
}

describe("GET /api/admin/geo-metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(requireRole).mockRejectedValue(new AuthError("UNAUTHORIZED"))

    const res = await GET(mockRequest())

    expect(res.status).toBe(401)
  })

  it("returns 200 with correct shape when admin", async () => {
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)

    const res = await GET(mockRequest())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.services).toBeDefined()
    expect(json.services.nominatim).toBeDefined()
    expect(json.services.viacep).toBeDefined()
    expect(json.services.postgis).toBeDefined()
    expect(json.timestamp).toBeDefined()
    expect(json.windowSeconds).toBeDefined()
    expect(json.labels).toEqual(SERVICE_LABELS)
    expect(json.baselines).toBeDefined()
    expect(json.history).toBeDefined()
  })

  it("includes observability snapshot data", async () => {
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)

    const res = await GET(mockRequest())
    const json = await res.json()

    expect(json.observability).toBeDefined()
    expect(json.observability.geofencing).toBeDefined()
    expect(json.observability.geofencing.enterEvents).toBe(10)
    expect(json.observability.geofencing.exitEvents).toBe(8)
    expect(json.observability.geofencing.whatsappSent).toBe(7)
    expect(json.observability.geofencing.whatsappFailed).toBe(1)
    expect(json.observability.timezone).toBeDefined()
    expect(json.observability.timezone.lookups).toBe(50)
    expect(json.observability.timezone.fallbackToBrasilia).toBe(3)
    expect(json.observability.timezone.byTimezone).toEqual({
      "America/Sao_Paulo": 40,
      "America/Manaus": 7,
    })
    expect(typeof json.observability.uptime).toBe("number")
  })

  it("includes snapshot count", async () => {
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)

    const res = await GET(mockRequest())
    const json = await res.json()

    expect(json.services).toBeDefined()
    expect(typeof json.services.nominatim.count).toBe("number")
    expect(typeof json.services.viacep.count).toBe("number")
    expect(typeof json.services.postgis.count).toBe("number")
  })

  it("returns 401 when requireRole throws non-Error", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error("UNAUTHORIZED"))

    const res = await GET(mockRequest())

    expect(res.status).toBe(401)
  })

  it("returns 200 with correct observability uptime", async () => {
    vi.mocked(requireRole).mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any)

    const res = await GET(mockRequest())
    const json = await res.json()

    expect(json.observability.uptime).toBe(12345.6)
  })
})
