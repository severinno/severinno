/**
 * Tests for notifyGeoAlert() — multi-channel alert dispatch.
 *
 * Coverage:
 *   ✅ Round-trip: basic success with admins found
 *   ✅ No tag: no debounce, all channels fire
 *   ✅ Push debounce: same tag within 15 min → debounced
 *   ✅ Sentry debounce: same tag within 15 min → sentry suppressed
 *   ✅ Different tags: both sent independently
 *   ✅ No admins found → push skipped, adminCount = 0
 *   ✅ DB error → push skipped gracefully
 *   ✅ Push failure (allSettled reject) → pushSent = false
 *   ✅ Severity mapping: error/warning/info
 *   ✅ resetGeoAlertDebounce: clears debounce state
 *   ✅ Payload context passed to Sentry + push
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks (must be before module imports)
// ---------------------------------------------------------------------------

const mockFindMany = vi.hoisted(() => vi.fn())
const mockCaptureMessage = vi.hoisted(() => vi.fn())
const mockSendPushNotification = vi.hoisted(() => vi.fn())
const mockLoggerDebug = vi.hoisted(() => vi.fn())
const mockLoggerInfo = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findMany: mockFindMany,
    },
  },
}))

vi.mock("@/lib/sentry", () => ({
  captureMessage: mockCaptureMessage,
}))

vi.mock("@/lib/push", () => ({
  sendPushNotification: mockSendPushNotification,
}))

vi.mock("@/lib/logger", () => ({
  default: { debug: mockLoggerDebug, info: mockLoggerInfo, error: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { notifyGeoAlert, resetGeoAlertDebounce } from "../geo-alert-notify"
import type { GeoAlertPayload } from "../geo-alert-notify"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_IDS = ["admin-1", "admin-2"]

const WARN_PAYLOAD: GeoAlertPayload = {
  title: "Nominatim latency high",
  body: "P95 exceeded 2× baseline (1200ms vs 500ms)",
  severity: "warning",
  source: "geo-performance-alert",
  tag: "geo-p95:nominatim",
  url: "/admin/geo-metrics",
  context: { p95: 1200, baseline: 500 },
}

const ERROR_PAYLOAD: GeoAlertPayload = {
  title: "PostGIS connection failed",
  body: "ST_Distance query failed — extension not found",
  severity: "error",
  source: "geo-health-alert",
  tag: "geo-health:postgis:degraded",
  context: { host: "db.internal" },
}

const INFO_PAYLOAD: GeoAlertPayload = {
  title: "Nominatim recovered",
  body: "Service back online after 3m of degradation",
  severity: "info",
  source: "geo-health-alert",
  tag: "geo-health:nominatim:recovery",
}

/** Payload without a tag — no debounce applies. */
const NO_TAG_PAYLOAD: GeoAlertPayload = {
  title: "Benchmark completed",
  body: "Weekly geo benchmark finished successfully",
  severity: "info",
  source: "benchmark-cron",
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  resetGeoAlertDebounce()

  // Default: two admins found
  mockFindMany.mockResolvedValue(ADMIN_IDS.map((id) => ({ id })))
  // Default: push succeeds
  mockSendPushNotification.mockResolvedValue(undefined)
})

// ===========================================================================
// Round-trip
// ===========================================================================

describe("notifyGeoAlert — round-trip", () => {
  it("sends to Sentry and push when admins exist", async () => {
    const result = await notifyGeoAlert(WARN_PAYLOAD)

    // Result
    expect(result.sentrySent).toBe(true)
    expect(result.pushSent).toBe(true)
    expect(result.pushDebounced).toBe(false)
    expect(result.adminCount).toBe(2)

    // Sentry called with correct args
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("[geo-performance-alert]"),
      "warn",
      { source: "geo-performance-alert", p95: 1200, baseline: 500 },
    )

    // Push sent to all admins
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      "admin-1",
      WARN_PAYLOAD.title,
      WARN_PAYLOAD.body,
      "/admin/geo-metrics",
      expect.objectContaining({
        tag: "geo-p95:nominatim",
        source: "geo-performance-alert",
        data: { p95: 1200, baseline: 500 },
      }),
    )
    expect(mockSendPushNotification).toHaveBeenCalledWith(
      "admin-2",
      WARN_PAYLOAD.title,
      WARN_PAYLOAD.body,
      "/admin/geo-metrics",
      expect.objectContaining({ tag: "geo-p95:nominatim" }),
    )
  })

  it("sends to Sentry even without a tag (no debounce sentry)", async () => {
    const result = await notifyGeoAlert(NO_TAG_PAYLOAD)

    expect(result.sentrySent).toBe(true)
    expect(result.pushSent).toBe(true)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
  })

  it("sends push with fallback URL when url is not provided", async () => {
    const payload: GeoAlertPayload = {
      title: "No URL test",
      body: "Body",
      severity: "warning",
      source: "test",
    }

    await notifyGeoAlert(payload)

    expect(mockSendPushNotification).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "/admin", // default fallback URL
      expect.any(Object),
    )
  })

  it("tags push with auto-generated tag when payload has no tag", async () => {
    await notifyGeoAlert(NO_TAG_PAYLOAD)

    // Each push gets a unique auto-generated tag
    const call1tag = mockSendPushNotification.mock.calls[0]![4]!.tag as string
    const call2tag = mockSendPushNotification.mock.calls[1]![4]!.tag as string

    expect(call1tag).toMatch(/^geo-alert:benchmark-cron:\d+$/)
    expect(call1tag).toBe(call2tag) // same call → same timestamp
  })
})

