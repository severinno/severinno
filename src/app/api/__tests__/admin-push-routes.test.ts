/**
 * Tests for the admin push notification routes:
 *   /api/admin/push/analytics        GET
 *   /api/admin/push/audit            GET
 *   /api/admin/push/history          GET
 *   /api/admin/push/metrics          GET
 *   /api/admin/push/recurring        GET | POST | PATCH | DELETE
 *   /api/admin/push/schedule         GET | POST
 *   /api/admin/push/schedule/[id]    PATCH (cancel)
 *   /api/admin/push/send             POST
 *   /api/admin/push/users            GET
 *   /api/admin/push/webhooks         GET | POST
 *   /api/admin/push/webhooks/[id]    PATCH | DELETE
 *   /api/admin/push/webhooks/audit   GET
 *
 * Verifies:
 *  - 401 when the caller is not ADMIN
 *  - Happy paths with realistic mocked DB data
 *  - Validation errors (400) and not-found branches (404)
 *  - Query filter propagation (action/status/type/q/role, etc.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ---- Mocks ----------------------------------------------------------------

const mockDb = vi.hoisted(() => ({
  $queryRawUnsafe: vi.fn(),
  pushAnalytics: {
    count: vi.fn(),
    groupBy: vi.fn(),
    findMany: vi.fn(),
    aggregate: vi.fn(),
    $queryRawUnsafe: vi.fn(),
  },
  pushSubscription: {
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  pushSendLog: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    create: vi.fn(),
  },
  recurringPushSchedule: {
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  scheduledPushNotification: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  notification: {
    create: vi.fn(),
  },
  user: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  eventWebhook: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  webhookExecutionLog: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ db: mockDb }))

vi.mock("@/lib/auth", () => ({
  requireRole: vi.fn().mockResolvedValue({ userId: "admin-1", role: "ADMIN" } as any),
}))

vi.mock("@/lib/api-server", () => {
  class MockHttpError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  }
  return {
    handleError: vi.fn((e: unknown) => {
      if (e instanceof MockHttpError) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: e.status,
          headers: { "content-type": "application/json" },
        })
      }
      // Handle ZodError from parseBody
      if (e && typeof e === "object" && "issues" in e) {
        return new Response(
          JSON.stringify({ error: "Dados inválidos", details: (e as any).issues }),
          { status: 400, headers: { "content-type": "application/json" } },
        )
      }
      if (e instanceof Error && e.message === "UNAUTHORIZED") {
        return new Response(JSON.stringify({ error: "Nao autorizado" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
      }
      if (e instanceof Error && e.message === "FORBIDDEN") {
        return new Response(JSON.stringify({ error: "Acesso proibido" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      }
      const message = e instanceof Error ? e.message : String(e)
      return new Response(JSON.stringify({ ok: false, error: message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    }),
    badRequest: (msg = "Requisicao invalida") => new MockHttpError(400, msg),
    notFound: (msg = "Recurso nao encontrado") => new MockHttpError(404, msg),
    parsePagination: (searchParams: URLSearchParams) => {
      const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1)
      const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? "20") || 20))
      return { page, limit, skip: (page - 1) * limit, take: limit }
    },
  }
})

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock("@/lib/rate-limit", () => ({
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
  RATE_LIMITS: new Proxy({}, { get: () => ({ prefix: "test", max: 1000, windowMs: 60_000 }) }),
}))

vi.mock("@/lib/push", () => ({
  sendPushNotification: vi.fn(),
}))

vi.mock("@/lib/notification-queue", () => ({
  saveAndQueueNotification: vi.fn(),
}))

// ---- SUT imports ----------------------------------------------------------

import { requireRole } from "@/lib/auth"
import { sendPushNotification } from "@/lib/push"
import { saveAndQueueNotification } from "@/lib/notification-queue"
import { GET as getAnalytics } from "../admin/push/analytics/route"
import { GET as getAudit } from "../admin/push/audit/route"
import { GET as getHistory } from "../admin/push/history/route"
import { GET as getMetrics } from "../admin/push/metrics/route"
import {
  GET as getRecurring,
  POST as postRecurring,
  PATCH as patchRecurring,
  DELETE as deleteRecurring,
} from "../admin/push/recurring/route"
import { GET as getSchedule, POST as postSchedule } from "../admin/push/schedule/route"
import { PATCH as patchScheduled } from "../admin/push/schedule/[id]/route"
import { POST as postSend } from "../admin/push/send/route"
import { GET as getUsers } from "../admin/push/users/route"
import { GET as getWebhooks, POST as postWebhooks } from "../admin/push/webhooks/route"
import { PATCH as patchWebhook, DELETE as deleteWebhook } from "../admin/push/webhooks/[id]/route"
import { GET as getWebhookAudit } from "../admin/push/webhooks/audit/route"

// ---- Mock data builders ---------------------------------------------------

const MOCK_SESSION = { userId: "admin-1", role: "ADMIN" as const }

function buildAnalyticsRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "pa-1",
    userId: "u-1",
    title: "New booking available",
    body: "A new booking is waiting for you",
    type: "ADMIN_MANUAL",
    source: "manual",
    status: "sent",
    deviceCount: 1,
    latencyMs: 120,
    errorMessage: null,
    action: null,
    actionResult: null,
    bookingId: null,
    clickedAt: null,
    createdAt: new Date("2026-01-15T10:00:00Z"),
    ...overrides,
  }
}

function buildSendLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "log-1",
    adminId: "admin-1",
    action: "manual_send",
    title: "Reminder",
    body: "Hello from admin",
    pushUrl: "/",
    notificationType: "ADMIN_MANUAL",
    recipientCount: 2,
    sentCount: 2,
    errorCount: 0,
    directPushCount: 0,
    metadata: {},
    createdAt: new Date("2026-02-05T10:00:00Z"),
    admin: {
      id: "admin-1",
      name: "Admin One",
      email: "admin@test.com",
      avatarUrl: null,
    },
    ...overrides,
  }
}

function buildRecurringRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "rr-1",
    frequency: "daily",
    time: "09:00",
    dayOfWeek: null,
    dayOfMonth: null,
    timezone: "America/Sao_Paulo",
    title: "Daily tip",
    body: "Check new opportunities",
    pushUrl: "/",
    type: "RECURRING",
    targetRoles: ["CLIENT", "PROVIDER"],
    filterCity: null,
    status: "ACTIVE",
    lastSentAt: new Date("2026-02-01T09:00:00Z"),
    totalSent: 12,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-02-01T10:00:00Z"),
    ...overrides,
  }
}

function buildScheduledRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "sp-1",
    scheduledAt: new Date("2026-02-10T15:00:00Z"),
    status: "PENDING",
    title: "Reminder",
    body: "Your booking is tomorrow",
    pushUrl: "/",
    type: "ADMIN_MANUAL",
    sentCount: 0,
    errorCount: 0,
    sentAt: null,
    createdAt: new Date("2026-02-01T10:00:00Z"),
    userIds: ["u-1", "u-2"],
    ...overrides,
  }
}

function buildWebhookRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "wh-1",
    event: "booking.created",
    title: "New booking",
    body: "A new booking was created",
    pushUrl: "/bookings",
    targetRoles: ["PROVIDER"],
    active: true,
    createdBy: "admin-1",
    createdAt: new Date("2026-01-10T10:00:00Z"),
    updatedAt: new Date("2026-01-10T10:00:00Z"),
    ...overrides,
  }
}

function buildExecutionLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "el-1",
    webhookId: "wh-1",
    event: "booking.created",
    title: "New booking",
    body: "A new booking was created",
    pushUrl: "/bookings",
    targetRoles: ["PROVIDER"],
    usersFound: 5,
    usersSent: 4,
    usersFailed: 1,
    errorMessage: null,
    status: "partial",
    context: { bookingId: "b-1" },
    executionMs: 320,
    createdAt: new Date("2026-02-05T10:00:00Z"),
    ...overrides,
  }
}

// ---- Test helpers ---------------------------------------------------------

function buildRequest(url: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  const opts: RequestInit = { method: init.method ?? "GET" }
  if (init.body !== undefined) {
    opts.headers = { "content-type": "application/json" }
    opts.body = JSON.stringify(init.body)
  }
  return new NextRequest(new Request(url, opts))
}

function buildParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

async function expectUnauthorized(fn: () => Promise<Response>) {
  vi.mocked(requireRole).mockRejectedValueOnce(new Error("UNAUTHORIZED"))
  const res = await fn()
  expect(res.status).toBe(401)
}

afterEach(() => {
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.mocked(requireRole).mockResolvedValue(MOCK_SESSION)

  // Benign defaults so no route ever awaits an undefined mock
  mockDb.pushAnalytics.count.mockResolvedValue(0)
  mockDb.pushAnalytics.findMany.mockResolvedValue([])
  mockDb.pushAnalytics.groupBy.mockResolvedValue([])
  mockDb.pushAnalytics.aggregate.mockResolvedValue({
    _avg: { latencyMs: null, deviceCount: null },
  })
  mockDb.$queryRawUnsafe.mockResolvedValue([])
  mockDb.pushSubscription.count.mockResolvedValue(0)
  mockDb.pushSubscription.groupBy.mockResolvedValue([])
  mockDb.pushSendLog.findMany.mockResolvedValue([])
  mockDb.pushSendLog.count.mockResolvedValue(0)
  mockDb.pushSendLog.groupBy.mockResolvedValue([])
  mockDb.pushSendLog.create.mockResolvedValue({ id: "log-1" })
  mockDb.recurringPushSchedule.findMany.mockResolvedValue([])
  mockDb.recurringPushSchedule.count.mockResolvedValue(0)
  mockDb.scheduledPushNotification.findMany.mockResolvedValue([])
  mockDb.scheduledPushNotification.count.mockResolvedValue(0)
  mockDb.user.findMany.mockResolvedValue([])
  mockDb.user.count.mockResolvedValue(0)
  mockDb.eventWebhook.findMany.mockResolvedValue([])
  mockDb.eventWebhook.findUnique.mockResolvedValue(null)
  mockDb.webhookExecutionLog.findMany.mockResolvedValue([])
  mockDb.webhookExecutionLog.count.mockResolvedValue(0)
  mockDb.webhookExecutionLog.groupBy.mockResolvedValue([])
  mockDb.notification.create.mockResolvedValue({ id: "n-1" })
  vi.mocked(saveAndQueueNotification).mockResolvedValue(undefined)
  vi.mocked(sendPushNotification).mockResolvedValue(undefined)
})

// ---- GET /api/admin/push/analytics ----------------------------------------

describe("GET /api/admin/push/analytics", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getAnalytics(buildRequest("http://localhost:3000/api/admin/push/analytics?days=30"), {
        params: Promise.resolve({}),
      }),
    )
  })

  it("aggregates delivery metrics with mocked data", async () => {
    mockDb.pushAnalytics.count
      .mockResolvedValueOnce(100) // total sent
      .mockResolvedValueOnce(30) // clicked
      .mockResolvedValueOnce(10) // bounced
      .mockResolvedValueOnce(5) // failed
    mockDb.pushAnalytics.groupBy
      .mockResolvedValueOnce([
        { source: "manual", _count: { id: 60 } },
        { source: "webhook", _count: { id: 40 } },
      ])
      .mockResolvedValueOnce([{ type: "ADMIN_MANUAL", _count: { id: 70 } }])
      .mockResolvedValueOnce([
        { title: "Special offer", _count: { id: 40 }, _sum: { deviceCount: 80 } },
      ])
    mockDb.$queryRawUnsafe.mockResolvedValueOnce([
      { date: "2026-01-15", sent: 10, clicked: 2, bounced: 1, failed: 0 },
    ])
    mockDb.pushSubscription.count.mockResolvedValueOnce(250)

    const res = await getAnalytics(buildRequest("http://localhost:3000/api/admin/push/analytics"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.summary.totalSent).toBe(100)
    expect(body.summary.delivered).toBe(85) // 100 - 10 bounced - 5 failed
    expect(body.summary.clicked).toBe(30)
    expect(body.rates.deliveryRate).toBe(94.44) // 85 / (100-10) = 94.44%
    expect(body.rates.clickRate).toBe(35.29) // 30 / 85 = 35.29%
    expect(body.rates.bounceRate).toBe(10)
    expect(body.rates.failureRate).toBe(5)
    expect(body.activeSubscriptions).toBe(250)
    expect(body.bySource).toHaveLength(2)
    expect(body.bySource[0]).toEqual({ source: "manual", count: 60 })
    expect(body.byType[0]).toEqual({ type: "ADMIN_MANUAL", count: 70 })
    expect(body.daily[0].sent).toBe(10)
    expect(body.topNotifications[0]).toEqual({ title: "Special offer", sent: 40, devices: 80 })
  })

  it("returns zeroed metrics when there is no data", async () => {
    const res = await getAnalytics(buildRequest("http://localhost:3000/api/admin/push/analytics"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(body.summary.totalSent).toBe(0)
    expect(body.summary.delivered).toBe(0)
    expect(body.rates.deliveryRate).toBe(0)
    expect(body.rates.clickRate).toBe(0)
    expect(body.activeSubscriptions).toBe(0)
    expect(body.bySource).toEqual([])
    expect(body.daily).toEqual([])
  })
})

// ---- GET /api/admin/push/audit --------------------------------------------

describe("GET /api/admin/push/audit", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getAudit(buildRequest("http://localhost:3000/api/admin/push/audit"), {
        params: Promise.resolve({}),
      }),
    )
  })

  it("returns paginated send logs with admin info", async () => {
    mockDb.pushSendLog.findMany.mockResolvedValueOnce([
      buildSendLog({ action: "manual_send", sentCount: 2 }),
      buildSendLog({ id: "log-2", action: "scheduled_send", sentCount: 1 }),
    ])
    mockDb.pushSendLog.count.mockResolvedValueOnce(22)
    mockDb.pushSendLog.groupBy
      .mockResolvedValueOnce([{ action: "manual_send", _count: { id: 15 } }])
      .mockResolvedValueOnce([{ notificationType: "ADMIN_MANUAL", _count: { id: 9 } }])

    const res = await getAudit(
      buildRequest("http://localhost:3000/api/admin/push/audit?limit=10"),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].id).toBe("log-1")
    expect(body.items[0].admin).toEqual({
      id: "admin-1",
      name: "Admin One",
      email: "admin@test.com",
      avatarUrl: null,
    })
    expect(body.pagination).toEqual({ page: 1, limit: 10, total: 22, totalPages: 3 })
    expect(body.availableActions).toEqual([{ action: "manual_send", count: 15 }])
    expect(body.availableTypes).toEqual([{ type: "ADMIN_MANUAL", count: 9 }])
  })

  it("propagates action/type/adminId filters to the where clause", async () => {
    mockDb.pushSendLog.findMany.mockResolvedValueOnce([buildSendLog()])

    const res = await getAudit(
      buildRequest(
        "http://localhost:3000/api/admin/push/audit?action=manual_send&type=ADMIN_MANUAL&adminId=admin-1&days=7",
      ),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(mockDb.pushSendLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: "manual_send",
          notificationType: "ADMIN_MANUAL",
          adminId: "admin-1",
        }),
      }),
    )
    expect(body.filters.action).toBe("manual_send")
    expect(body.filters.days).toBe(7)
  })
})

// ---- GET /api/admin/push/history ------------------------------------------

describe("GET /api/admin/push/history", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getHistory(buildRequest("http://localhost:3000/api/admin/push/history"), {
        params: Promise.resolve({}),
      }),
    )
  })

  it("returns paginated push analytics records", async () => {
    mockDb.pushAnalytics.findMany.mockResolvedValueOnce([
      buildAnalyticsRecord({
        id: "pa-1",
        status: "clicked",
        clickedAt: new Date("2026-01-16T10:00:00Z"),
      }),
      buildAnalyticsRecord({
        id: "pa-2",
        status: "bounced",
        source: "auto",
        type: "BOOKING_CREATED",
      }),
    ])
    mockDb.pushAnalytics.count.mockResolvedValueOnce(17)
    mockDb.pushAnalytics.groupBy
      .mockResolvedValueOnce([{ type: "ADMIN_MANUAL", _count: { id: 11 } }])
      .mockResolvedValueOnce([{ source: "manual", _count: { id: 9 } }])

    const res = await getHistory(buildRequest("http://localhost:3000/api/admin/push/history"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].user).toBeNull()
    expect(body.items[0].clickedAt).toBe("2026-01-16T10:00:00.000Z")
    expect(body.items[1].type).toBe("BOOKING_CREATED")
    expect(body.pagination.totalPages).toBe(1)
    expect(body.availableActions).toEqual(["accept", "reject", "view"])
    expect(body.availableTypes[0]).toEqual({ type: "ADMIN_MANUAL", count: 11 })
    expect(body.availableSources[0]).toEqual({ source: "manual", count: 9 })
  })

  it("propagates status/type/source/q/userId/action filters", async () => {
    mockDb.pushAnalytics.findMany.mockResolvedValueOnce([buildAnalyticsRecord()])

    const res = await getHistory(
      buildRequest(
        "http://localhost:3000/api/admin/push/history?status=clicked&type=ADMIN_MANUAL&source=manual&q=booking&userId=u-1&action=view",
      ),
    )
    const body = await res.json()

    expect(mockDb.pushAnalytics.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "clicked",
          type: "ADMIN_MANUAL",
          source: "manual",
          userId: "u-1",
          action: "view",
          title: { contains: "booking", mode: "insensitive" },
        }),
      }),
    )
    expect(body.filters.query).toBe("booking")
  })
})

// ---- GET /api/admin/push/metrics ------------------------------------------

describe("GET /api/admin/push/metrics", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getMetrics(buildRequest("http://localhost:3000/api/admin/push/metrics"), {
        params: Promise.resolve({}),
      }),
    )
  })

  it("aggregates dashboard metrics with mocked data", async () => {
    mockDb.pushAnalytics.count
      .mockResolvedValueOnce(200) // total
      .mockResolvedValueOnce(80) // sent
      .mockResolvedValueOnce(50) // clicked
      .mockResolvedValueOnce(20) // bounced
      .mockResolvedValueOnce(10) // failed
    mockDb.pushAnalytics.groupBy
      .mockResolvedValueOnce([
        { action: "accept", actionResult: "accepted", _count: { id: 30 } },
        { action: "reject", actionResult: "declined", _count: { id: 20 } },
      ])
      .mockResolvedValueOnce([{ type: "ADMIN_MANUAL", _count: { id: 150 } }])
      .mockResolvedValueOnce([{ source: "manual", _count: { id: 140 } }])
      .mockResolvedValueOnce([
        { userId: "u-1", _count: { id: 3 } },
        { userId: "u-2", _count: { id: 1 } },
      ])
    mockDb.pushSubscription.groupBy.mockResolvedValueOnce([{ userId: "u-1", _count: { id: 1 } }])
    mockDb.$queryRawUnsafe.mockResolvedValueOnce([
      { date: "2026-01-15", total: 5, clicked: 1, bounced: 0, failed: 0 },
    ])
    mockDb.pushAnalytics.aggregate.mockResolvedValueOnce({
      _avg: { latencyMs: 123.46, deviceCount: 1.26 },
    })

    const res = await getMetrics(buildRequest("http://localhost:3000/api/admin/push/metrics"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.overview.total).toBe(200)
    expect(body.overview.deliveryRate).toBe(65) // (80+50)/200
    expect(body.overview.clickRate).toBe(25) // 50/200
    expect(body.overview.bounceRate).toBe(10)
    expect(body.overview.failureRate).toBe(5)
    expect(body.actions).toHaveLength(2)
    expect(body.actions[0]).toEqual({ action: "accept", actionResult: "accepted", count: 30 })
    expect(body.topTypes[0]).toEqual({ type: "ADMIN_MANUAL", count: 150 })
    expect(body.topSources[0]).toEqual({ source: "manual", count: 140 })
    expect(body.timeline[0].total).toBe(5)
    expect(body.users).toEqual({ reachable: 2, subscribed: 1 })
    expect(body.averages.latencyMs).toBe(123.5)
    expect(body.averages.deviceCount).toBe(1.3)
  })

  it("returns zeroed overview when there is no data", async () => {
    const res = await getMetrics(buildRequest("http://localhost:3000/api/admin/push/metrics"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(body.overview.total).toBe(0)
    expect(body.overview.deliveryRate).toBe(0)
    expect(body.users.reachable).toBe(0)
    expect(body.averages.latencyMs).toBeNull()
  })
})

// ---- /api/admin/push/recurring --------------------------------------------

describe("GET /api/admin/push/recurring", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getRecurring(buildRequest("http://localhost:3000/api/admin/push/recurring")),
    )
  })

  it("lists recurring schedules with pagination", async () => {
    mockDb.recurringPushSchedule.findMany.mockResolvedValueOnce([
      buildRecurringRecord(),
      buildRecurringRecord({ id: "rr-2", frequency: "weekly", status: "PAUSED", dayOfWeek: 2 }),
    ])
    mockDb.recurringPushSchedule.count.mockResolvedValueOnce(12)

    const res = await getRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring?status=ACTIVE"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].frequency).toBe("daily")
    expect(body.items[0].lastSentAt).toBe("2026-02-01T09:00:00.000Z")
    expect(body.items[1].dayOfWeek).toBe(2)
    expect(body.pagination.totalPages).toBe(1)
    expect(body.filters.status).toBe("ACTIVE")
  })
})

describe("POST /api/admin/push/recurring", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      postRecurring(
        buildRequest("http://localhost:3000/api/admin/push/recurring", {
          method: "POST",
          body: { frequency: "daily", time: "09:00", title: "Daily tip" },
        }),
      ),
    )
  })

  it("creates a recurring schedule", async () => {
    mockDb.recurringPushSchedule.create.mockResolvedValueOnce(buildRecurringRecord())

    const res = await postRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "POST",
        body: { frequency: "daily", time: "09:00", title: "Daily tip" },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.item.id).toBe("rr-1")
    expect(body.item.status).toBe("ACTIVE")
    expect(body.item.totalSent).toBe(0)
    expect(body.item.timezone).toBe("America/Sao_Paulo")
    expect(mockDb.recurringPushSchedule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdBy: "admin-1", status: "ACTIVE" }),
      }),
    )
  })

  it("rejects an invalid frequency with 400", async () => {
    const res = await postRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "POST",
        body: { frequency: "hourly", time: "09:00", title: "Daily tip" },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("frequency")
  })

  it("requires dayOfWeek for weekly frequency", async () => {
    const res = await postRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "POST",
        body: { frequency: "weekly", time: "09:00", title: "Weekly tip" },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("dayOfWeek")
  })
})

describe("PATCH /api/admin/push/recurring", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      patchRecurring(
        buildRequest("http://localhost:3000/api/admin/push/recurring", {
          method: "PATCH",
          body: { id: "rr-1", status: "PAUSED" },
        }),
      ),
    )
  })

  it("updates a recurring schedule (pause/resume)", async () => {
    mockDb.recurringPushSchedule.findUnique.mockResolvedValueOnce(buildRecurringRecord())
    mockDb.recurringPushSchedule.update.mockResolvedValueOnce(
      buildRecurringRecord({ status: "PAUSED" }),
    )

    const res = await patchRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "PATCH",
        body: { id: "rr-1", status: "PAUSED" },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.item.status).toBe("PAUSED")
    expect(mockDb.recurringPushSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rr-1" }, data: { status: "PAUSED" } }),
    )
  })

  it("returns 404 when the schedule does not exist", async () => {
    mockDb.recurringPushSchedule.findUnique.mockResolvedValueOnce(null)

    const res = await patchRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "PATCH",
        body: { id: "missing", status: "PAUSED" },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain("not found")
  })

  it("rejects an invalid status with 400", async () => {
    mockDb.recurringPushSchedule.findUnique.mockResolvedValueOnce(buildRecurringRecord())

    const res = await patchRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "PATCH",
        body: { id: "rr-1", status: "BROKEN" },
      }),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("ACTIVE")
  })
})

describe("DELETE /api/admin/push/recurring", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      deleteRecurring(
        buildRequest("http://localhost:3000/api/admin/push/recurring", {
          method: "DELETE",
          body: { id: "rr-1" },
        }),
      ),
    )
  })

  it("soft-deletes (archives) a recurring schedule", async () => {
    mockDb.recurringPushSchedule.findUnique.mockResolvedValueOnce(buildRecurringRecord())
    mockDb.recurringPushSchedule.update.mockResolvedValueOnce(
      buildRecurringRecord({ status: "ARCHIVED" }),
    )

    const res = await deleteRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "DELETE",
        body: { id: "rr-1" },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockDb.recurringPushSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rr-1" }, data: { status: "ARCHIVED" } }),
    )
  })

  it("returns 404 when the schedule does not exist", async () => {
    mockDb.recurringPushSchedule.findUnique.mockResolvedValueOnce(null)

    const res = await deleteRecurring(
      buildRequest("http://localhost:3000/api/admin/push/recurring", {
        method: "DELETE",
        body: { id: "missing" },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain("not found")
  })
})

// ---- /api/admin/push/schedule ---------------------------------------------

describe("GET /api/admin/push/schedule", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getSchedule(buildRequest("http://localhost:3000/api/admin/push/schedule")),
    )
  })

  it("lists scheduled notifications with pagination", async () => {
    mockDb.scheduledPushNotification.findMany.mockResolvedValueOnce([
      buildScheduledRecord(),
      buildScheduledRecord({
        id: "sp-2",
        status: "SENT",
        sentAt: new Date("2026-02-11T15:00:00Z"),
      }),
    ])
    mockDb.scheduledPushNotification.count.mockResolvedValueOnce(5)

    const res = await getSchedule(buildRequest("http://localhost:3000/api/admin/push/schedule"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].scheduledAt).toBe("2026-02-10T15:00:00.000Z")
    expect(body.items[0].userIdsCount).toBe(2)
    expect(body.items[1].sentAt).toBe("2026-02-11T15:00:00.000Z")
    expect(body.total).toBe(5)
    expect(body.totalPages).toBe(1)
  })

  it("filters by status and passes it to the query", async () => {
    mockDb.scheduledPushNotification.findMany.mockResolvedValueOnce([buildScheduledRecord()])

    await getSchedule(
      buildRequest("http://localhost:3000/api/admin/push/schedule?status=PENDING&page=2&limit=10"),
    )

    expect(mockDb.scheduledPushNotification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING" }, skip: 10, take: 10 }),
    )
  })
})

describe("POST /api/admin/push/schedule", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      postSchedule(
        buildRequest("http://localhost:3000/api/admin/push/schedule", {
          method: "POST",
          body: {
            userIds: ["u-1"],
            title: "Reminder",
            scheduledAt: "2026-02-10T15:00:00Z",
          },
        }),
      ),
    )
  })

  it("creates a scheduled push notification (201)", async () => {
    mockDb.scheduledPushNotification.create.mockResolvedValueOnce(buildScheduledRecord())

    const res = await postSchedule(
      buildRequest("http://localhost:3000/api/admin/push/schedule", {
        method: "POST",
        body: {
          userIds: ["u-1", "u-2"],
          title: "Reminder",
          body: "Your booking is tomorrow",
          scheduledAt: "2026-02-10T15:00:00Z",
          pushUrl: "/bookings",
          type: "ADMIN_MANUAL",
        },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.scheduled.id).toBe("sp-1")
    expect(body.scheduled.userIdsCount).toBe(2)
    expect(body.scheduled.status).toBe("PENDING")
    expect(mockDb.scheduledPushNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdBy: "admin-1" }) }),
    )
    // Fire-and-forget audit log is created (promise must resolve, not throw)
    expect(mockDb.pushSendLog.create).toHaveBeenCalled()
  })

  it("rejects a request without userIds with 400", async () => {
    const res = await postSchedule(
      buildRequest("http://localhost:3000/api/admin/push/schedule", {
        method: "POST",
        body: { title: "Reminder", scheduledAt: "2026-02-10T15:00:00Z" },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("userIds")
  })

  it("rejects an invalid scheduledAt with 400", async () => {
    const res = await postSchedule(
      buildRequest("http://localhost:3000/api/admin/push/schedule", {
        method: "POST",
        body: { userIds: ["u-1"], title: "Reminder", scheduledAt: "not-a-date" },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("scheduledAt")
  })
})

// ---- PATCH /api/admin/push/schedule/[id] ----------------------------------

describe("PATCH /api/admin/push/schedule/[id]", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      patchScheduled(
        buildRequest("http://localhost:3000/api/admin/push/schedule/sp-1", {
          method: "PATCH",
          body: { action: "cancel" },
        }),
        buildParams("sp-1"),
      ),
    )
  })

  it("cancels a PENDING scheduled notification", async () => {
    mockDb.scheduledPushNotification.findUnique.mockResolvedValueOnce(
      buildScheduledRecord({ status: "PENDING" }),
    )
    mockDb.scheduledPushNotification.update.mockResolvedValueOnce(
      buildScheduledRecord({ status: "CANCELLED" }),
    )

    const res = await patchScheduled(
      buildRequest("http://localhost:3000/api/admin/push/schedule/sp-1", {
        method: "PATCH",
        body: { action: "cancel" },
      }),
      buildParams("sp-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockDb.scheduledPushNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sp-1" }, data: { status: "CANCELLED" } }),
    )
  })

  it("returns 400 for an unsupported action", async () => {
    const res = await patchScheduled(
      buildRequest("http://localhost:3000/api/admin/push/schedule/sp-1", {
        method: "PATCH",
        body: { action: "reschedule" },
      }),
      buildParams("sp-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("cancel")
  })

  it("returns 404 when the scheduled notification does not exist", async () => {
    mockDb.scheduledPushNotification.findUnique.mockResolvedValueOnce(null)

    const res = await patchScheduled(
      buildRequest("http://localhost:3000/api/admin/push/schedule/missing", {
        method: "PATCH",
        body: { action: "cancel" },
      }),
      buildParams("missing"),
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain("nao encontrado")
  })

  it("returns 400 when the notification is not PENDING", async () => {
    mockDb.scheduledPushNotification.findUnique.mockResolvedValueOnce(
      buildScheduledRecord({ status: "SENT" }),
    )

    const res = await patchScheduled(
      buildRequest("http://localhost:3000/api/admin/push/schedule/sp-1", {
        method: "PATCH",
        body: { action: "cancel" },
      }),
      buildParams("sp-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("PENDING")
  })
})

// ---- POST /api/admin/push/send --------------------------------------------

describe("POST /api/admin/push/send", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      postSend(
        buildRequest("http://localhost:3000/api/admin/push/send", {
          method: "POST",
          body: { userIds: ["u-1"], title: "Hello" },
        }),
      ),
    )
  })

  it("queues a manual push for all users via RabbitMQ", async () => {
    const res = await postSend(
      buildRequest("http://localhost:3000/api/admin/push/send", {
        method: "POST",
        body: { userIds: ["u-1", "u-2"], title: "Hello", body: "World" },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.sentCount).toBe(2)
    expect(body.directPushCount).toBe(0)
    expect(body.errorCount).toBe(0)
    expect(body.total).toBe(2)
    expect(body.message).toContain("enfileirada")
    expect(saveAndQueueNotification).toHaveBeenCalledTimes(2)
    expect(mockDb.pushSendLog.create).toHaveBeenCalled()
  })

  it("falls back to direct push when the queue is unavailable", async () => {
    vi.mocked(saveAndQueueNotification).mockRejectedValueOnce(new Error("queue down"))

    const res = await postSend(
      buildRequest("http://localhost:3000/api/admin/push/send", {
        method: "POST",
        body: { userIds: ["u-1"], title: "Hello" },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(body.sentCount).toBe(1)
    expect(body.directPushCount).toBe(1)
    expect(body.errorCount).toBe(0)
    expect(body.message).toContain("fallback direto")
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
    expect(mockDb.notification.create).toHaveBeenCalledTimes(1)
  })

  it("counts errors when both queue and direct push fail", async () => {
    vi.mocked(saveAndQueueNotification).mockRejectedValueOnce(new Error("queue down"))
    vi.mocked(sendPushNotification).mockRejectedValueOnce(new Error("push down"))

    const res = await postSend(
      buildRequest("http://localhost:3000/api/admin/push/send", {
        method: "POST",
        body: { userIds: ["u-1"], title: "Hello" },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(body.sentCount).toBe(0)
    expect(body.directPushCount).toBe(0)
    expect(body.errorCount).toBe(1)
  })

  it("rejects an empty userIds array with 400", async () => {
    const res = await postSend(
      buildRequest("http://localhost:3000/api/admin/push/send", {
        method: "POST",
        body: { userIds: [], title: "Hello" },
      }),
      { params: Promise.resolve({}) },
    )

    expect(res.status).toBe(400)
  })
})

// ---- GET /api/admin/push/users --------------------------------------------

describe("GET /api/admin/push/users", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getUsers(buildRequest("http://localhost:3000/api/admin/push/users"), {
        params: Promise.resolve({}),
      }),
    )
  })

  it("lists users with active push subscriptions", async () => {
    mockDb.user.findMany.mockResolvedValueOnce([
      {
        id: "u-1",
        name: "Alice",
        email: "alice@test.com",
        role: "CLIENT",
        avatarUrl: null,
        city: "Sao Paulo",
        state: "SP",
        _count: { pushSubscriptions: 2 },
      },
      {
        id: "u-2",
        name: "Bob",
        email: "bob@test.com",
        role: "PROVIDER",
        avatarUrl: "https://example.com/avatar.png",
        city: "Rio de Janeiro",
        state: "RJ",
        _count: { pushSubscriptions: 1 },
      },
    ])
    mockDb.user.count.mockResolvedValueOnce(2)
    mockDb.pushSubscription.count.mockResolvedValueOnce(3)

    const res = await getUsers(buildRequest("http://localhost:3000/api/admin/push/users"), {
      params: Promise.resolve({}),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].subscriptionsCount).toBe(2)
    expect(body.items[0].role).toBe("CLIENT")
    expect(body.total).toBe(2)
    expect(body.totalSubscriptions).toBe(3)
  })

  it("propagates q and role filters to the query", async () => {
    mockDb.user.findMany.mockResolvedValueOnce([
      {
        id: "u-1",
        name: "Alice",
        email: "alice@test.com",
        role: "CLIENT",
        avatarUrl: null,
        city: null,
        state: null,
        _count: { pushSubscriptions: 1 },
      },
    ])

    await getUsers(buildRequest("http://localhost:3000/api/admin/push/users?q=ali&role=CLIENT"), {
      params: Promise.resolve({}),
    })

    expect(mockDb.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "CLIENT",
          pushSubscriptions: { some: {} },
          OR: [{ name: { contains: "ali" } }, { email: { contains: "ali" } }],
        }),
      }),
    )
  })
})

// ---- /api/admin/push/webhooks ---------------------------------------------

describe("GET /api/admin/push/webhooks", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getWebhooks(buildRequest("http://localhost:3000/api/admin/push/webhooks")),
    )
  })

  it("lists all event webhook rules", async () => {
    mockDb.eventWebhook.findMany.mockResolvedValueOnce([
      buildWebhookRule(),
      buildWebhookRule({
        id: "wh-2",
        event: "booking.confirmed",
        title: "Booking confirmed",
        active: false,
      }),
    ])

    const res = await getWebhooks(buildRequest("http://localhost:3000/api/admin/push/webhooks"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.webhooks).toHaveLength(2)
    expect(body.webhooks[0].event).toBe("booking.created")
    expect(body.webhooks[0].targetRoles).toEqual(["PROVIDER"])
    expect(body.webhooks[1].active).toBe(false)
    expect(mockDb.eventWebhook.findMany).toHaveBeenCalled()
  })
})

describe("POST /api/admin/push/webhooks", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      postWebhooks(
        buildRequest("http://localhost:3000/api/admin/push/webhooks", {
          method: "POST",
          body: { event: "booking.created", title: "New booking", targetRoles: ["PROVIDER"] },
        }),
      ),
    )
  })

  it("creates a new event webhook rule (201)", async () => {
    mockDb.eventWebhook.findUnique.mockResolvedValueOnce(null)
    mockDb.eventWebhook.create.mockResolvedValueOnce(buildWebhookRule())

    const res = await postWebhooks(
      buildRequest("http://localhost:3000/api/admin/push/webhooks", {
        method: "POST",
        body: {
          event: "booking.created",
          title: "New booking",
          body: "A new booking was created",
          pushUrl: "/bookings",
          targetRoles: ["PROVIDER"],
          active: true,
        },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.ok).toBe(true)
    expect(body.webhook.id).toBe("wh-1")
    expect(body.webhook.targetRoles).toEqual(["PROVIDER"])
    expect(mockDb.eventWebhook.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdBy: "admin-1" }) }),
    )
  })

  it("rejects an invalid event with 400", async () => {
    const res = await postWebhooks(
      buildRequest("http://localhost:3000/api/admin/push/webhooks", {
        method: "POST",
        body: { event: "bogus.event", title: "New booking", targetRoles: ["PROVIDER"] },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("event invalido")
  })

  it("rejects a duplicate rule (event + title) with 400", async () => {
    mockDb.eventWebhook.findUnique.mockResolvedValueOnce(buildWebhookRule())

    const res = await postWebhooks(
      buildRequest("http://localhost:3000/api/admin/push/webhooks", {
        method: "POST",
        body: { event: "booking.created", title: "New booking", targetRoles: ["PROVIDER"] },
      }),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("Ja existe")
  })
})

// ---- /api/admin/push/webhooks/[id] ----------------------------------------

describe("PATCH /api/admin/push/webhooks/[id]", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      patchWebhook(
        buildRequest("http://localhost:3000/api/admin/push/webhooks/wh-1", {
          method: "PATCH",
          body: { active: false },
        }),
        buildParams("wh-1"),
      ),
    )
  })

  it("updates an existing webhook rule", async () => {
    mockDb.eventWebhook.findUnique.mockResolvedValueOnce(buildWebhookRule())
    mockDb.eventWebhook.update.mockResolvedValueOnce(buildWebhookRule({ active: false }))

    const res = await patchWebhook(
      buildRequest("http://localhost:3000/api/admin/push/webhooks/wh-1", {
        method: "PATCH",
        body: { active: false },
      }),
      buildParams("wh-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.webhook.active).toBe(false)
    expect(mockDb.eventWebhook.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "wh-1" }, data: { active: false } }),
    )
  })

  it("returns 404 when the webhook rule does not exist", async () => {
    mockDb.eventWebhook.findUnique.mockResolvedValueOnce(null)

    const res = await patchWebhook(
      buildRequest("http://localhost:3000/api/admin/push/webhooks/missing", {
        method: "PATCH",
        body: { active: false },
      }),
      buildParams("missing"),
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain("nao encontrado")
  })

  it("rejects an invalid pushUrl with 400", async () => {
    mockDb.eventWebhook.findUnique.mockResolvedValueOnce(buildWebhookRule())

    const res = await patchWebhook(
      buildRequest("http://localhost:3000/api/admin/push/webhooks/wh-1", {
        method: "PATCH",
        body: { pushUrl: "javascript:alert(1)" },
      }),
      buildParams("wh-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("pushUrl")
  })
})

describe("DELETE /api/admin/push/webhooks/[id]", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      deleteWebhook(
        buildRequest("http://localhost:3000/api/admin/push/webhooks/wh-1", {
          method: "DELETE",
        }),
        buildParams("wh-1"),
      ),
    )
  })

  it("deletes an existing webhook rule", async () => {
    mockDb.eventWebhook.findUnique.mockResolvedValueOnce(buildWebhookRule())
    mockDb.eventWebhook.delete.mockResolvedValueOnce(buildWebhookRule())

    const res = await deleteWebhook(
      buildRequest("http://localhost:3000/api/admin/push/webhooks/wh-1", {
        method: "DELETE",
      }),
      buildParams("wh-1"),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockDb.eventWebhook.delete).toHaveBeenCalledWith({ where: { id: "wh-1" } })
  })

  it("returns 404 when the webhook rule does not exist", async () => {
    mockDb.eventWebhook.findUnique.mockResolvedValueOnce(null)

    const res = await deleteWebhook(
      buildRequest("http://localhost:3000/api/admin/push/webhooks/missing", {
        method: "DELETE",
      }),
      buildParams("missing"),
    )
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toContain("nao encontrado")
  })
})

// ---- GET /api/admin/push/webhooks/audit -----------------------------------

describe("GET /api/admin/push/webhooks/audit", () => {
  it("returns 401 when the caller is not ADMIN", async () => {
    await expectUnauthorized(() =>
      getWebhookAudit(buildRequest("http://localhost:3000/api/admin/push/webhooks/audit"), {
        params: Promise.resolve({}),
      }),
    )
  })

  it("returns paginated webhook execution logs", async () => {
    mockDb.webhookExecutionLog.findMany.mockResolvedValueOnce([
      buildExecutionLog(),
      buildExecutionLog({ id: "el-2", event: "booking.confirmed", status: "success" }),
    ])
    mockDb.webhookExecutionLog.count.mockResolvedValueOnce(13)
    mockDb.webhookExecutionLog.groupBy
      .mockResolvedValueOnce([{ event: "booking.created", _count: { id: 8 } }])
      .mockResolvedValueOnce([{ status: "success", _count: { id: 7 } }])
    mockDb.eventWebhook.findMany.mockResolvedValueOnce([buildWebhookRule()])

    const res = await getWebhookAudit(
      buildRequest("http://localhost:3000/api/admin/push/webhooks/audit"),
      { params: Promise.resolve({}) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.items).toHaveLength(2)
    expect(body.items[0].status).toBe("partial")
    expect(body.items[0].usersSent).toBe(4)
    expect(body.pagination.totalPages).toBe(1)
    expect(body.availableEvents[0]).toEqual({ event: "booking.created", count: 8 })
    expect(body.availableStatuses[0]).toEqual({ status: "success", count: 7 })
    expect(body.webhookRules).toEqual([
      { id: "wh-1", title: "New booking", event: "booking.created" },
    ])
  })

  it("propagates event/status/webhookId filters", async () => {
    mockDb.webhookExecutionLog.findMany.mockResolvedValueOnce([buildExecutionLog()])

    const res = await getWebhookAudit(
      buildRequest(
        "http://localhost:3000/api/admin/push/webhooks/audit?event=booking.created&status=partial&webhookId=wh-1",
      ),
    )
    const body = await res.json()

    expect(mockDb.webhookExecutionLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event: "booking.created",
          status: "partial",
          webhookId: "wh-1",
        }),
      }),
    )
    expect(body.filters.event).toBe("booking.created")
  })
})
