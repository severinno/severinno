import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockLogger } from "./geo-test-helpers"

const mockLoggerInfo = vi.hoisted(() => vi.fn())

vi.mock("@/lib/logger", () => ({
  default: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

import {
  recordGeofenceEnter,
  recordGeofenceExit,
  recordGeofenceWhatsApp,
  recordGeofenceLockContention,
  recordGeofenceError,
  recordOsrmFallback,
  recordTimezoneLookup,
  getGeoMetricsSnapshot,
  logGeoMetricsSummary,
} from "../geo-observability"

describe("geo-observability.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset counters by calling record functions in reverse won't work —
    // snapshot is additive. We rely on fresh module state per test file.
  })

  describe("geofencing counters", () => {
    it("recordGeofenceEnter increments enterEvents", () => {
      const before = getGeoMetricsSnapshot().geofencing.enterEvents
      recordGeofenceEnter()
      recordGeofenceEnter()
      expect(getGeoMetricsSnapshot().geofencing.enterEvents).toBe(before + 2)
    })

    it("recordGeofenceExit increments exitEvents", () => {
      const before = getGeoMetricsSnapshot().geofencing.exitEvents
      recordGeofenceExit()
      expect(getGeoMetricsSnapshot().geofencing.exitEvents).toBe(before + 1)
    })

    it("recordGeofenceWhatsApp(true) increments whatsappSent", () => {
      const before = getGeoMetricsSnapshot().geofencing.whatsappSent
      recordGeofenceWhatsApp(true)
      expect(getGeoMetricsSnapshot().geofencing.whatsappSent).toBe(before + 1)
    })

    it("recordGeofenceWhatsApp(false) increments whatsappFailed", () => {
      const before = getGeoMetricsSnapshot().geofencing.whatsappFailed
      recordGeofenceWhatsApp(false)
      expect(getGeoMetricsSnapshot().geofencing.whatsappFailed).toBe(before + 1)
    })

    it("recordGeofenceLockContention increments lockContentions", () => {
      const before = getGeoMetricsSnapshot().geofencing.lockContentions
      recordGeofenceLockContention()
      expect(getGeoMetricsSnapshot().geofencing.lockContentions).toBe(before + 1)
    })

    it("recordGeofenceError increments engineErrors", () => {
      const before = getGeoMetricsSnapshot().geofencing.engineErrors
      recordGeofenceError()
      expect(getGeoMetricsSnapshot().geofencing.engineErrors).toBe(before + 1)
    })

    it("recordOsrmFallback increments osrmFallbackTriggers", () => {
      const before = getGeoMetricsSnapshot().geofencing.osrmFallbackTriggers
      recordOsrmFallback()
      expect(getGeoMetricsSnapshot().geofencing.osrmFallbackTriggers).toBe(before + 1)
    })
  })

  describe("timezone counters", () => {
    it("recordTimezoneLookup increments lookups and byTimezone", () => {
      const before = getGeoMetricsSnapshot().timezone.lookups
      recordTimezoneLookup("America/Manaus", false)
      recordTimezoneLookup("America/Manaus", false)
      const snap = getGeoMetricsSnapshot().timezone
      expect(snap.lookups).toBe(before + 2)
      expect(snap.byTimezone["America/Manaus"]).toBeGreaterThanOrEqual(2)
    })

    it("recordTimezoneLookup with isFallback increments fallbackToBrasilia", () => {
      const before = getGeoMetricsSnapshot().timezone.fallbackToBrasilia
      recordTimezoneLookup("America/Sao_Paulo", true)
      expect(getGeoMetricsSnapshot().timezone.fallbackToBrasilia).toBe(before + 1)
    })

    it("recordTimezoneLookup with isFallback=false does not increment fallback", () => {
      const before = getGeoMetricsSnapshot().timezone.fallbackToBrasilia
      recordTimezoneLookup("America/Rio_Branco", false)
      expect(getGeoMetricsSnapshot().timezone.fallbackToBrasilia).toBe(before)
    })
  })

  describe("getGeoMetricsSnapshot", () => {
    it("returns a copy (not mutable reference)", () => {
      const snap1 = getGeoMetricsSnapshot()
      const snap2 = getGeoMetricsSnapshot()
      expect(snap1).not.toBe(snap2)
      expect(snap1.geofencing).not.toBe(snap2.geofencing)
      expect(snap1.timezone).not.toBe(snap2.timezone)
      expect(snap1.timezone.byTimezone).not.toBe(snap2.timezone.byTimezone)
    })

    it("includes uptime > 0", () => {
      expect(getGeoMetricsSnapshot().uptime).toBeGreaterThan(0)
    })
  })

  describe("logGeoMetricsSummary", () => {
    it("calls logger.info with metrics data", () => {
      logGeoMetricsSummary()
      expect(mockLoggerInfo).toHaveBeenCalledTimes(1)
      const [payload, msg] = mockLoggerInfo.mock.calls[0]
      expect(msg).toBe("geo-observability: metrics snapshot")
      expect(payload).toHaveProperty("geofencing")
      expect(payload).toHaveProperty("timezone")
    })
  })

  describe("e2e — realistic multi-operation scenarios", () => {
    it("builds up a realistic metrics snapshot from multiple operations", () => {
      recordGeofenceEnter()
      recordGeofenceEnter()
      recordGeofenceExit()
      recordGeofenceWhatsApp(true)
      recordGeofenceWhatsApp(true)
      recordGeofenceWhatsApp(false)
      recordGeofenceLockContention()
      recordGeofenceError()
      recordOsrmFallback()
      recordTimezoneLookup("America/Sao_Paulo", false)
      recordTimezoneLookup("America/Sao_Paulo", false)
      recordTimezoneLookup("America/Manaus", false)
      recordTimezoneLookup("America/Sao_Paulo", true)

      const snap = getGeoMetricsSnapshot()
      expect(snap.geofencing.enterEvents).toBeGreaterThanOrEqual(2)
      expect(snap.geofencing.exitEvents).toBeGreaterThanOrEqual(1)
      expect(snap.geofencing.whatsappSent).toBeGreaterThanOrEqual(2)
      expect(snap.geofencing.whatsappFailed).toBeGreaterThanOrEqual(1)
      expect(snap.geofencing.lockContentions).toBeGreaterThanOrEqual(1)
      expect(snap.geofencing.engineErrors).toBeGreaterThanOrEqual(1)
      expect(snap.geofencing.osrmFallbackTriggers).toBeGreaterThanOrEqual(1)
      expect(snap.timezone.lookups).toBeGreaterThanOrEqual(4)
      expect(snap.timezone.fallbackToBrasilia).toBeGreaterThanOrEqual(1)
      expect(snap.timezone.byTimezone["America/Sao_Paulo"]).toBeGreaterThanOrEqual(3)
      expect(snap.timezone.byTimezone["America/Manaus"]).toBeGreaterThanOrEqual(1)
    })

    it("formats fallback rate correctly in logGeoMetricsSummary", () => {
      const before = getGeoMetricsSnapshot().timezone
      recordTimezoneLookup("America/Sao_Paulo", false)
      recordTimezoneLookup("America/Manaus", false)
      recordTimezoneLookup("America/Sao_Paulo", true)

      logGeoMetricsSummary()
      const [payload] = mockLoggerInfo.mock.calls[mockLoggerInfo.mock.calls.length - 1]
      const after = getGeoMetricsSnapshot().timezone
      const expectedRate =
        after.lookups > 0
          ? `${((after.fallbackToBrasilia / after.lookups) * 100).toFixed(1)}%`
          : "0%"
      expect(payload.timezone.fallbackRate).toBe(expectedRate)
      expect(after.lookups).toBe(before.lookups + 3)
      expect(after.fallbackToBrasilia).toBe(before.fallbackToBrasilia + 1)
    })

    it("returns consistent structure after many operations", () => {
      for (let i = 0; i < 20; i++) {
        recordGeofenceEnter()
        recordGeofenceExit()
        recordOsrmFallback()
        recordTimezoneLookup("America/Sao_Paulo", i % 3 === 0)
      }

      const snap = getGeoMetricsSnapshot()
      expect(snap).toHaveProperty("geofencing")
      expect(snap).toHaveProperty("timezone")
      expect(snap).toHaveProperty("uptime")
      expect(snap.geofencing).toHaveProperty("enterEvents")
      expect(snap.geofencing).toHaveProperty("exitEvents")
      expect(snap.geofencing).toHaveProperty("whatsappSent")
      expect(snap.geofencing).toHaveProperty("whatsappFailed")
      expect(snap.geofencing).toHaveProperty("lockContentions")
      expect(snap.geofencing).toHaveProperty("engineErrors")
      expect(snap.geofencing).toHaveProperty("osrmFallbackTriggers")
      expect(snap.timezone).toHaveProperty("lookups")
      expect(snap.timezone).toHaveProperty("fallbackToBrasilia")
      expect(snap.timezone).toHaveProperty("byTimezone")
      expect(typeof snap.uptime).toBe("number")
    })

    it("uptime is monotonically non-decreasing between calls", () => {
      const snap1 = getGeoMetricsSnapshot()
      const snap2 = getGeoMetricsSnapshot()
      expect(snap2.uptime).toBeGreaterThanOrEqual(snap1.uptime)
    })
  })

  describe("createMockLogger helper", () => {
    it("returns an object with info, warn, error, debug spies", () => {
      const logger = createMockLogger()
      expect(typeof logger.info).toBe("function")
      expect(typeof logger.warn).toBe("function")
      expect(typeof logger.error).toBe("function")
      expect(typeof logger.debug).toBe("function")
      logger.info("test")
      expect(logger.info).toHaveBeenCalledWith("test")
    })
  })
})
