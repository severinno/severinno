/**
 * Tests for the admin diagnostics API routes.
 *
 * Covers:
 *  - GET /api/admin/benchmarks
 *  - GET /api/admin/cache-routes
 *  - GET /api/admin/coverage
 *  - GET /api/admin/errors
 *  - GET /api/admin/geo-cache-diagnostics
 *  - GET /api/admin/geo-metrics
 *  - GET /api/admin/geo-metrics/timeline
 *  - GET /api/admin/geo-query-log
 *  - GET /api/admin/geo-rate-limit-status
 *  - POST /api/admin/geo-rate-limit-status/reset
 *  - GET /api/admin/geo-snapshots-summary
 *  - GET /api/admin/global-rate-limit-status
 *  - POST /api/admin/global-rate-limit-status/reset
 *  - GET /api/admin/performance
 *  - GET /api/admin/pgbouncer
 *  - GET /api/admin/redis-diagnostics
 *
 * Every real dependency (db, redis, fs, child_process, geo metrics libs)
 * is mocked so no network / database / redis calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ---- Hoisted mocks --------------------------------------------------------

const { mockExecFileSync, mockReaddirSync, mockReadFileSync, mockExistsSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
}))

// ---- Mocks ----------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any),
  requireUser: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any),
}))

// keep the real cacheControlPrivate helper, but intercept handleError so
// auth failures produce deterministic responses
vi.mock("@/lib/api-server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    handleError: vi.fn((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      const domainErr = e as { name?: string; status?: number; code?: string }
      const status =
        message === "UNAUTHORIZED"
          ? 401
          : domainErr?.name === "AuthError"
            ? (domainErr.status ?? 403)
            : message === "FORBIDDEN"
              ? 403
              : 500
      return new Response(JSON.stringify({ error: message, code: domainErr?.code }), {
        status,
        headers: { "content-type": "application/json" },
      })
    }),
  }
})

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

vi.mock("@/lib/cache-manifest", () => ({
  CACHED_ROUTES: [
    {
      path: "/api/providers",
      method: "GET",
      type: "public",
      maxAge: 60,
      sMaxage: 60,
      vary: "Accept-Encoding, Accept, Origin",
    },
    {
      path: "/api/services",
      method: "GET",
      type: "public",
      maxAge: 30,
      sMaxage: 120,
      vary: "Accept-Encoding, Accept, Origin",
    },
    {
      path: "/api/providers/[id]",
      method: "GET",
      type: "private",
      maxAge: 60,
      sMaxage: null,
      vary: "Cookie, Accept-Encoding, Accept",
    },
  ],
  TOTAL_COUNT: 3,
  PUBLIC_COUNT: 2,
  PRIVATE_COUNT: 1,
}))

vi.mock("@/lib/geo-server", () => ({
  haversineKm: vi.fn(),
}))

vi.mock("@/lib/geo-metrics", () => ({
  getGeoMetrics: vi.fn(),
  getGeoMetricsHistory: vi.fn(),
  SERVICE_LABELS: { nominatim: "Nominatim (OSM)", viacep: "ViaCEP", postgis: "PostGIS" },
}))

vi.mock("@/lib/geo-query-log", () => ({
  getQueryLogDiagnostics: vi.fn(),
  getTopSearches: vi.fn(),
  getTopCEPs: vi.fn(),
  getTopReverses: vi.fn(),
}))

vi.mock("@/lib/geo-cache-warm", () => ({
  getWarmConfig: vi.fn(),
}))

vi.mock("@/lib/geo-baselines", () => ({
  getP95Baselines: vi.fn(),
}))

vi.mock("@/lib/geo-metrics-persist", () => ({
  loadPersistedSnapshots: vi.fn(),
  getSnapshotCount: vi.fn(),
  getSnapshotsDir: vi.fn(),
  resetCacheFlags: vi.fn(),
  wasSnapshotCacheHit: vi.fn(),
  wasCountCacheHit: vi.fn(),
}))

vi.mock("@/lib/geo-rate-limit", () => ({
  getRateLimitDiagnostics: vi.fn(),
  resetRateLimiter: vi.fn(),
  getRateLimitCounters: vi.fn(),
}))

vi.mock("@/lib/global-rate-limit", () => ({
  getGlobalRateLimitDiagnostics: vi.fn(),
  resetGlobalRateLimiter: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn(),
  RATE_LIMITS: { admin: 100, general: 100 },
}))

vi.mock("@/lib/redis", () => ({
  getCacheStats: vi.fn(),
  getMemoryCacheDiagnostics: vi.fn(),
  getClient: vi.fn(),
  isRedisAvailable: vi.fn(),
  getRedisDiagnostics: vi.fn(),
}))

vi.mock("@/lib/geo-alert-notify", () => ({
  notifyGeoAlert: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/email-queue", () => ({
  queueEmail: vi.fn().mockResolvedValue(undefined),
}))

// Plain factory (no `...actual` spread): spreading the real module here does
// NOT override named imports for `node:fs` under vitest's resolver — routes
// would read the REAL files under docs/benchmarks and blow up (500s). A plain
// factory guarantees readdirSync/readFileSync/existsSync hit the mocks.
// (`default` is required by vitest's interop check for builtin mocks.)
vi.mock("node:fs", () => ({
  readdirSync: mockReaddirSync,
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
  default: {
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    existsSync: mockExistsSync,
  },
}))

vi.mock("node:child_process", () => ({
  execFileSync: mockExecFileSync,
  default: { execFileSync: mockExecFileSync },
}))
vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
  default: { execFileSync: mockExecFileSync },
}))

// ---- SUT imports ----------------------------------------------------------

import { requireRole } from "@/lib/auth"
import { notifyGeoAlert } from "@/lib/geo-alert-notify"
import { queueEmail } from "@/lib/email-queue"
import { db } from "@/lib/db"
import { haversineKm } from "@/lib/geo-server"
import { getGeoMetrics, getGeoMetricsHistory } from "@/lib/geo-metrics"
import { getP95Baselines } from "@/lib/geo-baselines"
import { getWarmConfig } from "@/lib/geo-cache-warm"
import {
  getQueryLogDiagnostics,
  getTopSearches,
  getTopCEPs,
  getTopReverses,
} from "@/lib/geo-query-log"
import {
  getRateLimitDiagnostics,
  resetRateLimiter,
  getRateLimitCounters,
} from "@/lib/geo-rate-limit"
import { getGlobalRateLimitDiagnostics, resetGlobalRateLimiter } from "@/lib/global-rate-limit"
import {
  getCacheStats,
  getMemoryCacheDiagnostics,
  getClient,
  isRedisAvailable,
  getRedisDiagnostics,
} from "@/lib/redis"
import {
  loadPersistedSnapshots,
  getSnapshotCount,
  getSnapshotsDir,
  resetCacheFlags,
  wasSnapshotCacheHit,
  wasCountCacheHit,
} from "@/lib/geo-metrics-persist"

import { GET as GETBenchmarks } from "../admin/benchmarks/route"
import { GET as GETCacheRoutes } from "../admin/cache-routes/route"
import { GET as GETCoverage } from "../admin/coverage/route"
import { GET as GETErrors } from "../admin/errors/route"
import { GET as GETGeoCacheDiagnostics } from "../admin/geo-cache-diagnostics/route"
import { GET as GETGeoMetrics } from "../admin/geo-metrics/route"
import { GET as GETGeoMetricsTimeline } from "../admin/geo-metrics/timeline/route"
import { GET as GETGeoQueryLog } from "../admin/geo-query-log/route"
import { GET as GETGeoRateLimitStatus } from "../admin/geo-rate-limit-status/route"
import { POST as POSTGeoRateLimitReset } from "../admin/geo-rate-limit-status/reset/route"
import { GET as GETGeoSnapshotsSummary } from "../admin/geo-snapshots-summary/route"
import { GET as GETGlobalRateLimitStatus } from "../admin/global-rate-limit-status/route"
import { POST as POSTGlobalRateLimitReset } from "../admin/global-rate-limit-status/reset/route"
import { GET as GETPerformance } from "../admin/performance/route"
import { GET as GETPgBouncer } from "../admin/pgbouncer/route"
import { GET as GETRedisDiagnostics } from "../admin/redis-diagnostics/route"

// ---- Test helpers ---------------------------------------------------------

const MOCK_ADMIN = { userId: "admin-1", role: "ADMIN" as const }

function mockRequest(path = "/api/admin/benchmarks"): Request {
  return new Request(`http://localhost:3000${path}`)
}

function buildRequest(url: string): NextRequest {
  return new NextRequest(new Request(url))
}

// ---- Fixtures -------------------------------------------------------------

const GEO_METRICS_SNAPSHOT = {
  services: {
    nominatim: {
      p50: 142,
      p95: 890,
      p99: 1200,
      count: 847,
      errorRate: 0.02,
      errorCount: 17,
      lastSampleAt: 1700000000000,
    },
  },
  timestamp: 1700000000000,
  windowSeconds: 900,
}

const GEO_METRICS_HISTORY = [
  {
    timestamp: 1700000000000,
    services: { nominatim: { p50: 140, p95: 880, p99: 1100, count: 800 } },
  },
]

const GEO_BENCHMARK_FILE = JSON.stringify({
  meta: {
    timestamp: "2026-07-01T00:00:00.000Z",
    platform: "linux",
    nodeVersion: "v22",
    centerLabel: "São Paulo",
  },
  benchmarks: [
    { label: "haversine_100", name: "haversine_100", mean: 100, opsPerSec: 10000 },
    { label: "haversine_1000", name: "haversine_1000", mean: 150, opsPerSec: 8000 },
    { label: "haversine_10000", name: "haversine_10000", mean: 200, opsPerSec: 5000 },
    { label: "postgis_model_100", name: "postgis_model_100", mean: 110, opsPerSec: 9000 },
    { label: "postgis_model_1000", name: "postgis_model_1000", mean: 160, opsPerSec: 7500 },
    { label: "postgis_model_10000", name: "postgis_model_10000", mean: 210, opsPerSec: 4500 },
  ],
  analysis: { note: "test note", avgHaversinePerProvider: 12.5 },
})

const GEO_BASELINE_JSON = JSON.stringify({
  meta: { timestamp: "2026-07-01T00:00:00.000Z", type: "geo" },
  benchmarks: [
    { name: "geo-distance", label: "geo-distance", mean: 100, min: 90, max: 110, opsPerSec: 1000 },
  ],
})

const GEO_LATEST_JSON = JSON.stringify({
  meta: { timestamp: "2026-07-02T00:00:00.000Z", type: "geo" },
  benchmarks: [
    { name: "geo-distance", label: "geo-distance", mean: 150, min: 140, max: 160, opsPerSec: 900 },
  ],
})

const CACHE_STABLE_JSON = JSON.stringify({
  meta: { timestamp: "2026-07-02T00:00:00.000Z", type: "cache" },
  benchmarks: [
    { name: "cache-get", label: "cache-get", mean: 10, min: 9, max: 12, opsPerSec: 5000 },
  ],
})

const GIST_EARLY_JSON = JSON.stringify({
  meta: { timestamp: "2026-07-01T00:00:00.000Z" },
  crossover: [
    {
      providerCount: 1000,
      radiusKm: 5,
      selectivity: 0.2,
      gistFaster: true,
      dWithinUs: 100,
      fullScanUs: 200,
    },
  ],
  analyses: [{ providerCount: 1000, dWithinUs: 100, fullScanUs: 200 }],
})

const GIST_LATE_JSON = JSON.stringify({
  meta: { timestamp: "2026-07-02T00:00:00.000Z" },
  crossover: [
    {
      providerCount: 1000,
      radiusKm: 50,
      selectivity: 0.2,
      gistFaster: false,
      dWithinUs: 200,
      fullScanUs: 200,
    },
  ],
  analyses: [{ providerCount: 1000, dWithinUs: 200, fullScanUs: 200 }],
})

// PgBouncer psql fixture rows (tab-separated, SHOW * output)
const POOLS_ROW = ["severinno", 1, 0, 0, 2, 3, 1, 0, 0, 0, "transaction"].join("\t")
const STATS_ROW = [
  "severinno",
  1234, // totalQueryCount
  5678, // totalQueryTime
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  "1.2", // avgQueryTime
  0,
  99999, // totalReceived
  88888, // totalSent
].join("\t")
const CONFIG_ROW = ["pool_mode", "transaction", "yes"].join("\t")

/** Default mock implementation: psql works, git commands fail (no history). */
function defaultExecFileSync(cmd: string, args?: string[]): string {
  const joined = args ? args.join(" ") : ""
  if (cmd === "psql" && joined.includes("--version")) return "psql (PostgreSQL) 16.1\n"
  if (joined.includes("SHOW POOLS")) return `${POOLS_ROW}\n`
  if (joined.includes("SHOW STATS")) return `${STATS_ROW}\n`
  if (joined.includes("SHOW CONFIG")) return `${CONFIG_ROW}\n`
  if (joined.includes("SHOW max_connections")) return "100\n"
  throw new Error("mock: git not available")
}

