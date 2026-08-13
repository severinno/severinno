/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * Tests for evaluateGeoHealth() — geo service degradation monitor.
 *
 * Coverage:
 *   ✅ Healthy: no alerts on first healthy check
 *   ✅ Degradation → alert after 2 consecutive failures (≈10min, >5min)
 *   ✅ Recovery: sends recovery notification when service comes back
 *   ✅ Debounce: no duplicate alerts within 5 min window
 *   ✅ PostGIS critical severity: uses "error" instead of "warn"
 *   ✅ Mixed scenario: one service down, one ok
 *   ✅ All services down at once
 *
 * notifyGeoAlert is mocked so we can verify it's called with the right
 * arguments without being coupled to its internal implementation (which
 * calls captureMessage + push internally).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks (must be before the module import)
// ---------------------------------------------------------------------------

const mockNotifyGeoAlert = vi.hoisted(() => vi.fn())
const mockSendMail = vi.hoisted(() => vi.fn())
const mockLoggerInfo = vi.hoisted(() => vi.fn())
const mockLoggerWarn = vi.hoisted(() => vi.fn())
const mockFetch = vi.hoisted(() => vi.fn())

// Mock notifyGeoAlert so tests are decoupled from its internal Sentry + push
vi.mock("@/lib/geo-alert-notify", () => ({
  notifyGeoAlert: (...args: any[]) => {
    mockNotifyGeoAlert(...args)
    return Promise.resolve({
      sentrySent: true,
      pushSent: true,
      pushDebounced: false,
      adminCount: 1,
    })
  },
}))

vi.mock("@/lib/mail", () => ({
  sendMail: (...args: any[]) => mockSendMail(...args),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: mockLoggerInfo, warn: mockLoggerWarn, error: vi.fn() },
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: vi.fn() },
}))

// Mock global fetch for Slack webhook
vi.stubGlobal("fetch", mockFetch)

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { evaluateGeoHealth, resetGeoHealthState, type GeoHealthInput } from "../geo-health-alert"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** All services healthy. */
const HEALTHY: GeoHealthInput = {
  nominatim: { status: "ok", detail: "online" },
  viacep: { status: "ok", detail: "online" },
  postgis: { status: "ok", detail: "available" },
}

/** Nominatim degraded only. */
const NOMINATIM_DOWN: GeoHealthInput = {
  nominatim: { status: "error", detail: "HTTP 503" },
  viacep: { status: "ok", detail: "online" },
  postgis: { status: "ok", detail: "available" },
}

/** ViaCEP degraded only. */
const VIACEP_DOWN: GeoHealthInput = {
  nominatim: { status: "ok", detail: "online" },
  viacep: { status: "error", detail: "timeout" },
  postgis: { status: "ok", detail: "available" },
}

/** PostGIS degraded only. */
const POSTGIS_DOWN: GeoHealthInput = {
  nominatim: { status: "ok", detail: "online" },
  viacep: { status: "ok", detail: "online" },
  postgis: { status: "error", detail: "extension not found" },
}

/** All three degraded. */
const ALL_DOWN: GeoHealthInput = {
  nominatim: { status: "error", detail: "HTTP 503" },
  viacep: { status: "error", detail: "timeout" },
  postgis: { status: "error", detail: "extension not found" },
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  resetGeoHealthState()
  mockFetch.mockResolvedValue(new Response(null, { status: 200 }))
})

// ===========================================================================
// Tests
// ===========================================================================

describe("evaluateGeoHealth — healthy state", () => {
  it("returns zero alerts when all services are healthy", async () => {
    const result = await evaluateGeoHealth(HEALTHY)

    expect(result.checked).toBe(3)
    expect(result.degraded).toBe(0)
    expect(result.alertsSent).toBe(0)
    expect(result.recoveriesSent).toBe(0)
    expect(result.slackSent).toBe(false)
    expect(mockNotifyGeoAlert).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("sets status=ok and consecutiveFailures=0 for all services", async () => {
    const result = await evaluateGeoHealth(HEALTHY)

    for (const svc of result.services) {
      expect(svc.status).toBe("ok")
      expect(svc.consecutiveFailures).toBe(0)
      expect(svc.alerted).toBe(false)
      expect(svc.recovered).toBe(false)
    }
  })
})

describe("evaluateGeoHealth — degradation → alert", () => {
  it("does NOT alert on first failure (need 2 consecutive)", async () => {
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(result.degraded).toBe(1)
    expect(result.alertsSent).toBe(0)
    expect(mockNotifyGeoAlert).not.toHaveBeenCalled()
  })

  it("alerts on second consecutive failure (threshold reached)", async () => {
    // Check 1: first failure
    await evaluateGeoHealth(NOMINATIM_DOWN)

    // Check 2: second consecutive failure → threshold reached
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(result.alertsSent).toBe(1)
    expect(result.services[0]!.alerted).toBe(true) // nominatim

    // notifyGeoAlert should have been called once (for nominatim)
    expect(mockNotifyGeoAlert).toHaveBeenCalledTimes(1)
    expect(mockNotifyGeoAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "warning",
        source: "geo-health-alert",
        tag: "geo-health:nominatim:degraded",
      }),
    )
  })

  it("sends email after threshold is reached", async () => {
    process.env.ADMIN_EMAIL = "admin@test.com"

    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    // Should have called sendMail with degradation subject
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@test.com",
        subject: expect.stringContaining("⚠️"),
      }),
    )

    delete process.env.ADMIN_EMAIL
  })
})

