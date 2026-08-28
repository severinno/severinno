/**
 * Tests for GET /api/geo/debug — internal geo state debug endpoint.
 *
 * Coverage:
 *   1. Response is 200 OK
 *   2. Response has all 6 sections (server, redis, queryLog, cacheWarm, rateLimits, env)
 *   3. Server section has uptime, platform, nodeVersion, timestamp
 *   4. Redis section has available, hits, misses, memoryStoreSize
 *   5. Query log section has totals, paths, top entries
 *   6. Cache warm section has all query counts
 *   7. Rate limits section has all 3 endpoints (search, cep, reverse)
 *   8. Env section has REDIS_CLUSTER_MODE, GEO_QUERY_LOG_PATH, hasRedisUrl
 *   9. Response has Cache-Control header
 */

import { describe, it, expect, vi } from "vitest"

// ── Mock geo-query-log — provides deterministic diagnostics ───────────────

vi.mock("@/lib/geo-query-log", () => ({
  getQueryLogDiagnostics: () => ({
    totalSearches: 5000,
    uniqueSearches: 320,
    totalCEPs: 1000,
    uniqueCEPs: 150,
    totalReverses: 200,
    uniqueReverses: 45,
    pendingChanges: 0,
    logPath: "/app/data/geo-query-log.json",
  }),
  getTopSearches: (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      query: `search-${i + 1}`,
      count: 500 - i * 10,
    })),
  getTopCEPs: (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      cep: `01310${String(i).padStart(3, "0")}`,
      count: 300 - i * 5,
    })),
  getTopReverses: (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      coords: `-23.55${i},-46.63${i}`,
      count: 100 - i * 3,
    })),
}))

// ── Mock getWarmConfig ────────────────────────────────────────────────────

vi.mock("@/lib/geo-cache-warm", () => ({
  getWarmConfig: () => ({
    cities: 25,
    neighborhoods: 5,
    missingCapitals: 6,
    ceps: 15,
    coords: 8,
    totalQueries: 59,
  }),
  getLastWarmResult: () => ({
    searches: 25,
    ceps: 10,
    reverses: 8,
    logSearches: 5,
    logCeps: 3,
    logReverses: 2,
    total: 53,
    skipped: 6,
    errors: 0,
    elapsedMs: 30500,
    completedAt: "2026-04-13T10:00:00.000Z",
  }),
}))

// ── Mock GEO_LIMITS ────────────────────────────────────────────────────────

vi.mock("@/lib/geo-rate-limit", () => ({
  GEO_LIMITS: {
    search: { max: 30, windowMs: 60_000 },
    cep: { max: 60, windowMs: 60_000 },
    reverse: { max: 30, windowMs: 60_000 },
  },
}))

// ── Mock auth ──────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock rate-limit ────────────────────────────────────────────────────────

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    admin: { max: 100, windowMs: 60_000 },
  },
}))

// ── Mock redis ─────────────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  getCacheStats: () => ({
    hits: 1200,
    misses: 80,
    total: 1280,
    hitRatio: 0.9375,
    redisAvailable: true,
    memoryStoreSize: 45,
  }),
  getMemoryCacheDiagnostics: () => ({
    available: true,
    size: 45,
    maxAgeMs: 3600_000,
  }),
  isRedisAvailable: vi.fn().mockReturnValue(true),
}))

// ── Import the handler AFTER mocks are set up ──────────────────────────────

import { GET } from "../route"