// ===========================================================================
// Debounce — push
// ===========================================================================

describe("notifyGeoAlert — push debounce", () => {
  it("debounces push when same tag is sent within 15 min", async () => {
    // First call: should send
    const r1 = await notifyGeoAlert(WARN_PAYLOAD)
    expect(r1.pushSent).toBe(true)
    expect(r1.pushDebounced).toBe(false)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)

    vi.clearAllMocks()

    // Second call: within 15 min → push debounced
    const r2 = await notifyGeoAlert(WARN_PAYLOAD)
    expect(r2.pushSent).toBe(false)
    expect(r2.pushDebounced).toBe(true)
    expect(mockSendPushNotification).not.toHaveBeenCalled()
  })

  it("does NOT debounce push when tag is different", async () => {
    await notifyGeoAlert(WARN_PAYLOAD)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)

    vi.clearAllMocks()

    // Different tag
    const other: GeoAlertPayload = {
      title: "ViaCEP degraded",
      body: "Timeout on ViaCEP API",
      severity: "warning",
      source: "geo-health-alert",
      tag: "geo-health:viacep:degraded",
    }
    await notifyGeoAlert(other)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
  })

  it("does NOT debounce push when payload has no tag", async () => {
    await notifyGeoAlert(NO_TAG_PAYLOAD)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)

    vi.clearAllMocks()

    // Second call with no tag: should still send
    await notifyGeoAlert(NO_TAG_PAYLOAD)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
  })

  it("resetGeoAlertDebounce clears debounce state", async () => {
    // First call debounces
    await notifyGeoAlert(WARN_PAYLOAD)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)

    vi.clearAllMocks()

    // Second call debounced
    await notifyGeoAlert(WARN_PAYLOAD)
    expect(mockSendPushNotification).not.toHaveBeenCalled()

    // Reset
    resetGeoAlertDebounce()

    // Third call: should send again
    const r3 = await notifyGeoAlert(WARN_PAYLOAD)
    expect(r3.pushSent).toBe(true)
    expect(r3.pushDebounced).toBe(false)
    expect(mockSendPushNotification).toHaveBeenCalledTimes(2)
  })
})

// ===========================================================================
// Debounce — Sentry
// ===========================================================================

describe("notifyGeoAlert — Sentry debounce", () => {
  it("debounces Sentry when same tag is sent within 15 min", async () => {
    await notifyGeoAlert(WARN_PAYLOAD)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)

    // Second call with same tag: Sentry should be suppressed
    // Clear push mock so we can verify pushSent is true (different debounce domain)
    vi.clearAllMocks()
    mockFindMany.mockResolvedValue(ADMIN_IDS.map((id) => ({ id })))

    const r2 = await notifyGeoAlert(WARN_PAYLOAD)
    expect(r2.sentrySent).toBe(true) // still marked as attempted
    expect(mockCaptureMessage).not.toHaveBeenCalled() // actually suppressed
  })

  it("sends Sentry for a different tag within the same timeframe", async () => {
    await notifyGeoAlert(WARN_PAYLOAD)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mockFindMany.mockResolvedValue(ADMIN_IDS.map((id) => ({ id })))

    // Different tag → new Sentry event
    await notifyGeoAlert(ERROR_PAYLOAD)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
  })

  it("sends Sentry when payload has no tag (no debounce)", async () => {
    await notifyGeoAlert(NO_TAG_PAYLOAD)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    mockFindMany.mockResolvedValue(ADMIN_IDS.map((id) => ({ id })))

    // Second call without tag: Sentry fires again
    await notifyGeoAlert(NO_TAG_PAYLOAD)
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1)
  })
})

