/**
 * Tests for cron / stats / infra API routes:
 *
 *   - GET /api/stats/activity          (public feed)
 *   - GET /api/stats/public            (public aggregates)
 *   - GET /api/cron/geo-cache-warm     (Bearer CRON_SECRET)
 *   - GET /api/cron/geo-health-alert   (Bearer CRON_SECRET)
 *   - GET /api/cron/health-monitor     (Bearer CRON_SECRET)
 *   - GET /api/cron/push-scheduled     (Bearer CRON_SECRET)
 *   - GET /api/cron/scheduled-push     (Bearer CRON_SECRET)
 *   - GET /api/health                  (infra, public)
 *   - GET /api/metrics                 (infra, public)
 *   - GET /api/metrics/prometheus      (302 alias, public)
 *   - POST /api/sentry                 (Sentry/GlitchTip tunnel)
 *
 * Covers per route: guard failure (401), happy path, and error branch
 * where cheap to reach.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { NextRequest } from "next/server"

// ── Hoisted mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    booking: { findMany: vi.fn(), count: vi.fn() },
    review: { findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
    user: { findMany: vi.fn(), count: vi.fn() },
    quoteRequest: { findMany: vi.fn(), count: vi.fn() },
    service: { count: vi.fn() },
    scheduledPushNotification: { findMany: vi.fn(), update: vi.fn() },
    recurringPushSchedule: { findMany: vi.fn(), update: vi.fn() },
    pushSubscription: { findMany: vi.fn(), groupBy: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/lib/api-server", () => ({
  handleError: vi.fn((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })
  }),
  cacheControlPublic: (res: Response) => res,
}))

vi.mock("@/lib/geo-cache-warm", () => ({
  warmGeoCache: vi.fn(),
  getWarmConfig: vi.fn(),
}))

vi.mock("@/lib/cron-cooldown", () => ({
  isCooldownElapsed: vi.fn(),
  markCompleted: vi.fn(),
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: {
    general: { key: "general", interval: 60, max: 100 },
    bookings: { key: "bookings", interval: 60, max: 10 },
  },
}))

vi.mock("@/lib/geo-health-alert", () => ({
  evaluateGeoHealth: vi.fn(),
}))

vi.mock("@/lib/geo-performance-alert", () => ({
  checkGeoPerformance: vi.fn(),
}))

vi.mock("@/lib/health-monitor", () => ({
  runHealthMonitor: vi.fn(),
}))

vi.mock("@/lib/push", () => ({
  sendPushToMany: vi.fn(),
  sendPushNotification: vi.fn(),
}))

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
}))

vi.mock("@/lib/geo-settings", () => ({
  getGeoSettings: vi.fn(),
}))

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(),
  getCacheStats: vi.fn(),
  withCache: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}))

vi.mock("@/lib/queue", () => ({
  getHealth: vi.fn().mockReturnValue({
    status: "ok",
    connected: true,
    connectionStatus: "connected",
    lastConnectedAt: Date.now(),
    reconnectAttempts: 0,
    totalReconnectAttempts: 0,
    heartbeat: 60,
    uptimeSeconds: 100,
  }),
}))

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}))

vi.mock("../../../../package.json", () => ({
  default: { version: "1.0.0-test" },
  version: "1.0.0-test",
}))

// ── Imports (route modules must be imported after the mocks above) ────────

import { GET as getStatsActivity } from "../stats/activity/route"
import { GET as getStatsPublic } from "../stats/public/route"
import { GET as getGeoCacheWarm } from "../cron/geo-cache-warm/route"
import { GET as getGeoHealthAlert } from "../cron/geo-health-alert/route"
import { GET as getHealthMonitor } from "../cron/health-monitor/route"
import { GET as getPushScheduled } from "../cron/push-scheduled/route"
import { GET as getScheduledPush } from "../cron/scheduled-push/route"
import { GET as getHealth, resetHealthCache } from "../health/route"
import { GET as getMetrics } from "../metrics/route"
import { GET as getPrometheus } from "../metrics/prometheus/route"
import { POST as postSentry } from "../sentry/route"

import { db } from "@/lib/db"
import { handleError } from "@/lib/api-server"
import { warmGeoCache, getWarmConfig } from "@/lib/geo-cache-warm"
import { isCooldownElapsed, markCompleted } from "@/lib/cron-cooldown"
import { evaluateGeoHealth } from "@/lib/geo-health-alert"
import { checkGeoPerformance } from "@/lib/geo-performance-alert"
import { runHealthMonitor } from "@/lib/health-monitor"
import { sendPushToMany, sendPushNotification } from "@/lib/push"
import { captureError } from "@/lib/sentry"
import { getGeoSettings } from "@/lib/geo-settings"
import { getClient, getCacheStats } from "@/lib/redis"

// ── Global fetch mock ──────────────────────────────────────────────────────

const mockFetchFn = vi.fn()
vi.stubGlobal("fetch", mockFetchFn)

// ── Helpers ────────────────────────────────────────────────────────────────

const CRON_SECRET = "my-cron-secret"
const _origCronSecret = process.env.CRON_SECRET
const _origInternalUrl = process.env.APP_INTERNAL_URL

function cronRequest(path: string, secret?: string): Request {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers["authorization"] = `Bearer ${secret}`
  return new Request(`http://localhost:3000${path}`, { headers })
}

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

// ── Env cleanup ────────────────────────────────────────────────────────────

afterAll(() => {
  process.env.CRON_SECRET = _origCronSecret
  process.env.APP_INTERNAL_URL = _origInternalUrl
  vi.unstubAllGlobals()
})

// ============================================================================
// GET /api/stats/activity — public activity feed
// ============================================================================

describe("GET /api/stats/activity", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.booking.findMany).mockResolvedValue([])
    vi.mocked(db.review.findMany).mockResolvedValue([])
    vi.mocked(db.user.findMany).mockResolvedValue([])
    vi.mocked(db.quoteRequest.findMany).mockResolvedValue([])
    vi.mocked(db.quoteRequest.count).mockResolvedValue(0)
  })

  it("builds a sorted feed from bookings, reviews, signups and quotes", async () => {
    const now = Date.now()
    const bookings = Array.from({ length: 12 }, (_, i) => ({
      id: `b-${i}`,
      createdAt: new Date(now - (i + 1) * 60_000),
      client: { name: "João Silva", avatarUrl: "https://x/a.png", city: "São Paulo" },
      service: { title: "Limpeza", category: { name: "Doméstica" } },
    }))
    vi.mocked(db.booking.findMany).mockResolvedValue(bookings as never)
    vi.mocked(db.review.findMany).mockResolvedValue([
      {
        id: "r-1",
        createdAt: new Date(now - 120_000),
        rating: 5,
        client: { name: "Maria Souza", avatarUrl: null },
        provider: { name: "Paulo Lima" },
        service: { title: "Pintura" },
      },
    ] as never)
    vi.mocked(db.user.findMany).mockResolvedValue([
      { name: "Ana Costa", avatarUrl: null, verified: true, createdAt: new Date(now - 150_000) },
    ] as never)
    vi.mocked(db.quoteRequest.findMany).mockResolvedValue([
      {
        id: "q-1",
        createdAt: new Date(now - 30_000),
        client: { name: "Pedro Alves", avatarUrl: null, city: "Rio de Janeiro" },
        items: [{ service: { title: "Encanador", category: { name: "Reparos" } } }],
      },
    ] as never)
    vi.mocked(db.quoteRequest.count).mockResolvedValue(5)

    const res = await getStatsActivity()
    const body = await res.json()

    expect(res.status).toBe(200)
    // Newest activity (quote) first, capped at top 10
    expect(body.activities).toHaveLength(10)
    expect(body.activities[0].type).toBe("quote")
    expect(body.activities[0].userName).toBe("Pedro A.")
    expect(body.activities[0].action).toBe("pediu orçamento para")
    expect(body.activities[0].target).toBe("reparos em Rio de Janeiro")
    expect(body.activities[0].emoji).toBe("📋")
    expect(body.activities[0]).not.toHaveProperty("createdAt")

    const bookingActivity = body.activities.find((a: { type: string }) => a.type === "booking")
    expect(bookingActivity).toMatchObject({
      userName: "João S.",
      action: "agendou",
      target: "doméstica em São Paulo",
      service: "Limpeza",
      emoji: "📅",
    })
    expect(typeof bookingActivity.timeAgo).toBe("string")

    const reviewActivity = body.activities.find((a: { type: string }) => a.type === "review")
    expect(reviewActivity).toMatchObject({
      action: "avaliou",
      target: "Paulo L.",
      rating: 5,
      service: "Pintura",
      emoji: "⭐",
    })

    const signupActivity = body.activities.find((a: { type: string }) => a.type === "signup")
    expect(signupActivity).toMatchObject({
      action: "se cadastrou como prestador",
      target: "verificado",
      emoji: "✅",
    })

    expect(body.quotesToday).toBe(5)
    expect(body.browsingNow).toBeGreaterThanOrEqual(18)
    expect(body.browsingNow).toBeLessThanOrEqual(42)
    expect(res.headers.get("cache-control")).toContain("s-maxage=30")
  })

  it("returns an empty feed when no data exists", async () => {
    const res = await getStatsActivity()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.activities).toEqual([])
    expect(body.quotesToday).toBe(0)
  })

  it("returns an empty feed with 200 when the database fails", async () => {
    vi.mocked(db.booking.findMany).mockRejectedValue(new Error("DB down"))

    const res = await getStatsActivity()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.activities).toEqual([])
    expect(body.browsingNow).toBe(0)
    expect(body.quotesToday).toBe(0)
  })
})

// ============================================================================
// GET /api/stats/public — public platform aggregates
// ============================================================================

describe("GET /api/stats/public", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.user.count).mockResolvedValue(0)
    vi.mocked(db.service.count).mockResolvedValue(0)
    vi.mocked(db.review.count).mockResolvedValue(0)
    vi.mocked(db.booking.count).mockResolvedValue(0)
    vi.mocked(db.review.aggregate).mockResolvedValue({ _avg: { rating: null } } as never)
  })

  it("returns aggregate counts and a rounded average rating", async () => {
    vi.mocked(db.user.count)
      .mockResolvedValueOnce(120) // providers
      .mockResolvedValueOnce(1500) // total users
      .mockResolvedValueOnce(12) // signups 24h
    vi.mocked(db.service.count).mockResolvedValue(340)
    vi.mocked(db.review.count).mockResolvedValue(890)
    vi.mocked(db.booking.count).mockResolvedValue(456)
    vi.mocked(db.review.aggregate).mockResolvedValue({ _avg: { rating: 4.756 } } as never)

    const res = await getStatsPublic(new Request("http://localhost/api/stats/public"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      providers: 120,
      services: 340,
      reviews: 890,
      completedBookings: 456,
      avgRating: 4.8,
      totalUsers: 1500,
      recentSignups24h: 12,
    })
  })

  it("returns zero average rating when there are no reviews", async () => {
    const res = await getStatsPublic(new Request("http://localhost/api/stats/public"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.avgRating).toBe(0)
    expect(body.providers).toBe(0)
  })

  it("returns zeros with 200 when the database fails", async () => {
    vi.mocked(db.user.count).mockRejectedValue(new Error("DB down"))

    const res = await getStatsPublic(new Request("http://localhost/api/stats/public"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      providers: 0,
      services: 0,
      reviews: 0,
      completedBookings: 0,
      avgRating: 0,
      totalUsers: 0,
      recentSignups24h: 0,
    })
  })
})

// ============================================================================
// GET /api/cron/geo-cache-warm — Bearer CRON_SECRET guard
// ============================================================================

describe("GET /api/cron/geo-cache-warm", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    vi.mocked(isCooldownElapsed).mockResolvedValue(true)
    vi.mocked(markCompleted).mockResolvedValue(undefined as never)
    vi.mocked(getWarmConfig).mockReturnValue({
      cities: 27,
      neighborhoods: 0,
      missingCapitals: 3,
      ceps: 20,
      coords: 5,
      totalQueries: 55,
    })
  })

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await getGeoCacheWarm(cronRequest("/api/cron/geo-cache-warm"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toContain("Unauthorized")
    expect(warmGeoCache).not.toHaveBeenCalled()
  })

  it("returns 401 when the Bearer token is wrong", async () => {
    const res = await getGeoCacheWarm(cronRequest("/api/cron/geo-cache-warm", "wrong"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toContain("Unauthorized")
  })

  it("executes the warm and reports completion", async () => {
    vi.mocked(warmGeoCache).mockResolvedValue({
      total: 40,
      skipped: 15,
      errors: 0,
    } as never)

    const res = await getGeoCacheWarm(cronRequest("/api/cron/geo-cache-warm", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe("completed")
    expect(body.config.totalQueries).toBe(55)
    expect(body.result.total).toBe(40)
    expect(body.message).toContain("40")
    expect(markCompleted).toHaveBeenCalledWith("geo-cache-warm", 23 * 60 * 60 * 1000)
  })

  it("skips execution when the cooldown has not elapsed", async () => {
    vi.mocked(isCooldownElapsed).mockResolvedValue(false)

    const res = await getGeoCacheWarm(cronRequest("/api/cron/geo-cache-warm", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe("skipped")
    expect(body.reason).toBe("cooldown")
    expect(warmGeoCache).not.toHaveBeenCalled()
  })

  it("rejects request when CRON_SECRET is not configured (fail-closed)", async () => {
    process.env.CRON_SECRET = ""

    const res = await getGeoCacheWarm(cronRequest("/api/cron/geo-cache-warm"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/Unauthorized/i)
  })

  it("returns 500 via handleError on internal failure", async () => {
    vi.mocked(isCooldownElapsed).mockRejectedValue(new Error("cooldown store down"))

    const res = await getGeoCacheWarm(cronRequest("/api/cron/geo-cache-warm", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("cooldown store down")
    expect(handleError).toHaveBeenCalled()
  })
})

// ============================================================================
// GET /api/cron/geo-health-alert — Bearer CRON_SECRET guard
// ============================================================================

describe("GET /api/cron/geo-health-alert", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    process.env.APP_INTERNAL_URL = "http://test.internal"
    mockFetchFn.mockImplementation(() =>
      okJson({
        checks: { nominatim: "ok", viacep: "ok", postgis: "ok" },
        geo: { nominatim: "online", viacep: "online", postgis: "available" },
      }),
    )
    vi.mocked(evaluateGeoHealth).mockResolvedValue({
      checked: 3,
      degraded: 0,
      alertsSent: 0,
      recoveriesSent: 0,
      services: [
        {
          name: "nominatim",
          status: "ok",
          consecutiveFailures: 0,
          alerted: false,
          recovered: false,
        },
        { name: "viacep", status: "ok", consecutiveFailures: 0, alerted: false, recovered: false },
        { name: "postgis", status: "ok", consecutiveFailures: 0, alerted: false, recovered: false },
      ],
    } as never)
    vi.mocked(checkGeoPerformance).mockResolvedValue([])
  })

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await getGeoHealthAlert(cronRequest("/api/cron/geo-health-alert"))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toContain("Unauthorized")
  })

  it("returns 401 when the Bearer token is wrong", async () => {
    const res = await getGeoHealthAlert(cronRequest("/api/cron/geo-health-alert", "wrong"))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toContain("Unauthorized")
  })

  it("reports availability and performance when all services are healthy", async () => {
    const res = await getGeoHealthAlert(cronRequest("/api/cron/geo-health-alert", CRON_SECRET))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockFetchFn).toHaveBeenCalledWith("http://test.internal/api/health", expect.anything())
    expect(body.availability.nominatim).toBe("ok")
    expect(body.availability.viacep).toBe("ok")
    expect(body.availability.postgis).toBe("ok")
    expect(body.availability.degraded).toBe(0)
    expect(body.availability.services).toHaveLength(3)
    expect(body.performance.postgis).toBeDefined()
  })

  it("returns 502 when the health endpoint responds with a non-503 failure", async () => {
    mockFetchFn.mockImplementation(() => new Response("boom", { status: 500 }))

    const res = await getGeoHealthAlert(cronRequest("/api/cron/geo-health-alert", CRON_SECRET))
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.error).toContain("HTTP 500")
  })

  it("returns 500 via handleError on internal failure", async () => {
    vi.mocked(evaluateGeoHealth).mockRejectedValue(new Error("alert pipeline failed"))

    const res = await getGeoHealthAlert(cronRequest("/api/cron/geo-health-alert", CRON_SECRET))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("alert pipeline failed")
  })
})

// ============================================================================
// GET /api/cron/health-monitor — Bearer CRON_SECRET guard
// ============================================================================

describe("GET /api/cron/health-monitor", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    vi.mocked(runHealthMonitor).mockResolvedValue({
      overallStatus: "degraded",
      healthyCount: 5,
      degradedCount: 1,
      unhealthyCount: 0,
      totalServices: 6,
      alertsSent: 1,
      healthy: ["postgres", "redis", "nominatim", "viacep", "app"],
      services: [
        { name: "postgres", status: "healthy", alerted: false },
        { name: "redis", status: "degraded", alerted: true },
      ],
      timestamp: "2026-01-15T00:00:00.000Z",
    } as never)
  })

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await getHealthMonitor(cronRequest("/api/cron/health-monitor"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toContain("Unauthorized")
  })

  it("returns 401 when the Bearer token is wrong", async () => {
    const res = await getHealthMonitor(cronRequest("/api/cron/health-monitor", "wrong"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toContain("Unauthorized")
  })

  it("reports the monitor result when the secret is valid", async () => {
    const res = await getHealthMonitor(cronRequest("/api/cron/health-monitor", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.status).toBe("degraded")
    expect(body.summary).toEqual({ healthy: 5, degraded: 1, unhealthy: 0, total: 6 })
    expect(body.alertsSent).toBe(1)
    expect(body.services).toHaveLength(2)
    expect(body.glitchtipAlerts.docs).toContain("GlitchTip")
  })

  it("returns 500 via handleError on internal failure", async () => {
    vi.mocked(runHealthMonitor).mockRejectedValue(new Error("monitor crashed"))

    const res = await getHealthMonitor(cronRequest("/api/cron/health-monitor", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("monitor crashed")
  })
})

// ============================================================================
// GET /api/cron/push-scheduled — Bearer CRON_SECRET guard
// ============================================================================

describe("GET /api/cron/push-scheduled", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    vi.mocked(db.scheduledPushNotification.findMany).mockResolvedValue([])
    vi.mocked(db.recurringPushSchedule.findMany).mockResolvedValue([])
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([])
    vi.mocked(db.user.findMany).mockResolvedValue([])
    vi.mocked(db.scheduledPushNotification.update).mockResolvedValue(undefined as never)
    vi.mocked(db.recurringPushSchedule.update).mockResolvedValue(undefined as never)
    vi.mocked(sendPushToMany).mockResolvedValue(undefined as never)
  })

  afterAll(() => {
    vi.useRealTimers()
  })

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await getPushScheduled(cronRequest("/api/cron/push-scheduled"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 401 when the Bearer token is wrong", async () => {
    const res = await getPushScheduled(cronRequest("/api/cron/push-scheduled", "wrong"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("sends due scheduled notifications and marks them SENT", async () => {
    vi.mocked(db.scheduledPushNotification.findMany).mockResolvedValue([
      {
        id: "sp-1",
        title: "Promoção da semana",
        body: "20% off",
        pushUrl: "/promo",
        userIds: ["u1", "u2"],
        type: "promo",
      },
    ] as never)

    const res = await getPushScheduled(cronRequest("/api/cron/push-scheduled", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.scheduled).toBe(1)
    expect(body.results[0]).toMatchObject({
      id: "sp-1",
      totalUsers: 2,
      sentCount: 2,
      errorCount: 0,
      status: "SENT",
    })
    expect(sendPushToMany).toHaveBeenCalledWith(
      ["u1", "u2"],
      "Promoção da semana",
      "20% off",
      "/promo",
      { notificationType: "promo", source: "scheduled" },
    )
    expect(db.scheduledPushNotification.update).toHaveBeenCalledWith({
      where: { id: "sp-1" },
      data: expect.objectContaining({ status: "SENT", sentCount: 2, errorCount: 0 }),
    })
  })

  it("marks a scheduled notification FAILED when it has no user list", async () => {
    vi.mocked(db.scheduledPushNotification.findMany).mockResolvedValue([
      { id: "sp-2", title: "Vazio", body: "", pushUrl: "/", userIds: [], type: "info" },
    ] as never)

    const res = await getPushScheduled(cronRequest("/api/cron/push-scheduled", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(body.results[0]).toMatchObject({ id: "sp-2", totalUsers: 0, status: "FAILED" })
    expect(sendPushToMany).not.toHaveBeenCalled()
  })

  it("fires a due recurring daily rule at the matching minute", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z")) // 09:00 America/Sao_Paulo

    vi.mocked(db.recurringPushSchedule.findMany).mockResolvedValue([
      {
        id: "r-1",
        title: "Dica diária",
        body: "Nova dica",
        pushUrl: "/dicas",
        time: "09:00",
        frequency: "daily",
        dayOfWeek: null,
        dayOfMonth: null,
        targetRoles: ["PROVIDER"],
        filterCity: null,
        lastSentAt: null,
        status: "ACTIVE",
        type: "info",
      },
    ] as never)
    vi.mocked(db.pushSubscription.findMany).mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never)
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: "u1" }, { id: "u2" }] as never)

    const res = await getPushScheduled(cronRequest("/api/cron/push-scheduled", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(body.recurring).toBe(1)
    expect(body.results[0]).toMatchObject({
      id: "recurring:r-1",
      totalUsers: 2,
      sentCount: 2,
      status: "SENT",
    })
    expect(db.recurringPushSchedule.update).toHaveBeenCalledWith({
      where: { id: "r-1" },
      data: expect.objectContaining({ totalSent: { increment: 2 } }),
    })
  })

  it("skips a recurring rule that was sent within the last 5 minutes", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-15T12:00:00.000Z"))

    vi.mocked(db.recurringPushSchedule.findMany).mockResolvedValue([
      {
        id: "r-2",
        title: "Recente",
        body: "",
        pushUrl: "/",
        time: "09:00",
        frequency: "daily",
        dayOfWeek: null,
        dayOfMonth: null,
        targetRoles: [],
        filterCity: null,
        lastSentAt: new Date("2026-01-15T11:59:00.000Z"),
        status: "ACTIVE",
        type: "info",
      },
    ] as never)

    const res = await getPushScheduled(cronRequest("/api/cron/push-scheduled", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(body.recurring).toBe(0)
    expect(sendPushToMany).not.toHaveBeenCalled()
  })

  it("returns 500 via handleError on internal failure", async () => {
    vi.mocked(db.scheduledPushNotification.findMany).mockRejectedValue(new Error("db exploded"))

    const res = await getPushScheduled(cronRequest("/api/cron/push-scheduled", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("db exploded")
  })
})

// ============================================================================
// GET /api/cron/scheduled-push — Bearer CRON_SECRET guard
// ============================================================================

describe("GET /api/cron/scheduled-push", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CRON_SECRET
    vi.mocked(db.scheduledPushNotification.findMany).mockResolvedValue([])
    vi.mocked(db.pushSubscription.groupBy).mockResolvedValue([])
    vi.mocked(db.scheduledPushNotification.update).mockResolvedValue(undefined as never)
    vi.mocked(sendPushNotification).mockResolvedValue(undefined as never)
  })

  it("returns 401 when the Authorization header is missing", async () => {
    const res = await getScheduledPush(cronRequest("/api/cron/scheduled-push"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 401 when the Bearer token is wrong", async () => {
    const res = await getScheduledPush(cronRequest("/api/cron/scheduled-push", "wrong"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("sends pushes to users with active subscriptions and marks the notification SENT", async () => {
    vi.mocked(db.scheduledPushNotification.findMany).mockResolvedValue([
      {
        id: "n-1",
        title: "Oferta relâmpago",
        body: "Imperdível",
        pushUrl: "/oferta",
        userIds: ["u1", "u2", "u3"],
        type: "promo",
      },
    ] as never)
    vi.mocked(db.pushSubscription.groupBy).mockResolvedValue([
      { userId: "u1" },
      { userId: "u3" },
    ] as never)

    const res = await getScheduledPush(cronRequest("/api/cron/scheduled-push", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.processed).toBe(1)
    expect(body.results[0]).toMatchObject({
      id: "n-1",
      status: "SENT",
      sentCount: 2,
      errorCount: 0,
    })
    expect(sendPushNotification).toHaveBeenCalledTimes(2)
    expect(sendPushNotification).toHaveBeenCalledWith(
      "u1",
      "Oferta relâmpago",
      "Imperdível",
      "/oferta",
    )
  })

  it("marks the notification FAILED when no user has an active subscription", async () => {
    vi.mocked(db.scheduledPushNotification.findMany).mockResolvedValue([
      { id: "n-2", title: "Sem subs", body: "", pushUrl: "/", userIds: ["u9"], type: "info" },
    ] as never)
    vi.mocked(db.pushSubscription.groupBy).mockResolvedValue([])

    const res = await getScheduledPush(cronRequest("/api/cron/scheduled-push", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(body.results[0]).toMatchObject({
      id: "n-2",
      status: "FAILED",
      sentCount: 0,
      errorCount: 1,
    })
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it("counts per-user send errors and reports them to Sentry", async () => {
    vi.mocked(db.scheduledPushNotification.findMany).mockResolvedValue([
      { id: "n-3", title: "Parcial", body: "", pushUrl: "/", userIds: ["u1", "u2"], type: "info" },
    ] as never)
    vi.mocked(db.pushSubscription.groupBy).mockResolvedValue([
      { userId: "u1" },
      { userId: "u2" },
    ] as never)
    vi.mocked(sendPushNotification)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error("push provider down"))

    const res = await getScheduledPush(cronRequest("/api/cron/scheduled-push", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(body.results[0]).toMatchObject({ status: "SENT", sentCount: 1, errorCount: 1 })
    expect(captureError).toHaveBeenCalledTimes(1)
    expect(captureError).toHaveBeenCalledWith(expect.any(Error), {
      scheduledId: "n-3",
      userId: "u2",
      context: "cron scheduled-push send",
    })
  })

  it("returns 500 via handleError on internal failure", async () => {
    vi.mocked(db.scheduledPushNotification.findMany).mockRejectedValue(new Error("db exploded"))

    const res = await getScheduledPush(cronRequest("/api/cron/scheduled-push", CRON_SECRET), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toContain("db exploded")
  })
})

// ============================================================================
// GET /api/health — infra health check (public)
// ============================================================================

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetHealthCache()
    vi.mocked(db.$queryRaw).mockResolvedValue([{ available: true }])
    vi.mocked(getClient).mockReturnValue({ ping: vi.fn().mockResolvedValue("PONG") } as never)
    // `as never` — getCacheStats now also returns tier metrics (redisAvailable,
    // memoryStoreSize, activeTier, degradationCount); the route's body.cache is
    // asserted with strict toEqual below, so keep the mocked shape unchanged.
    vi.mocked(getCacheStats).mockReturnValue({
      hits: 42,
      misses: 8,
      total: 50,
      hitRatio: 0.84,
    } as never)
    vi.mocked(getGeoSettings).mockResolvedValue({
      nominatimEnabled: true,
      viacepEnabled: true,
      nominatimBaseUrl: "https://nominatim.example.com",
      viacepBaseUrl: "https://viacep.example.com",
      userAgent: "severinno-healthcheck/1.0",
    } as never)
    mockFetchFn.mockImplementation(() => okJson({ status: 0, erro: false, message: "ok" }))
  })

  it("returns 200 with ok status when all services pass", async () => {
    const res = await getHealth()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.checks).toEqual({
      database: "ok",
      redis: "ok",
      rabbitmq: "ok",
      nominatim: "ok",
      viacep: "ok",
      postgis: "ok",
      s3: "disabled",
      opensearch: "disabled",
      tracing: "disabled",
    })
    expect(body.cache).toEqual({ hits: 42, misses: 8, total: 50, hitRatio: 0.84 })
    expect(body.geo.nominatim).toBe("online")
    expect(body.geo.viacep).toBe("online")
    expect(body.geo.postgis).toBe("available")
    expect(body.version).toBe("1.0.0-test")
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })

  it("returns 503 degraded when a service fails", async () => {
    vi.mocked(getClient).mockReturnValue(null)
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("connection refused"))

    const res = await getHealth()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe("degraded")
    expect(body.checks.database).toBe("error")
    expect(body.checks.redis).toBe("error")
  })

  it("treats kill-switched geo services as disabled without network calls", async () => {
    vi.mocked(getGeoSettings).mockResolvedValue({
      nominatimEnabled: false,
      viacepEnabled: false,
      nominatimBaseUrl: "https://nominatim.example.com",
      viacepBaseUrl: "https://viacep.example.com",
      userAgent: "severinno-healthcheck/1.0",
    } as never)

    const res = await getHealth()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.checks.nominatim).toBe("disabled")
    expect(body.checks.viacep).toBe("disabled")
    expect(body.geo.nominatim).toContain("kill-switch")
    expect(mockFetchFn).not.toHaveBeenCalled()
  })

  it("serves cached results within the 15s TTL", async () => {
    const first = await getHealth()
    expect(first.status).toBe(200)

    // Break the underlying checks; the cache should still serve the healthy result
    vi.mocked(getClient).mockReturnValue(null)
    vi.mocked(db.$queryRaw).mockRejectedValue(new Error("down"))

    const res = await getHealth()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.checks.database).toBe("ok")
  })
})

// ============================================================================
// GET /api/metrics — infra metrics (public)
// ============================================================================

describe("GET /api/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getCacheStats).mockReturnValue({
      hits: 100,
      misses: 20,
      total: 120,
      hitRatio: 0.83,
    } as never)
  })

  it("returns cache and process metrics as JSON", async () => {
    const res = await getMetrics(new Request("http://localhost/api/metrics"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.cache).toEqual({ hits: 100, misses: 20, total: 120, hitRatio: 0.83 })
    expect(body.process.uptime).toBeGreaterThanOrEqual(0)
    expect(body.process.memoryRss).toBeGreaterThan(0)
    expect(body.process.memoryHeapUsed).toBeGreaterThan(0)
    expect(body.process.cpuUser).toBeGreaterThanOrEqual(0)
    expect(typeof body.timestamp).toBe("string")
    expect(new Date(body.timestamp).getTime()).not.toBeNaN()
  })

  it("exposes zero cache stats when the cache is empty", async () => {
    vi.mocked(getCacheStats).mockReturnValue({
      hits: 0,
      misses: 0,
      total: 0,
      hitRatio: null,
    } as never)

    const res = await getMetrics(new Request("http://localhost/api/metrics"))
    const body = await res.json()

    expect(body.cache).toEqual({ hits: 0, misses: 0, total: 0, hitRatio: null })
  })
})

// ============================================================================
// GET /api/metrics/prometheus — 302 alias to /api/health/detailed
// ============================================================================

describe("GET /api/metrics/prometheus", () => {
  it("redirects to the Prometheus-format health endpoint with 302", async () => {
    const req = new Request("http://localhost:3000/api/metrics/prometheus")
    const res = await getPrometheus(req)

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/api/health/detailed?format=prometheus",
    )
  })

  it("preserves the request origin in the redirect target", async () => {
    const req = new Request("https://severinno.com.br/api/metrics/prometheus")
    const res = await getPrometheus(req)

    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(
      "https://severinno.com.br/api/health/detailed?format=prometheus",
    )
  })
})

// ============================================================================
// POST /api/sentry — Sentry/GlitchTip envelope tunnel
// ============================================================================

describe("POST /api/sentry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Pin the tunnel target: the route reads GLITCHTIP_INTERNAL_URL lazily
    // (lazy accessor), and the dev machine may export a different value.
    vi.stubEnv("GLITCHTIP_INTERNAL_URL", "http://glitchtip-web:8000")
    mockFetchFn.mockImplementation(() => new Response("upstream-ok", { status: 200 }))
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it("forwards the envelope to the GlitchTip ingest endpoint", async () => {
    const envelope = '{"dsn":"https://abc@sentry.example.com/42"}\n{"type":"event"}'
    const req = new NextRequest("http://localhost:3000/api/sentry", {
      method: "POST",
      body: envelope,
    })

    const res = await postSentry(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("upstream-ok")
    expect(mockFetchFn).toHaveBeenCalledWith("http://glitchtip-web:8000/api/42/envelope/", {
      method: "POST",
      body: envelope,
      headers: { "Content-Type": "application/x-sentry-envelope" },
    })
  })

  it("echoes a non-2xx upstream status", async () => {
    mockFetchFn.mockImplementation(() => new Response("nope", { status: 502 }))
    const req = new NextRequest("http://localhost:3000/api/sentry", {
      method: "POST",
      body: '{"dsn":"https://abc@sentry.example.com/42"}\n{"type":"event"}',
    })

    const res = await postSentry(req)

    expect(res.status).toBe(502)
  })

  it("returns 200 with an empty body when the envelope is malformed", async () => {
    const req = new NextRequest("http://localhost:3000/api/sentry", {
      method: "POST",
      body: "not-a-json-envelope",
    })

    const res = await postSentry(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("")
    expect(mockFetchFn).not.toHaveBeenCalled()
  })

  it("returns 200 with an empty body when the upstream fetch fails", async () => {
    mockFetchFn.mockRejectedValue(new Error("glitchtip unreachable"))
    const req = new NextRequest("http://localhost:3000/api/sentry", {
      method: "POST",
      body: '{"dsn":"https://abc@sentry.example.com/42"}\n{"type":"event"}',
    })

    const res = await postSentry(req)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("")
  })
})
