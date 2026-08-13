/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * geo-health-integration.test.ts
 *
 * Integration test for the complete geo health pipeline:
 *
 *   evaluateGeoHealth  →  notifyGeoAlert  →  Sentry captureMessage
 *                                        →  Push notification (web-push)
 *                                        →  Slack webhook (fetch)
 *                                        →  Email (sendMail)
 *
 * Only external boundaries are mocked:
 *   - @/lib/sentry (captureMessage)
 *   - @/lib/push (sendPushNotification)
 *   - @/lib/db (user.findMany — admin lookup)
 *   - @/lib/mail (sendMail)
 *   - @/lib/slack-notify (sendSlackAlert)
 *   - @/lib/logger
 *   - global fetch (Slack webhook inside evaluateGeoHealth)
 *
 * WHAT IS NOT mocked:
 *   - notifyGeoAlert itself — the real implementation runs
 *   - evaluateGeoHealth — the real implementation runs
 *   - geo-alert-notify.ts internal debounce state
 *   - geo-health-alert.ts internal consecutive-failure state
 *
 * This validates that:
 *   1. evaluateGeoHealth generates correct alert payloads
 *   2. notifyGeoAlert correctly dispatches to Sentry + Push + Slack + Email
 *   3. Debounce state is shared correctly across the two modules
 *   4. The alert pipeline produces the expected return values end-to-end
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mock EXTERNAL boundaries only — NOT notifyGeoAlert
// ---------------------------------------------------------------------------

const mockCaptureMessage = vi.hoisted(() => vi.fn())
const mockSendPushNotification = vi.hoisted(() => vi.fn())
const mockFindMany = vi.hoisted(() => vi.fn())
const mockSendMail = vi.hoisted(() => vi.fn())
const mockSendSlackAlert = vi.hoisted(() => vi.fn())
const mockLoggerInfo = vi.hoisted(() => vi.fn())
const mockLoggerDebug = vi.hoisted(() => vi.fn())
const mockLoggerWarn = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

// Sentry
vi.mock("@/lib/sentry", () => ({
  captureMessage: mockCaptureMessage,
}))

// Push notifications
vi.mock("@/lib/push", () => ({
  sendPushNotification: mockSendPushNotification,
}))

// Database — admin user lookup
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: mockFindMany,
    },
  },
}))

// Email
vi.mock("@/lib/mail", () => ({
  sendMail: mockSendMail,
}))

// Slack — uses fetch internally
vi.mock("@/lib/slack-notify", () => ({
  sendSlackAlert: mockSendSlackAlert,
}))

// Logger
vi.mock("@/lib/logger", () => ({
  default: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    debug: mockLoggerDebug,
    error: mockLoggerError,
  },
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    debug: mockLoggerDebug,
    error: mockLoggerError,
  },
}))

// Server-only module (required by vitest)
vi.mock("server-only", () => ({}))

// ---------------------------------------------------------------------------
// Imports — real implementations (not mocked!)
// ---------------------------------------------------------------------------

import { evaluateGeoHealth, resetGeoHealthState } from "../geo-health-alert"
import { resetGeoAlertDebounce } from "../geo-alert-notify"
import type { GeoHealthInput } from "../geo-health-alert"

// notifyGeoAlert is NOT mocked — the real implementation runs
// Both modules are imported and tested together

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOMINATIM_DOWN: GeoHealthInput = {
  nominatim: { status: "error", detail: "HTTP 503" },
  viacep: { status: "ok", detail: "online" },
  postgis: { status: "ok", detail: "available" },
}

const ALL_DOWN: GeoHealthInput = {
  nominatim: { status: "error", detail: "HTTP 503" },
  viacep: { status: "error", detail: "timeout" },
  postgis: { status: "error", detail: "extension not found" },
}

const HEALTHY: GeoHealthInput = {
  nominatim: { status: "ok", detail: "online" },
  viacep: { status: "ok", detail: "online" },
  postgis: { status: "ok", detail: "available" },
}

const ADMIN_EMAIL = "admin@severinno.com.br"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  resetGeoHealthState()
  resetGeoAlertDebounce()

  // Default: admins found
  mockFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }])
  // Default: push succeeds
  mockSendPushNotification.mockResolvedValue(undefined)
  // Default: email and app env vars
  process.env.NEXT_PUBLIC_APP_URL = "https://severinno.com.br"
  process.env.ADMIN_EMAIL = ADMIN_EMAIL
})

afterEach(() => {
  delete process.env.ADMIN_EMAIL
})

