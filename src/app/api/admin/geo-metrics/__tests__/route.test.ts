/**
 * Tests for GET /api/admin/geo-metrics — latency metrics for geo services.
 *
 * Coverage:
 *   1. 200 OK with complete response shape for admin user
 *   2. Response has services (nominatim, viacep, postgis) with metrics
 *   3. Response has labels with friendly service names
 *   4. Response has baselines with P95 thresholds
 *   5. Response has history (snapshot timeline)
 *   6. Response has benchmark (real file or structured data)
 *   7. 403 for non-admin user
 *   8. 401 when requireUser throws
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mock auth (reusable helper — factory in vi.hoisted() to survive hoisting) ─

const { mockRequireUser } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireRole: mockRequireUser,
}))

import { setupAdmin, setupUnauthenticated } from "@/lib/__tests__/helpers/auth-mock"

// ── Mock geo-metrics ───────────────────────────────────────────────────────

const MOCK_SNAPSHOT = {
  services: {
    nominatim: {
      p50: 142,
      p95: 890,
      p99: 1200,
      count: 847,
      errorRate: 0.02,
      lastSampleAt: 1700000000000,
      errorCount: 17,
    },
    viacep: {
      p50: 85,
      p95: 430,
      p99: 600,
      count: 312,
      errorRate: 0.01,
      lastSampleAt: 1700000000000,
      errorCount: 3,
    },
    postgis: {
      p50: 12,
      p95: 45,
      p99: 120,
      count: 2301,
      errorRate: 0.005,
      lastSampleAt: 1700000000000,
      errorCount: 11,
    },
  },
  timestamp: 1700000000000,
  windowSeconds: 900,
}

const MOCK_HISTORY = [
  {
    timestamp: 1699999000000,
    services: {
      nominatim: { p50: 150, p95: 950, p99: 1300, count: 800 },
      viacep: { p50: 90, p95: 480, p99: 650, count: 300 },
      postgis: { p50: 15, p95: 50, p99: 130, count: 2200 },
    },
  },
  {
    timestamp: 1699999900000,
    services: {
      nominatim: { p50: 142, p95: 890, p99: 1200, count: 847 },
      viacep: { p50: 85, p95: 430, p99: 600, count: 312 },
      postgis: { p50: 12, p95: 45, p99: 120, count: 2301 },
    },
  },
]

vi.mock("@/lib/geo-metrics", () => ({
  getGeoMetrics: () => MOCK_SNAPSHOT,
  getGeoMetricsHistory: () => MOCK_HISTORY,
  SERVICE_LABELS: {
    nominatim: "Nominatim (OSM)",
    viacep: "ViaCEP",
    postgis: "PostGIS",
  },
}))

// ── Mock geo-baselines ─────────────────────────────────────────────────────

vi.mock("@/lib/geo-baselines", () => ({
  getP95Baselines: () => ({
    nominatim: 400,
    viacep: 250,
    postgis: 30,
  }),
}))

// ── Mock node:fs — override only existsSync, keep real readFileSync ─────────
// The real geo-benchmark.json exists on disk, so the route can read it for
// real benchmark data. We only mock existsSync to control file-detection.

const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
}))

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>()
  return {
    ...fs,
    existsSync: mockExistsSync,
  }
})

// ── Import the handler AFTER mocks are set up ──────────────────────────────

import { GET } from "../route"

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /api/admin/geo-metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("autorização", () => {
    it("retorna 200 para admin", async () => {
      setupAdmin(mockRequireUser)
      const res = await GET()
      expect(res.status).toBe(200)
    })

    it("retorna 403 para non-admin", async () => {
      mockRequireUser.mockRejectedValueOnce(Object.assign(new Error("FORBIDDEN"), { status: 403, code: "FORBIDDEN", name: "AuthError" }))
      const res = await GET()
      expect(res.status).toBe(403)
    })

    it("retorna 401 quando requireUser lança erro", async () => {
      setupUnauthenticated(mockRequireUser)
      const res = await GET()
      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe("Não autorizado")
    })
  })

  describe("response shape", () => {
    beforeEach(() => {
      setupAdmin(mockRequireUser)
    })

    it("retorna services com 3 serviços (nominatim, viacep, postgis)", async () => {
      const res = await GET()
      const body = await res.json()

      expect(body).toHaveProperty("services")
      expect(Object.keys(body.services)).toEqual(["nominatim", "viacep", "postgis"])
    })

    it("cada serviço tem p50, p95, p99, count, errorRate, lastSampleAt, errorCount", async () => {
      const res = await GET()
      const body = await res.json()

      for (const svc of ["nominatim", "viacep", "postgis"] as const) {
        expect(body.services[svc]).toMatchObject({
          p50: expect.any(Number),
          p95: expect.any(Number),
          p99: expect.any(Number),
          count: expect.any(Number),
          errorRate: expect.any(Number),
          lastSampleAt: expect.any(Number),
          errorCount: expect.any(Number),
        })
      }
    })

    it("retorna timestamp e windowSeconds", async () => {
      const res = await GET()
      const body = await res.json()

      expect(body.timestamp).toBe(1700000000000)
      expect(body.windowSeconds).toBe(900)
    })

    it("retorna labels com nomes amigáveis dos serviços", async () => {
      const res = await GET()
      const body = await res.json()

      expect(body.labels).toEqual({
        nominatim: "Nominatim (OSM)",
        viacep: "ViaCEP",
        postgis: "PostGIS",
      })
    })

    it("retorna baselines com P95 thresholds", async () => {
      const res = await GET()
      const body = await res.json()

      expect(body.baselines).toMatchObject({
        nominatim: 400,
        viacep: 250,
        postgis: 30,
      })
    })

    it("retorna history como array de snapshots", async () => {
      const res = await GET()
      const body = await res.json()

      expect(Array.isArray(body.history)).toBe(true)
      expect(body.history).toHaveLength(2)

      const entry = body.history[0]
      expect(entry).toHaveProperty("timestamp")
      expect(entry).toHaveProperty("services")
      expect(entry.services.nominatim).toHaveProperty("p50")
      expect(entry.services.nominatim).toHaveProperty("p95")
      expect(entry.services.nominatim).toHaveProperty("p99")
      expect(entry.services.nominatim).toHaveProperty("count")
    })
  })

  describe("benchmark", () => {
    beforeEach(() => {
      setupAdmin(mockRequireUser)
    })

    it("retorna dados de benchmark (real ou estruturados)", async () => {
      // existsSync is NOT mocked here — it will use the real implementation
      // because importOriginal preserved it. The real geo-benchmark.json
      // exists on disk and will be read.
      const res = await GET()
      const body = await res.json()

      // Benchmark should contain structured data (meta, comparisons, analysis)
      expect(body.benchmark).not.toBeNull()
      expect(body.benchmark.meta).toHaveProperty("timestamp")
      expect(body.benchmark.meta).toHaveProperty("platform")
      expect(body.benchmark.meta).toHaveProperty("centerLabel")
      expect(Array.isArray(body.benchmark.comparisons)).toBe(true)
      expect(body.benchmark.analysis).toHaveProperty("note")
      expect(body.benchmark.analysis).toHaveProperty("avgHaversinePerProvider")
    })
  })
})
