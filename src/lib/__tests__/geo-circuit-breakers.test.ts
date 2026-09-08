/**
 * Tests for geo-circuit-breakers.ts — pre-configured circuit breaker instances.
 *
 * Coverage:
 *   1. nominatimBreaker — exists, correct config
 *   2. viacepBreaker — exists, correct config
 *   3. osrmBreaker — exists, correct config
 *   4. osrmTableBreaker — exists, correct config
 *   5. isEnabled called with correct flag names
 *   6. disabled=true when feature flag is off
 */

import { describe, it, expect, vi } from "vitest"

const { createCircuitBreaker, mockBreaker } = vi.hoisted(() => {
  const mockBreaker = { execute: vi.fn(), getStats: vi.fn(), reset: vi.fn() }
  return { createCircuitBreaker: vi.fn(() => mockBreaker), mockBreaker }
})

vi.mock("@/lib/circuit-breaker", () => ({
  createCircuitBreaker,
}))

vi.mock("@/lib/feature-flags", () => ({
  isEnabled: vi.fn(() => true),
}))

import {
  nominatimBreaker,
  viacepBreaker,
  osrmBreaker,
  osrmTableBreaker,
} from "@/lib/geo-circuit-breakers"
import { isEnabled } from "@/lib/feature-flags"

// ---------------------------------------------------------------------------
// Tests — module-level side effects run once at import time
// ---------------------------------------------------------------------------

describe("geo-circuit-breakers", () => {
  it("creates exactly 4 circuit breakers", () => {
    expect(createCircuitBreaker).toHaveBeenCalledTimes(4)
  })

  it("nominatimBreaker is the mock breaker with correct config", () => {
    expect(nominatimBreaker).toBe(mockBreaker)
    expect(createCircuitBreaker).toHaveBeenCalledWith("nominatim", {
      failureThreshold: 3,
      cooldownMs: 60_000,
      disabled: false,
    })
  })

  it("viacepBreaker is the mock breaker with correct config", () => {
    expect(viacepBreaker).toBe(mockBreaker)
    expect(createCircuitBreaker).toHaveBeenCalledWith("viacep", {
      failureThreshold: 3,
      cooldownMs: 60_000,
      disabled: false,
    })
  })

  it("osrmBreaker is the mock breaker with correct config", () => {
    expect(osrmBreaker).toBe(mockBreaker)
    expect(createCircuitBreaker).toHaveBeenCalledWith("osrm", {
      failureThreshold: 3,
      cooldownMs: 30_000,
      disabled: false,
    })
  })

  it("osrmTableBreaker is the mock breaker with correct config", () => {
    expect(osrmTableBreaker).toBe(mockBreaker)
    expect(createCircuitBreaker).toHaveBeenCalledWith("osrm-table", {
      failureThreshold: 3,
      cooldownMs: 30_000,
      disabled: false,
    })
  })

  it("calls isEnabled with correct flag names", () => {
    expect(isEnabled).toHaveBeenCalledWith("circuit-breaker-nominatim")
    expect(isEnabled).toHaveBeenCalledWith("circuit-breaker-viacep")
    expect(isEnabled).toHaveBeenCalledWith("circuit-breaker-osrm")
  })

  it("sets disabled=true when feature flag is off", async () => {
    vi.mocked(isEnabled).mockReturnValue(false)
    vi.resetModules()

    const freshCreate = vi.fn(() => mockBreaker)
    vi.doMock("@/lib/circuit-breaker", () => ({ createCircuitBreaker: freshCreate }))
    vi.doMock("@/lib/feature-flags", () => ({
      isEnabled: vi.fn(() => false),
    }))

    await import("@/lib/geo-circuit-breakers")

    expect(freshCreate).toHaveBeenCalledWith("nominatim", {
      failureThreshold: 3,
      cooldownMs: 60_000,
      disabled: true,
    })
    expect(freshCreate).toHaveBeenCalledWith("viacep", {
      failureThreshold: 3,
      cooldownMs: 60_000,
      disabled: true,
    })
    expect(freshCreate).toHaveBeenCalledWith("osrm", {
      failureThreshold: 3,
      cooldownMs: 30_000,
      disabled: true,
    })
    expect(freshCreate).toHaveBeenCalledWith("osrm-table", {
      failureThreshold: 3,
      cooldownMs: 30_000,
      disabled: true,
    })

    vi.doUnmock("@/lib/circuit-breaker")
    vi.doUnmock("@/lib/feature-flags")
  })
})