// ===========================================================================
// Pipeline: degradation → alert → Sentry + Push
// ===========================================================================
// These tests validate the real flow:
//   evaluateGeoHealth(checks)
//     → notifyGeoAlert(payload)  [REAL implementation]
//       → captureMessage         [mocked]
//       → sendPushNotification   [mocked]
//       → sendSlackAlert         [mocked]
//     → sendMail                  [mocked]
// ===========================================================================

describe("Pipeline: evaluateGeoHealth → notifyGeoAlert → Sentry + Push", () => {
  it("sends Sentry + Push alert after 2 consecutive failures via real notifyGeoAlert", async () => {
    // First check — first failure (no alert yet)
    const r1 = await evaluateGeoHealth(NOMINATIM_DOWN)
    expect(r1.alertsSent).toBe(0)
    expect(r1.degraded).toBe(1)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockSendPushNotification).not.toHaveBeenCalled()

    // Second check — consecutive failure triggers real notifyGeoAlert
    const r2 = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(r2.alertsSent).toBe(1)
    expect(r2.services[0]!.alerted).toBe(true) // nominatim

    // Real notifyGeoAlert fires → Sentry captureMessage called
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("[geo-health-alert]"),
      "warn",
      expect.objectContaining({
        source: "geo-health-alert",
        service: "nominatim",
        consecutiveFailures: 2,
      }),
    )

    // Real notifyGeoAlert fires → Push sent to both admins
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      "admin-1",
      expect.stringContaining("Nominatim"),
      expect.stringContaining("HTTP 503"),
      "/admin/geo-metrics",
      expect.objectContaining({ tag: "geo-health:nominatim:degraded" }),
    )
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      "admin-2",
      expect.stringContaining("Nominatim"),
      expect.any(String),
      "/admin/geo-metrics",
      expect.objectContaining({ tag: "geo-health:nominatim:degraded" }),
    )

    // Slack alert sent via sendSlackAlert
    expect(mockSendSlackAlert).toHaveBeenCalledTimes(1)
    expect(mockSendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        source: "geo-health-alert",
        title: expect.stringContaining("Nominatim"),
      }),
    )

    // Email sent via sendMail
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("Nominatim"),
        html: expect.stringContaining("503"),
      }),
    )
  })

  it("dispatches PostGIS alert with 'error' severity via real notifyGeoAlert", async () => {
    const POSTGIS_DOWN: GeoHealthInput = {
      nominatim: { status: "ok", detail: "online" },
      viacep: { status: "ok", detail: "online" },
      postgis: { status: "error", detail: "extension not found" },
    }

    await evaluateGeoHealth(POSTGIS_DOWN)
    await evaluateGeoHealth(POSTGIS_DOWN) // triggers alert

    // PostGIS is critical → severity "error"
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("[geo-health-alert]"),
      "error",
      expect.objectContaining({
        source: "geo-health-alert",
        service: "postgis",
        critical: true,
      }),
    )

    // Slack receives error severity
    expect(mockSendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "error",
      }),
    )
  })

  it("does NOT send duplicate push when debounced by real notifyGeoAlert", async () => {
    // Trigger alert (2 failures)
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(mockSendPushNotification).toHaveBeenCalledTimes(2) // first alert sent
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }])
    mockSendPushNotification.mockResolvedValue(undefined)

    // Third consecutive failure — still within debounce window
    const r3 = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(r3.alertsSent).toBe(0) // debounced by evaluateGeoHealth's lastAlertedAt
    expect(mockSendPushNotification).not.toHaveBeenCalled()
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it("all 3 services degraded → 3 separate notifyGeoAlert calls + 1 email", async () => {
    await evaluateGeoHealth(ALL_DOWN)
    const result = await evaluateGeoHealth(ALL_DOWN)

    expect(result.alertsSent).toBe(3) // 3 services alerted

    // 3 Sentry events (one per service)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(3)

    // 6 push notifications (3 services × 2 admins)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(6)

    // 1 consolidated email (not 3)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("⚠️"),
      }),
    )

    // 3 Slack alerts (one per service)
    expect(mockSendSlackAlert).toHaveBeenCalledTimes(3)
  })
})

// ===========================================================================
// Pipeline: recovery → notifyGeoAlert → Sentry (info) + Push
// ===========================================================================