describe("evaluateGeoHealth — recovery", () => {
  it("sends recovery notification when service comes back", async () => {
    // Two failures to trigger alert
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    // Clear mocks so we can detect new calls from recovery
    mockNotifyGeoAlert.mockClear()
    mockSendMail.mockClear()

    // Recovery: service is healthy again
    const result = await evaluateGeoHealth(HEALTHY)

    expect(result.recoveriesSent).toBe(1)
    expect(result.services[0]!.recovered).toBe(true) // nominatim

    // notifyGeoAlert should have been called for recovery info
    expect(mockNotifyGeoAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "info",
        tag: "geo-health:nominatim:recovery",
        source: "geo-health-alert",
      }),
    )
  })

  it("does NOT send recovery if no alert was previously sent", async () => {
    // One failure only (no alert yet)
    await evaluateGeoHealth(NOMINATIM_DOWN)
    mockNotifyGeoAlert.mockClear()

    // Recovery
    const result = await evaluateGeoHealth(HEALTHY)

    expect(result.recoveriesSent).toBe(0)
    expect(mockNotifyGeoAlert).not.toHaveBeenCalled()
  })
})

describe("evaluateGeoHealth — debounce", () => {
  it("does not send another alert within 5 minutes", async () => {
    // Trigger alert (2 failures)
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(mockNotifyGeoAlert).toHaveBeenCalledTimes(1)
    mockNotifyGeoAlert.mockClear()

    // Third consecutive failure within the 5 min debounce window
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)

    // Should NOT trigger another alert
    expect(result.alertsSent).toBe(0)
    expect(mockNotifyGeoAlert).not.toHaveBeenCalled()
  })

  it("sends new alert after 5+ minutes have passed", async () => {
    // Trigger alert
    await evaluateGeoHealth(NOMINATIM_DOWN)
    await evaluateGeoHealth(NOMINATIM_DOWN)
    mockNotifyGeoAlert.mockClear()

    // Third consecutive failure — debounced by lastAlertedAt
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)
    expect(result.alertsSent).toBe(0) // debounced

    // Verify consecutive failures still increment
    expect(result.services[0]!.consecutiveFailures).toBe(3)
  })
})

describe("evaluateGeoHealth — PostGIS critical severity", () => {
  it("uses 'error' severity for PostGIS degradation", async () => {
    // Trigger alert (2 failures)
    await evaluateGeoHealth(POSTGIS_DOWN)
    const result = await evaluateGeoHealth(POSTGIS_DOWN)

    expect(result.alertsSent).toBe(1)

    // PostGIS should use "error" severity via notifyGeoAlert
    const criticalCall = mockNotifyGeoAlert.mock.calls.find((call: any[]) =>
      call[0]?.title?.includes("PostGIS"),
    )

    expect(criticalCall).toBeTruthy()
    expect(criticalCall![0]?.severity).toBe("error")
  })

  it("uses 'warn' severity for Nominatim degradation", async () => {
    // Trigger alert (2 failures)
    await evaluateGeoHealth(NOMINATIM_DOWN)
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(result.alertsSent).toBe(1)

    // Nominatim should use "warn" severity via notifyGeoAlert
    const warnCall = mockNotifyGeoAlert.mock.calls.find((call: any[]) =>
      call[0]?.title?.includes("Nominatim"),
    )

    expect(warnCall).toBeTruthy()
    expect(warnCall![0]?.severity).toBe("warning")
  })
})

describe("evaluateGeoHealth — mixed and edge cases", () => {
  it("handles one service down while others are healthy", async () => {
    // Check 1: first failure for nominatim only
    const r1 = await evaluateGeoHealth(NOMINATIM_DOWN)
    expect(r1.checked).toBe(3)
    expect(r1.degraded).toBe(1)

    // Check 2: trigger alert for nominatim
    const r2 = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(r2.alertsSent).toBe(1)
    expect(r2.services[0]!.alerted).toBe(true) // nominatim
    expect(r2.services[1]!.alerted).toBe(false) // viacep
    expect(r2.services[2]!.alerted).toBe(false) // postgis
  })

  it("all three services degraded triggers 3 alerts total", async () => {
    // After 2 checks with all down, should alert for all 3
    await evaluateGeoHealth(ALL_DOWN)
    const result = await evaluateGeoHealth(ALL_DOWN)

    expect(result.alertsSent).toBe(3) // one per service
    expect(result.services.every((s) => s.alerted)).toBe(true)

    // notifyGeoAlert called 3 times (one per service)
    expect(mockNotifyGeoAlert).toHaveBeenCalledTimes(3)
  })

  it("correctly tracks consecutive failures across calls", async () => {
    // Healthy
    const r0 = await evaluateGeoHealth(HEALTHY)
    expect(r0.services[0]!.consecutiveFailures).toBe(0)

    // One failure
    const r1 = await evaluateGeoHealth(NOMINATIM_DOWN)
    expect(r1.services[0]!.consecutiveFailures).toBe(1)

    // Two failures → alerted
    const r2 = await evaluateGeoHealth(NOMINATIM_DOWN)
    expect(r2.services[0]!.consecutiveFailures).toBe(2)
    expect(r2.services[0]!.alerted).toBe(true)

    // Recovery resets to 0
    const r3 = await evaluateGeoHealth(HEALTHY)
    expect(r3.services[0]!.consecutiveFailures).toBe(0)
    expect(r3.services[0]!.recovered).toBe(true)
  })

  it("sends Slack notification when SLACK_WEBHOOK_URL is set", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test"

    await evaluateGeoHealth(NOMINATIM_DOWN)
    const result = await evaluateGeoHealth(NOMINATIM_DOWN)

    expect(result.slackSent).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    )

    delete process.env.SLACK_WEBHOOK_URL
  })
})