describe("GET /api/geo/debug", () => {
  it("retorna 200 OK", async () => {
    const res = await GET(new Request("http://localhost/api/geo/debug"))
    expect(res.status).toBe(200)
  })

  it("retorna JSON com as 6 seções esperadas", async () => {
    const res = await GET(new Request("http://localhost/api/geo/debug"))
    const body = await res.json()

    expect(body).toHaveProperty("server")
    expect(body).toHaveProperty("redis")
    expect(body).toHaveProperty("queryLog")
    expect(body).toHaveProperty("cacheWarm")
    expect(body).toHaveProperty("rateLimits")
    expect(body).toHaveProperty("env")
  })

  describe("server", () => {
    it("contém uptime, platform, nodeVersion, timestamp", async () => {
      const res = await GET(new Request("http://localhost/api/geo/debug"))
      const body = await res.json()

      expect(body.server).toMatchObject({
        uptime: expect.any(Number),
        platform: expect.any(String),
        nodeVersion: expect.any(String),
        timestamp: expect.any(String),
      })
      expect(body.server.uptime).toBeGreaterThanOrEqual(0)
      expect(new Date(body.server.timestamp).getTime()).not.toBeNaN()
    })
  })

  describe("redis", () => {
    it("contém available, hits, misses, memoryStoreSize", async () => {
      const res = await GET(new Request("http://localhost/api/geo/debug"))
      const body = await res.json()

      expect(body.redis).toMatchObject({
        available: true,
        hits: 1200,
        misses: 80,
        total: 1280,
        hitRatio: 0.9375,
        memoryStoreSize: 45,
      })
      expect(body.redis.memoryStoreMaxAgeMs).toBeGreaterThan(0)
    })
  })

  describe("queryLog", () => {
    it("contém totais e top entries", async () => {
      const res = await GET(new Request("http://localhost/api/geo/debug"))
      const body = await res.json()

      expect(body.queryLog).toMatchObject({
        totalSearches: 5000,
        uniqueSearches: 320,
        totalCEPs: 1000,
        uniqueCEPs: 150,
        totalReverses: 200,
        uniqueReverses: 45,
        pendingChanges: 0,
        logPath: expect.any(String),
      })

      // Top lists
      expect(body.queryLog.topSearches).toHaveLength(10)
      expect(body.queryLog.topCEPs).toHaveLength(10)
      expect(body.queryLog.topReverses).toHaveLength(5)

      // Shape
      expect(body.queryLog.topSearches[0]).toMatchObject({
        query: expect.any(String),
        count: expect.any(Number),
      })
      expect(body.queryLog.topCEPs[0]).toMatchObject({
        cep: expect.any(String),
        count: expect.any(Number),
      })
      expect(body.queryLog.topReverses[0]).toMatchObject({
        coords: expect.any(String),
        count: expect.any(Number),
      })
    })
  })

  describe("cacheWarm", () => {
    it("contém config estática de warm", async () => {
      const res = await GET(new Request("http://localhost/api/geo/debug"))
      const body = await res.json()

      expect(body.cacheWarm).toMatchObject({
        cities: 25,
        neighborhoods: 5,
        missingCapitals: 6,
        ceps: 15,
        coords: 8,
        totalQueries: 59,
      })
    })

    it("contém lastRun com resultado do último warm", async () => {
      const res = await GET(new Request("http://localhost/api/geo/debug"))
      const body = await res.json()

      expect(body.cacheWarm.lastRun).toEqual({
        searches: 25,
        ceps: 10,
        reverses: 8,
        logSearches: 5,
        logCeps: 3,
        logReverses: 2,
        total: 53,
        skipped: 6,
        errors: 0,
        elapsedMs: 30500,
        completedAt: "2026-04-13T10:00:00.000Z",
      })
    })
  })

  describe("rateLimits", () => {
    it("contém search, cep, reverse com max e windowMs", async () => {
      const res = await GET(new Request("http://localhost/api/geo/debug"))
      const body = await res.json()

      expect(body.rateLimits).toMatchObject({
        search: { max: 30, windowMs: 60000 },
        cep: { max: 60, windowMs: 60000 },
        reverse: { max: 30, windowMs: 60000 },
      })
    })
  })

  describe("env", () => {
    it("contém variáveis de ambiente relevantes (sem valores sensíveis)", async () => {
      const res = await GET(new Request("http://localhost/api/geo/debug"))
      const body = await res.json()

      expect(body.env).toMatchObject({
        REDIS_CLUSTER_MODE: expect.any(Boolean),
        hasGeoQueryLogPath: expect.any(Boolean),
        hasRedisUrl: expect.any(Boolean),
      })
    })
  })

  it("inclui Cache-Control header", async () => {
    const res = await GET(new Request("http://localhost/api/geo/debug"))
    expect(res.headers.get("Cache-Control")).toContain("max-age=5")
  })
})