// ---- Setup / teardown -----------------------------------------------------

let clockMs = 1_700_000_000_000

beforeEach(() => {
  // advance the fake clock each test so the pgbouncer 15s in-memory cache
  // never leaks state between tests
  clockMs += 60_000
  vi.useFakeTimers()
  vi.setSystemTime(clockMs)

  vi.mocked(requireRole).mockResolvedValue(MOCK_ADMIN as any)
  vi.mocked(requireRole).mockResolvedValue(MOCK_ADMIN as any)

  mockExecFileSync.mockReset()
  mockExecFileSync.mockImplementation(defaultExecFileSync)

  // default: no benchmark files on disk
  mockReaddirSync.mockReset()
  mockReaddirSync.mockImplementation(() => {
    throw new Error("ENOENT: no such directory")
  })
  mockReadFileSync.mockReset()
  mockReadFileSync.mockImplementation(() => {
    throw new Error("ENOENT: no such file")
  })
  mockExistsSync.mockReset()
  mockExistsSync.mockImplementation(() => false)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

// ===========================================================================
// GET /api/admin/benchmarks
// ===========================================================================

describe("GET /api/admin/benchmarks", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETBenchmarks(mockRequest())

    expect(res.status).toBe(401)
  })

  it("returns an empty summary when the benchmarks dir has no files", async () => {
    const res = await GETBenchmarks(mockRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.runs).toEqual({})
    expect(body.comparisons).toEqual([])
    expect(body.regressionCount).toBe(0)
    expect(body.lastRun).toBeNull()
    expect(body.gistCrossoverHistory).toEqual([])
    expect(body.crossoverDriftAlerts).toEqual([])
    expect(body.benchmarkHistory).toEqual({})
    expect(body.summary).toMatchObject({ totalRuns: 0, totalComparisons: 0 })
    expect(notifyGeoAlert).not.toHaveBeenCalled()
    expect(queueEmail).not.toHaveBeenCalled()
  })

  it("detects regressions and notifies admins via notifyGeoAlert", async () => {
    mockReaddirSync.mockImplementation(() => ["geo-baseline.json", "geo-latest.json"])
    mockReadFileSync.mockImplementation((filePath: string) =>
      String(filePath).includes("baseline") ? GEO_BASELINE_JSON : GEO_LATEST_JSON,
    )

    const res = await GETBenchmarks(mockRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.runs.geo).toHaveLength(2)
    expect(body.comparisons).toHaveLength(1)
    expect(body.comparisons[0]).toMatchObject({
      type: "geo",
      baselineFile: "geo-baseline.json",
      latestFile: "geo-latest.json",
    })
    expect(body.comparisons[0].diffs[0].status).toBe("regression")
    expect(body.comparisons[0].regressions).toHaveLength(1)
    expect(body.regressionCount).toBe(1)
    expect(body.lastRun).toBe("2026-07-02T00:00:00.000Z")
    expect(notifyGeoAlert).toHaveBeenCalledTimes(1)
    expect(notifyGeoAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        source: "benchmarks-api",
        tag: expect.stringContaining("benchmark-regression"),
        context: expect.objectContaining({ regressionCount: 1 }),
      }),
    )
    expect(queueEmail).not.toHaveBeenCalled()
  })

  it("returns unchanged diffs and no alerts when benchmarks are stable", async () => {
    mockReaddirSync.mockImplementation(() => ["cache-baseline.json", "cache-latest.json"])
    mockReadFileSync.mockImplementation(() => CACHE_STABLE_JSON)

    const res = await GETBenchmarks(mockRequest())
    const body = await res.json()

    expect(body.runs.cache).toHaveLength(2)
    expect(body.comparisons[0].diffs[0].status).toBe("unchanged")
    expect(body.regressionCount).toBe(0)
    expect(body.lastRun).toBe("2026-07-02T00:00:00.000Z")
    expect(notifyGeoAlert).not.toHaveBeenCalled()
    expect(queueEmail).not.toHaveBeenCalled()
  })

  it("emails admins and alerts on GiST crossover drift", async () => {
    mockExecFileSync.mockImplementation((cmd: string, args?: string[]) => {
      const joined = args ? args.join(" ") : ""
      if (cmd === "git" && joined.includes("log")) return "aaa1111 1700000000\nbbb2222 1700008640\n"
      if (cmd === "git" && joined.includes("show"))
        return joined.includes("aaa1111") ? GIST_EARLY_JSON : GIST_LATE_JSON
      return defaultExecFileSync(cmd, args)
    })
    vi.mocked(db.user.findMany).mockResolvedValue([{ email: "admin@severinno.com.br" }] as any)

    const res = await GETBenchmarks(mockRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.gistCrossoverHistory).toHaveLength(2)
    expect(body.crossoverDriftAlerts).toHaveLength(1)
    expect(body.crossoverDriftAlerts[0]).toMatchObject({
      density: 1000,
      previousRadiusKm: 5,
      currentRadiusKm: 50,
      gistFasterStateChanged: true,
      previousCommitHash: "aaa1111",
      currentCommitHash: "bbb2222",
    })
    expect(notifyGeoAlert).toHaveBeenCalledTimes(1)
    expect(notifyGeoAlert).toHaveBeenCalledWith(
      expect.objectContaining({ tag: "crossover-drift", severity: "warning" }),
    )
    expect(queueEmail).toHaveBeenCalledTimes(1)
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@severinno.com.br" }),
    )
  })
})