describe("Pipeline: recovery → notifyGeoAlert → Sentry (info) + Push", () => {
  it("sends recovery notification after degraded service comes back", async () => {
    // Degrade
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)

    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }])
    mockSendPushNotification.mockResolvedValue(undefined)

    // Recover
    const result = await evaluateGeoHealth(HEALTHY)

    expect(result.recoveriesSent).toBe(1)
    expect(result.services[0]!.recovered).toBe(true)

    // Recovery Sentry (info level)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("[geo-health-alert]"),
      "info",
      expect.objectContaining({
        source: "geo-health-alert",
        service: "nominatim",
      }),
    )

    // Recovery push to both admins
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      "admin-1",
      expect.stringContaining("recuperado"),
      expect.any(String),
      "/admin/geo-metrics",
      expect.objectContaining({ tag: "geo-health:nominatim:recovery" }),
    )

    // Recovery email
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("recuperado"),
      }),
    )
  })

  it("does NOT send recovery if service was never alerted", async () => {
    // First failure only (no alert threshold)
    await evaluateGeoHealth(NOMINATIM_DOWN)
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([{ id: "admin-1" }])

    // Recover immediately (before alert)
    const result = await evaluateGeoHealth(HEALTHY)

    expect(result.recoveriesSent).toBe(0)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockSendPushNotification).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Pipeline: return value shape end-to-end
// ===========================================================================

describe("Pipeline: return value shape", () => {
  it("evaluateGeoHealth result matches expected shape on degradation", async () => {
    await evaluateGeoHealth(NOMINATIM_DOWN)
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(result).toHaveProperty("checked", 3)
    expect(result).toHaveProperty("degraded", 1)
    expect(result).toHaveProperty("alertsSent", 1)
    expect(result).toHaveProperty("recoveriesSent", 0)
    expect(result).toHaveProperty("slackSent", true)

    expect(result.services).toHaveLength(3)
    const nom = result.services[0]!
    expect(nom.name).toBe("nominatim")
    expect(nom.status).toBe("error")
    expect(nom.alerted).toBe(true)
    expect(nom.consecutiveFailures).toBe(2)

    const viacep = result.services[1]!
    expect(viacep.name).toBe("viacep")
    expect(viacep.status).toBe("ok")
    expect(viacep.alerted).toBe(false)

    const postgis = result.services[2]!
    expect(postgis.name).toBe("postgis")
    expect(postgis.status).toBe("ok")
    expect(postgis.alerted).toBe(false)
  })

  it("evaluateGeoHealth returns healthy zero state", async () => {
    const result = await evaluateGeoHealth(HEALTHY)

    expect(result.checked).toBe(3)
    expect(result.degraded).toBe(0)
    expect(result.alertsSent).toBe(0)
    expect(result.recoveriesSent).toBe(0)
    expect(result.slackSent).toBe(false)

    for (const svc of result.services) {
      expect(svc.status).toBe("ok")
      expect(svc.consecutiveFailures).toBe(0)
      expect(svc.alerted).toBe(false)
    }

    // No external calls at all
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockSendPushNotification).not.toHaveBeenCalled()
    expect(mockSendSlackAlert).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Pipeline: Slack and Email dispatched correctly
// ===========================================================================

describe("Pipeline: Slack + Email dispatch", () => {
  it("consolidates multiple degraded services into one email", async () => {
    await evaluateGeoHealth(ALL_DOWN)
    await evaluateGeoHealth(ALL_DOWN)

    // Only 1 email (not 3)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: expect.stringContaining("@"),
        subject: expect.stringContaining("⚠️"),
      }),
    )
  })

  it("sends Slack notification with correct payload shape", async () => {
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(mockSendSlackAlert).toHaveBeenCalledTimes(1)
    const slackPayload = mockSendSlackAlert.mock.calls[0]![0]

    expect(slackPayload).toHaveProperty("title")
    expect(slackPayload).toHaveProperty("body")
    expect(slackPayload).toHaveProperty("severity")
    expect(slackPayload).toHaveProperty("source", "geo-health-alert")
    expect(slackPayload).toHaveProperty("url", "/admin/geo-metrics")
    expect(slackPayload).toHaveProperty("fields")
    expect(slackPayload.fields).toHaveProperty("service")
    expect(slackPayload.fields).toHaveProperty("critical")
    expect(slackPayload.fields).toHaveProperty("consecutiveFailures")
    expect(slackPayload.fields).toHaveProperty("duration")
  })

  it("sends Slack for recovery as well", async () => {
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([{ id: "admin-1" }])
    mockSendPushNotification.mockResolvedValue(undefined)

    await evaluateGeoHealth(HEALTHY)

    expect(mockSendSlackAlert).toHaveBeenCalledTimes(1)
    expect(mockSendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("recuperado"),
        severity: "info",
      }),
    )
  })

  it("sends recovery email when service comes back", async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL

    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([{ id: "admin-1" }])
    mockSendPushNotification.mockResolvedValue(undefined)

    await evaluateGeoHealth(HEALTHY)

    // Recovery email
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ADMIN_EMAIL,
        subject: expect.stringContaining("✅"),
      }),
    )
  })

  it("skips email when ADMIN_EMAIL is not set", async () => {
    delete process.env.ADMIN_EMAIL
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    // notifyGeoAlert + Slack still fire
    expect(mockCaptureMessage).toHaveBeenCalled()
    expect(mockSendPushNotification).toHaveBeenCalled()
    expect(mockSendSlackAlert).toHaveBeenCalled()

    // But email is skipped
    expect(mockSendMail).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// Pipeline: Debounce consistency between modules
// ===========================================================================

describe("Pipeline: debounce consistency", () => {
  it("debounce is respected across consecutive evaluateGeoHealth calls", async () => {
    // Trigger alert (2 failures)
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mockFindMany.mockResolvedValue([{ id: "admin-1" }])

    // 8 more consecutive failures — all debounced
    for (let i = 0; i < 8; i++) {
      await evaluateGeoHealth(NOMINATIM_DOWN)
    }

    // No new alerts (debounced by evaluateGeoHealth's lastAlertedAt)
    expect(mockCaptureMessage).not.toHaveBeenCalled()
    expect(mockSendPushNotification).not.toHaveBeenCalled()

    // But consecutive failures keep incrementing
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)
    expect(result.services[0]!.consecutiveFailures).toBeGreaterThan(2)
  })

  it("real notifyGeoAlert + evaluateGeoHealth debounce work together", async () => {
    // Reset between stages to prevent cross-fixture recovery alerts
    async function triggerAndReset(fixture: GeoHealthInput) {
      await evaluateGeoHealth(fixture)
      const result = await evaluateGeoHealth(fixture)
      return result
    }

    // Trigger alert for nominatim
    const r1 = await triggerAndReset(NOMINATIM_DOWN)
    expect(r1.alertsSent).toBe(1)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)

    vi.clearAllMocks()
    resetGeoHealthState()
    mockFindMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }])
    mockSendPushNotification.mockResolvedValue(undefined)

    // Different service triggers a new alert (different tag = not debounced)
    const VIACEP_DOWN: GeoHealthInput = {
      nominatim: { status: "ok", detail: "online" },
      viacep: { status: "error", detail: "timeout" },
      postgis: { status: "ok", detail: "available" },
    }

    const r2 = await triggerAndReset(VIACEP_DOWN)
    expect(r2.alertsSent).toBe(1)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("ViaCEP"),
      "warn",
      expect.any(Object),
    )
  })
})