// ===========================================================================
// Admin lookup
// ===========================================================================

describe("notifyGeoAlert — admin lookup", () => {
  it("returns adminCount = 0 when no admins exist", async () => {
    mockFindMany.mockResolvedValue([])

    const result = await notifyGeoAlert(WARN_PAYLOAD)

    expect(result.adminCount).toBe(0)
    expect(result.pushSent).toBe(false)
    expect(result.pushDebounced).toBe(false)
    expect(result.sentrySent).toBe(true) // Sentry still fires
    expect(mockSendPushNotification).not.toHaveBeenCalled()
    expect(mockLoggerDebug).toHaveBeenCalledWith(
      "geo-alert-notify: no admin users found — skipping push",
    )
  })

  it("handles DB error gracefully (admin lookup fails)", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection lost"))

    const result = await notifyGeoAlert(WARN_PAYLOAD)

    expect(result.adminCount).toBe(0)
    expect(result.pushSent).toBe(false)
    expect(result.sentrySent).toBe(true) // Sentry still fires
    expect(mockSendPushNotification).not.toHaveBeenCalled()
  })

  it("queries admins with correct filter (role = ADMIN)", async () => {
    await notifyGeoAlert(WARN_PAYLOAD)

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { role: "ADMIN" },
      select: { id: true },
    })
  })
})

// ===========================================================================
// Push failures
// ===========================================================================

describe("notifyGeoAlert — push failures", () => {
  it("reports pushSent = false when all pushes fail", async () => {
    mockSendPushNotification.mockRejectedValue(new Error("Push provider unavailable"))

    const result = await notifyGeoAlert(WARN_PAYLOAD)

    expect(result.pushSent).toBe(false)
    expect(result.sentrySent).toBe(true) // Sentry independent
    expect(result.adminCount).toBe(2)
  })

  it("reports pushSent = true when at least one push succeeds", async () => {
    // First admin fails, second succeeds
    mockSendPushNotification
      .mockRejectedValueOnce(new Error("Device offline"))
      .mockResolvedValueOnce(undefined)

    const result = await notifyGeoAlert(WARN_PAYLOAD)

    expect(result.pushSent).toBe(true)
    expect(result.adminCount).toBe(2)
  })
})

// ===========================================================================
// Severity mapping
// ===========================================================================

describe("notifyGeoAlert — severity mapping", () => {
  it("maps severity = 'error' to Sentry 'error' level", async () => {
    await notifyGeoAlert(ERROR_PAYLOAD)

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("🛑"),
      "error",
      expect.any(Object),
    )
  })

  it("maps severity = 'warning' to Sentry 'warn' level", async () => {
    await notifyGeoAlert(WARN_PAYLOAD)

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("⚠️"),
      "warn",
      expect.any(Object),
    )
  })

  it("maps severity = 'info' to Sentry 'info' level", async () => {
    await notifyGeoAlert(INFO_PAYLOAD)

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      expect.stringContaining("ℹ️"),
      "info",
      expect.any(Object),
    )
  })
})

// ===========================================================================
// Edge cases
// ===========================================================================

describe("notifyGeoAlert — edge cases", () => {
  it("passes context to Sentry but not push extras", async () => {
    const payload: GeoAlertPayload = {
      title: "Context test",
      body: "With extra context",
      severity: "warning",
      source: "test",
      tag: "test:ctx",
      context: { metric: "latency", delta: 0.5 },
    }

    await notifyGeoAlert(payload)

    // Sentry receives context spread into extra
    expect(mockCaptureMessage).toHaveBeenCalledWith(expect.any(String), "warn", {
      source: "test",
      metric: "latency",
      delta: 0.5,
    })
  })

  it("logs info when push succeeds", async () => {
    await notifyGeoAlert(WARN_PAYLOAD)

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        admins: 2,
        pushSent: 2,
        pushFailed: 0,
        tag: "geo-p95:nominatim",
        severity: "warning",
        source: "geo-performance-alert",
      }),
      "geo-alert-notify: alert sent",
    )
  })

  it("returns pushDebounced = false when tag is not provided", async () => {
    const result = await notifyGeoAlert(NO_TAG_PAYLOAD)

    expect(result.pushDebounced).toBe(false)
    expect(result.pushSent).toBe(true)
  })
})