// ===========================================================================
// GET /api/admin/cache-routes
// ===========================================================================

describe("GET /api/admin/cache-routes", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETCacheRoutes()

    expect(res.status).toBe(401)
  })

  it("returns the cache manifest with private cache-control headers", async () => {
    const res = await GETCacheRoutes()

    expect(res.status).toBe(200)
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60")
    expect(res.headers.get("Vary")).toBe("Cookie, Accept-Encoding, Accept")

    const body = await res.json()
    expect(body.meta).toMatchObject({
      totalRoutes: 3,
      cacheControlPublic: 2,
      cacheControlPrivate: 1,
    })
    expect(body.routes).toHaveLength(3)

    const providers = body.routes.find((r: any) => r.path === "/api/providers")
    expect(providers).toMatchObject({
      method: "GET",
      type: "public",
      maxAge: 60,
      cacheControl: "public, max-age=60, s-maxage=60",
      vary: ["Accept-Encoding", "Accept", "Origin"],
    })
    expect(providers.notes.length).toBeGreaterThan(0)

    const detail = body.routes.find((r: any) => r.path === "/api/providers/[id]")
    expect(detail).toMatchObject({ type: "private", cacheControl: "private, max-age=60" })
    expect(detail.staleWhileRevalidate).toBeNull()
    expect(detail.vary).toContain("Cookie")
  })
})