// ===========================================================================
// Pipeline: Admin lookup integration
// ===========================================================================

describe("Pipeline: admin lookup integration", () => {
  it("queries admins from DB with correct filter", async () => {
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    // notifyGeoAlert queried admins
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { role: "ADMIN" },
      select: { id: true },
    })
  })

  it("skips push when no admins exist, but still sends email", async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL
    mockFindMany.mockResolvedValue([])

    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    // No push (no admins)
    expect(mockSendPushNotification).not.toHaveBeenCalled()

    // But email still sent (ADMIN_EMAIL env var, not DB)
    expect(mockSendMail).toHaveBeenCalledTimes(1)
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ADMIN_EMAIL,
        subject: expect.stringContaining("⚠️"),
      }),
    )

    // Slack NOT fired (notifyGeoAlert returns early when no admins found)
    expect(mockSendSlackAlert).not.toHaveBeenCalled()
  })

  it("handles DB failure gracefully — Sentry + email still fire", async () => {
    process.env.ADMIN_EMAIL = ADMIN_EMAIL
    mockFindMany.mockRejectedValue(new Error("DB connection lost"))

    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    // Sentry still fires (notifyGeoAlert handles DB failure gracefully)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)

    // Push skipped (no admins found due to DB error)
    expect(mockSendPushNotification).not.toHaveBeenCalled()

    // Email still sends (uses env var, not DB)
    expect(mockSendMail).toHaveBeenCalledTimes(1)

    // Slack NOT fired (notifyGeoAlert returns early when no admins found)
    expect(mockSendSlackAlert).not.toHaveBeenCalled()
  })
})