// ===========================================================================
// GET /api/admin/coverage
// ===========================================================================

describe("GET /api/admin/coverage", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETCoverage(new Request("http://localhost/api/admin/coverage"))

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await GETCoverage(new Request("http://localhost/api/admin/coverage"))

    expect(res.status).toBe(403)
  })

  it("returns providers, bounds and a computed coverage grid", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([
      {
        id: "p1",
        name: "Encanador",
        lat: -23.55,
        lng: -46.63,
        radiusKm: 50,
        city: "São Paulo",
        state: "SP",
      },
      {
        id: "p2",
        name: "Eletricista",
        lat: -23.55,
        lng: -46.63,
        radiusKm: 50,
        city: "São Paulo",
        state: "SP",
      },
    ] as any)
    vi.mocked(db.user.count).mockResolvedValue(42)
    vi.mocked(haversineKm).mockReturnValue(5)

    const res = await GETCoverage(new Request("http://localhost/api/admin/coverage"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.providers).toHaveLength(2)
    expect(body.total).toBe(42)
    expect(body.withLocation).toBe(2)
    expect(body.bounds).toEqual({ minLat: -23.55, maxLat: -23.55, minLng: -46.63, maxLng: -46.63 })
    expect(body.grid).toHaveLength(121)
    expect(body.grid[0]).toHaveProperty("lat")
    expect(body.grid[0]).toHaveProperty("nearestKm")
    expect(body.grid.every((c: any) => c.density === 2 && c.gap === false)).toBe(true)
  })

  it("returns an empty grid and null bounds when no provider has location", async () => {
    vi.mocked(db.user.findMany).mockResolvedValue([] as any)
    vi.mocked(db.user.count).mockResolvedValue(0)

    const res = await GETCoverage(new Request("http://localhost/api/admin/coverage"))
    const body = await res.json()

    expect(body.providers).toEqual([])
    expect(body.total).toBe(0)
    expect(body.withLocation).toBe(0)
    expect(body.grid).toEqual([])
    expect(body.bounds).toBeNull()
  })
})

// ===========================================================================
// GET /api/admin/errors
// ===========================================================================

describe("GET /api/admin/errors", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETErrors(buildRequest("http://localhost:3000/api/admin/errors"))

    expect(res.status).toBe(401)
  })

  it("returns aggregated error trends with the default period", async () => {
    const res = await GETErrors(buildRequest("http://localhost:3000/api/admin/errors"))
    const body = await res.json()

    expect(body.period).toBe("24h")
    expect(body.summary.totalErrors).toBe(0)
    expect(body.summary.uniqueEndpoints).toBe(0)
    expect(body.byEndpoint).toHaveLength(0)
    expect(body.byUser).toHaveLength(0)
    expect(body.byVersion).toHaveLength(0)
    expect(body.timeline).toHaveLength(0)
    expect(body.topErrors).toHaveLength(0)
    expect(typeof body.sentryConfig.configured).toBe("boolean")
    expect(typeof body.collectedAt).toBe("string")
  })

  it("honors the period query param", async () => {
    const res = await GETErrors(buildRequest("http://localhost:3000/api/admin/errors?period=7d"))
    const body = await res.json()

    expect(body.period).toBe("7d")
  })

  it("filters byEndpoint entries by the endpoint query param", async () => {
    const res = await GETErrors(
      buildRequest("http://localhost:3000/api/admin/errors?endpoint=/api/bookings"),
    )
    const body = await res.json()

    expect(body.byEndpoint).toHaveLength(0)
    expect(body.summary.totalErrors).toBe(0)
    expect(body.summary.uniqueEndpoints).toBe(0)
  })
})

// ===========================================================================
// GET /api/admin/geo-cache-diagnostics
// ===========================================================================

describe("GET /api/admin/geo-cache-diagnostics", () => {
  beforeEach(() => {
    vi.mocked(getCacheStats).mockReturnValue({
      hits: 100,
      misses: 20,
      total: 120,
      hitRatio: 83.33,
    } as any)
    vi.mocked(getMemoryCacheDiagnostics).mockReturnValue({
      storeSize: 42,
      maxTtlRemainingMs: 12345,
    } as any)
    vi.mocked(getGeoMetrics).mockReturnValue(GEO_METRICS_SNAPSHOT as any)
    vi.mocked(getQueryLogDiagnostics).mockReturnValue({
      totalSearches: 10,
      totalCEPs: 8,
      totalReverses: 3,
    } as any)
    vi.mocked(getWarmConfig).mockReturnValue({ enabled: true, concurrency: 4 } as any)
    vi.mocked(getTopSearches).mockReturnValue([{ query: "são paulo, sp", count: 5 }] as any)
    vi.mocked(getTopCEPs).mockReturnValue([{ cep: "01310100", count: 3 }] as any)
    vi.mocked(getTopReverses).mockReturnValue([{ coords: "-23.5505,-46.6333", count: 2 }] as any)
  })

  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETGeoCacheDiagnostics()

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await GETGeoCacheDiagnostics()

    expect(res.status).toBe(403)
  })

  it("returns cache stats, top queries and key TTLs when Redis is available", async () => {
    vi.mocked(isRedisAvailable).mockReturnValue(true)
    vi.mocked(getClient).mockReturnValue({ ttl: vi.fn().mockResolvedValue(10) } as any)

    const res = await GETGeoCacheDiagnostics()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.cacheStats.hits).toBe(100)
    expect(body.memoryDiag.storeSize).toBe(42)
    expect(body.queryLogDiag.totalSearches).toBe(10)
    expect(body.warmConfig.enabled).toBe(true)
    expect(body.topSearches).toEqual([{ query: "são paulo, sp", count: 5 }])
    expect(body.topCEPs).toEqual([{ cep: "01310100", count: 3 }])
    expect(body.topReverses).toEqual([{ coords: "-23.5505,-46.6333", count: 2 }])
    expect(body.keyTTLs).toHaveLength(5)
    expect(body.keyTTLs[0]).toMatchObject({ key: "geo:search:são paulo, sp:5", ttlSeconds: 10 })
    expect(body.heatmap).toHaveLength(1)
    expect(body.heatmap[0]).toMatchObject({
      service: "nominatim",
      label: "Nominatim (OSM)",
      calls: 847,
      errors: 17,
      errorRate: 0.02,
    })
    expect(typeof body.timestamp).toBe("number")
  })

  it("returns empty keyTTLs when Redis is unavailable", async () => {
    vi.mocked(isRedisAvailable).mockReturnValue(false)

    const res = await GETGeoCacheDiagnostics()
    const body = await res.json()

    expect(body.keyTTLs).toEqual([])
    expect(body.heatmap).toHaveLength(1)
  })
})

// ===========================================================================
// GET /api/admin/geo-metrics
// ===========================================================================

describe("GET /api/admin/geo-metrics", () => {
  const mockRequest = new Request("http://localhost/api/admin/geo-metrics")

  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETGeoMetrics(mockRequest)

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await GETGeoMetrics(mockRequest)

    expect(res.status).toBe(403)
  })

  it("returns the metrics snapshot with labels, benchmark and baselines", async () => {
    vi.mocked(getGeoMetrics).mockReturnValue(GEO_METRICS_SNAPSHOT as any)
    vi.mocked(getGeoMetricsHistory).mockReturnValue(GEO_METRICS_HISTORY as any)
    vi.mocked(getP95Baselines).mockReturnValue({ nominatim: 1000, viacep: 500, postgis: 100 })
    mockExistsSync.mockImplementation(() => true)
    mockReadFileSync.mockImplementation(() => GEO_BENCHMARK_FILE)

    const res = await GETGeoMetrics(mockRequest)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.services.nominatim.count).toBe(847)
    expect(body.windowSeconds).toBe(900)
    expect(body.labels.nominatim).toBe("Nominatim (OSM)")
    expect(body.benchmark).not.toBeNull()
    expect(body.benchmark.comparisons).toHaveLength(3)
    expect(body.benchmark.comparisons[0]).toMatchObject({
      scale: 100,
      haversine: { mean: 100, opsPerSec: 10000 },
      postgis: { mean: 110, opsPerSec: 9000 },
    })
    expect(body.benchmark.comparisons[0].ratio).toBe(1.1)
    expect(body.benchmark.comparisons[2].scale).toBe(10000)
    expect(body.history).toHaveLength(1)
    expect(body.baselines.nominatim).toBe(1000)
  })

  it("returns benchmark null when the benchmark file is missing", async () => {
    vi.mocked(getGeoMetrics).mockReturnValue(GEO_METRICS_SNAPSHOT as any)
    vi.mocked(getGeoMetricsHistory).mockReturnValue(GEO_METRICS_HISTORY as any)
    vi.mocked(getP95Baselines).mockReturnValue({})

    const res = await GETGeoMetrics(mockRequest)
    const body = await res.json()

    expect(body.benchmark).toBeNull()
    expect(body.history).toHaveLength(1)
  })
})

// ===========================================================================
// GET /api/admin/geo-metrics/timeline
// ===========================================================================

describe("GET /api/admin/geo-metrics/timeline", () => {
  const SNAPSHOT_1 = {
    timestamp: 1_700_000_000_000,
    services: {
      nominatim: { p50: 100, p95: 200, p99: 300, count: 10 },
      viacep: { p50: 40, p95: 60, p99: 80, count: 4 },
      postgis: { p50: 10, p95: 20, p99: 30, count: 2 },
    },
  }
  const SNAPSHOT_2 = {
    timestamp: 1_700_000_000_500,
    services: {
      nominatim: { p50: 110, p95: 220, p99: 310, count: 8 },
      viacep: { p50: 40, p95: 60, p99: 80, count: 4 },
      postgis: { p50: 10, p95: 20, p99: 30, count: 2 },
    },
  }

  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETGeoMetricsTimeline(
      buildRequest("http://localhost:3000/api/admin/geo-metrics/timeline"),
    )

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await GETGeoMetricsTimeline(
      buildRequest("http://localhost:3000/api/admin/geo-metrics/timeline"),
    )

    expect(res.status).toBe(403)
  })

  it("returns individual snapshots with granularity=raw", async () => {
    vi.mocked(loadPersistedSnapshots).mockResolvedValue([SNAPSHOT_1, SNAPSHOT_2] as any)

    const res = await GETGeoMetricsTimeline(
      buildRequest(
        `http://localhost:3000/api/admin/geo-metrics/timeline?granularity=raw&from=1700000000000&to=1700000001000`,
      ),
    )
    const body = await res.json()

    expect(body.meta).toMatchObject({
      granularity: "raw",
      windowMs: 0,
      totalSnapshots: 2,
      aggregatedPoints: 2,
    })
    expect(body.points).toHaveLength(2)
    expect(body.points[0]).toMatchObject({
      windowStart: 1_700_000_000_000,
      windowEnd: 1_700_000_000_000,
      count: 1,
    })
    expect(body.points[0].services.nominatim.p50.mean).toBe(100)
    expect(body.labels.nominatim).toBe("Nominatim (OSM)")
  })

  it("aggregates snapshots into buckets with granularity=5m", async () => {
    vi.mocked(loadPersistedSnapshots).mockResolvedValue([SNAPSHOT_1, SNAPSHOT_2] as any)

    const res = await GETGeoMetricsTimeline(
      buildRequest(
        `http://localhost:3000/api/admin/geo-metrics/timeline?granularity=5m&from=0&to=10000000000000`,
      ),
    )
    const body = await res.json()

    expect(body.meta).toMatchObject({ granularity: "5m", windowMs: 300_000, aggregatedPoints: 1 })
    expect(body.points).toHaveLength(1)
    // The route sums the count across ALL services in the bucket
    // (nominatim 10+8 + viacep 4+4 + postgis 2+2 = 30).
    expect(body.points[0].count).toBe(30)
    expect(body.points[0].services.nominatim).toMatchObject({
      p50: { mean: 105, min: 100, max: 110 },
      p95: { mean: 210, min: 200, max: 220 },
      count: 18,
    })
  })

  it("returns 400 for invalid from/to params", async () => {
    vi.mocked(loadPersistedSnapshots).mockResolvedValue([SNAPSHOT_1] as any)

    const res = await GETGeoMetricsTimeline(
      buildRequest(`http://localhost:3000/api/admin/geo-metrics/timeline?from=abc&to=def`),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("inválidos")
  })

  it("returns empty points when there are no snapshots in range", async () => {
    vi.mocked(loadPersistedSnapshots).mockResolvedValue([] as any)

    const res = await GETGeoMetricsTimeline(
      buildRequest(
        `http://localhost:3000/api/admin/geo-metrics/timeline?granularity=1h&from=0&to=10000000000000`,
      ),
    )
    const body = await res.json()

    expect(body.meta.totalSnapshots).toBe(0)
    expect(body.points).toEqual([])
  })
})

// ===========================================================================
// GET /api/admin/geo-query-log
// ===========================================================================

describe("GET /api/admin/geo-query-log", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETGeoQueryLog()

    expect(res.status).toBe(401)
  })

  it("returns diagnostics and top queries", async () => {
    vi.mocked(getQueryLogDiagnostics).mockReturnValue({
      totalSearches: 100,
      totalCEPs: 50,
      totalReverses: 20,
    } as any)
    vi.mocked(getTopSearches).mockReturnValue([
      { query: "são paulo", count: 12 },
      { query: "rio de janeiro", count: 8 },
    ] as any)
    vi.mocked(getTopCEPs).mockReturnValue([{ cep: "01310100", count: 5 }] as any)
    vi.mocked(getTopReverses).mockReturnValue([] as any)

    const res = await GETGeoQueryLog()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.diagnostics).toMatchObject({ totalSearches: 100, totalCEPs: 50, totalReverses: 20 })
    expect(body.topSearches).toHaveLength(2)
    expect(body.topSearches[0].count).toBe(12)
    expect(body.topCEPs).toHaveLength(1)
    expect(body.topReverses).toEqual([])
  })
})

// ===========================================================================
// GET /api/admin/geo-rate-limit-status
// ===========================================================================

describe("GET /api/admin/geo-rate-limit-status", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETGeoRateLimitStatus()

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await GETGeoRateLimitStatus()

    expect(res.status).toBe(403)
  })

  it("returns rate limiter diagnostics", async () => {
    vi.mocked(getRateLimitDiagnostics).mockReturnValue({
      storeSize: 12,
      endpoints: {
        "/api/geo/search": { maxRequests: 60, windowMs: 60000, trackedIps: 3 },
      },
      redisRatio: 0.5,
    } as any)

    const res = await GETGeoRateLimitStatus()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.storeSize).toBe(12)
    expect(body.redisRatio).toBe(0.5)
    expect(body.endpoints["/api/geo/search"].maxRequests).toBe(60)
  })
})

// ===========================================================================
// POST /api/admin/geo-rate-limit-status/reset
// ===========================================================================

describe("POST /api/admin/geo-rate-limit-status/reset", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await POSTGeoRateLimitReset()

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await POSTGeoRateLimitReset()

    expect(res.status).toBe(403)
  })

  it("resets the limiter and returns the before snapshot", async () => {
    vi.mocked(getRateLimitCounters).mockReturnValue({ totalChecks: 99, totalHits: 5 } as any)

    const res = await POSTGeoRateLimitReset()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.before).toEqual({ totalChecks: 99, totalHits: 5 })
    expect(resetRateLimiter).toHaveBeenCalledTimes(1)
    expect(typeof body.timestamp).toBe("number")
  })
})

// ===========================================================================
// GET /api/admin/geo-snapshots-summary
// ===========================================================================

describe("GET /api/admin/geo-snapshots-summary", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETGeoSnapshotsSummary(
      buildRequest("http://localhost:3000/api/admin/geo-snapshots-summary"),
    )

    expect(res.status).toBe(401)
  })

  it("aggregates snapshots into daily and weekly buckets", async () => {
    const dayTs = Date.UTC(2026, 6, 15, 10, 0, 0)
    vi.mocked(loadPersistedSnapshots).mockResolvedValue([
      { timestamp: dayTs, services: { nominatim: { p50: 100, p95: 200, p99: 300, count: 10 } } },
      {
        timestamp: dayTs + 7_200_000,
        services: {
          nominatim: { p50: 120, p95: 220, p99: 320, count: 8 },
          viacep: { p50: 50, p95: 60, p99: 70, count: 5 },
        },
      },
    ] as any)
    vi.mocked(getSnapshotCount).mockResolvedValue(5)
    vi.mocked(getSnapshotsDir).mockReturnValue("docs/benchmarks/metrics")
    vi.mocked(wasSnapshotCacheHit).mockReturnValue(true)
    vi.mocked(wasCountCacheHit).mockReturnValue(true)

    const res = await GETGeoSnapshotsSummary(
      buildRequest("http://localhost:3000/api/admin/geo-snapshots-summary"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get("X-Snapshots-Cache")).toBe("HIT")
    expect(resetCacheFlags).toHaveBeenCalledTimes(1)
    expect(body.daily).toHaveLength(1)
    expect(body.daily[0].snapshotCount).toBe(2)
    expect(body.daily[0].services.nominatim).toEqual({ p50: 110, p95: 210, p99: 310, count: 2 })
    expect(body.daily[0].services.viacep).toEqual({ p50: 50, p95: 60, p99: 70, count: 1 })
    expect(body.weekly).toHaveLength(1)
    expect(body.totals).toMatchObject({
      totalSnapshots: 5,
      dailyBuckets: 1,
      weeklyBuckets: 1,
      snapshotDir: "docs/benchmarks/metrics",
    })
    expect(body.totals.dateRange.from).not.toBeNull()
  })

  it("filters snapshots by the days query param", async () => {
    vi.mocked(loadPersistedSnapshots).mockResolvedValue([
      {
        timestamp: Date.UTC(2020, 0, 1),
        services: { nominatim: { p50: 1, p95: 1, p99: 1, count: 1 } },
      },
    ] as any)

    const res = await GETGeoSnapshotsSummary(
      buildRequest("http://localhost:3000/api/admin/geo-snapshots-summary?days=7"),
    )
    const body = await res.json()

    expect(body.daily).toEqual([])
    expect(body.weekly).toEqual([])
    expect(body.totals.dateRange).toEqual({ from: null, to: null })
  })

  it("returns empty buckets and MISS cache label when there are no snapshots", async () => {
    vi.mocked(loadPersistedSnapshots).mockResolvedValue([])
    vi.mocked(getSnapshotCount).mockResolvedValue(0)
    vi.mocked(wasSnapshotCacheHit).mockReturnValue(null)
    vi.mocked(wasCountCacheHit).mockReturnValue(null)

    const res = await GETGeoSnapshotsSummary(
      buildRequest("http://localhost:3000/api/admin/geo-snapshots-summary"),
    )
    const body = await res.json()

    expect(res.headers.get("X-Snapshots-Cache")).toBe("MISS")
    expect(body.daily).toEqual([])
    expect(body.weekly).toEqual([])
    expect(body.totals.totalSnapshots).toBe(0)
    expect(body.totals.dateRange).toEqual({ from: null, to: null })
  })
})

// ===========================================================================
// GET /api/admin/global-rate-limit-status
// ===========================================================================

describe("GET /api/admin/global-rate-limit-status", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETGlobalRateLimitStatus()

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await GETGlobalRateLimitStatus()

    expect(res.status).toBe(403)
  })

  it("returns global rate limiter diagnostics", async () => {
    vi.mocked(getGlobalRateLimitDiagnostics).mockReturnValue({
      storeSize: 3,
      config: { maxRequests: 100, windowMs: 60000 },
      timestamp: 1700000000000,
    } as any)

    const res = await GETGlobalRateLimitStatus()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.storeSize).toBe(3)
    expect(body.config.maxRequests).toBe(100)
    expect(body.timestamp).toBe(1700000000000)
  })
})

// ===========================================================================
// POST /api/admin/global-rate-limit-status/reset
// ===========================================================================

describe("POST /api/admin/global-rate-limit-status/reset", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await POSTGlobalRateLimitReset()

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await POSTGlobalRateLimitReset()

    expect(res.status).toBe(403)
  })

  it("resets the global limiter and returns the before snapshot", async () => {
    vi.mocked(getGlobalRateLimitDiagnostics).mockReturnValue({ storeSize: 7 } as any)

    const res = await POSTGlobalRateLimitReset()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.before).toEqual({ storeSize: 7 })
    expect(resetGlobalRateLimiter).toHaveBeenCalledTimes(1)
    expect(typeof body.timestamp).toBe("number")
  })
})

// ===========================================================================
// GET /api/admin/performance
// ===========================================================================

describe("GET /api/admin/performance", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETPerformance(buildRequest("http://localhost:3000/api/admin/performance"))

    expect(res.status).toBe(401)
  })

  it("returns performance metrics with the default period", async () => {
    const res = await GETPerformance(buildRequest("http://localhost:3000/api/admin/performance"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.period).toBe("1h")
    expect(body.endpoints).toHaveLength(0)
    expect(body.dbQueries).toHaveLength(0)
    expect(body.externalCalls).toHaveLength(0)
    expect(body.cacheOperations).toHaveLength(0)
    expect(body.errorSummary).toMatchObject({ total5xx: 0, total4xx: 0 })
    expect(body.systemHealth).toMatchObject({ redisConnected: true, rabbitmqConnected: false })
    expect(typeof body.sentryStatus.configured).toBe("boolean")
    expect(typeof body.collectedAt).toBe("string")
  })

  it("honors the period query param", async () => {
    const res = await GETPerformance(
      buildRequest("http://localhost:3000/api/admin/performance?period=24h"),
    )
    const body = await res.json()

    expect(body.period).toBe("24h")
  })
})

// ===========================================================================
// GET /api/admin/pgbouncer
// ===========================================================================

describe("GET /api/admin/pgbouncer", () => {
  it("returns unavailable when psql is not installed", async () => {
    mockExecFileSync.mockImplementation((cmd: string, args?: string[]) => {
      const joined = args ? args.join(" ") : ""
      if (cmd === "psql" && joined.includes("--version")) throw new Error("psql not found")
      return defaultExecFileSync(cmd, args)
    })

    const res = await GETPgBouncer(new Request("http://localhost/api/admin/pgbouncer"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.available).toBe(false)
    expect(body.error).toContain("psql CLI")
    expect(body.pools).toEqual([])
    expect(body.stats).toEqual([])
    expect(body.config).toEqual([])
  })

  it("returns pools, stats and config parsed from psql output", async () => {
    const res = await GETPgBouncer(new Request("http://localhost/api/admin/pgbouncer"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.available).toBe(true)
    expect(body.pools).toHaveLength(1)
    expect(body.pools[0]).toMatchObject({
      database: "severinno",
      clActive: 1,
      svActive: 2,
      svIdle: 3,
      maxwait: 0,
      poolMode: "transaction",
    })
    expect(body.stats[0]).toMatchObject({
      database: "severinno",
      totalQueryCount: 1234,
      totalQueryTime: 5678,
      avgQueryTime: 1.2,
      totalReceived: 99999,
      totalSent: 88888,
    })
    expect(body.config[0]).toEqual({ key: "pool_mode", value: "transaction", changeable: true })
    expect(body.pgMaxConnections).toBe(100)
    expect(typeof body.cachedAt).toBe("string")
  })

  it("returns an error payload when psql fails mid-query", async () => {
    mockExecFileSync.mockImplementation((cmd: string, args?: string[]) => {
      const joined = args ? args.join(" ") : ""
      if (cmd === "psql" && joined.includes("--version")) return "psql (PostgreSQL) 16.1\n"
      throw new Error("connection refused")
    })

    const res = await GETPgBouncer(new Request("http://localhost/api/admin/pgbouncer"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.available).toBe(false)
    expect(body.error).toContain("Erro ao consultar PgBouncer")
    expect(body.pools).toEqual([])
  })
})

// ===========================================================================
// GET /api/admin/redis-diagnostics
// ===========================================================================

describe("GET /api/admin/redis-diagnostics", () => {
  it("returns 401 when requireRole rejects", async () => {
    vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))

    const res = await GETRedisDiagnostics()

    expect(res.status).toBe(401)
  })

  it("returns 403 when requireRole throws FORBIDDEN", async () => {
    const forbiddenErr = Object.assign(new Error("FORBIDDEN"), {
      status: 403,
      code: "FORBIDDEN",
      name: "AuthError",
    })
    vi.mocked(requireRole).mockRejectedValueOnce(forbiddenErr)

    const res = await GETRedisDiagnostics()

    expect(res.status).toBe(403)
  })

  it("returns Redis diagnostics with a timestamp", async () => {
    vi.mocked(getRedisDiagnostics).mockResolvedValue({
      mode: "cluster",
      storeSize: 7,
      hitRatio: 0.91,
      nodes: ["node-1", "node-2"],
    } as any)

    const res = await GETRedisDiagnostics()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.mode).toBe("cluster")
    expect(body.storeSize).toBe(7)
    expect(body.hitRatio).toBe(0.91)
    expect(body.nodes).toHaveLength(2)
    expect(typeof body.timestamp).toBe("number")
  })
})
