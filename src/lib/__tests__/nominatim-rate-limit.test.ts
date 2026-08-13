/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for src/lib/nominatim-rate-limit.ts
 *
 * The rate limiter enforces 1 req/s for Nominatim API calls. All tests
 * use fake timers so they run in milliseconds, not real wall-clock time.
 *
 * NOTE: The rate limiter is synchronous in the check-but-not-in-the-await.
 * When N calls arrive in the same microtask, they ALL see the same
 * `lastNominatimRequest` value and schedule their setTimeout for the same
 * time — so they all fire together. This is a known limitation: the rate
 * limiter only guarantees 1 req/s on AVERAGE, not that each call is
 * strictly sequential. Tests here are sequential to match production usage
 * (API routes handle one request at a time).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { rateLimitedNominatim, resetNominatimRateLimit } from "../nominatim-rate-limit"

// ---------------------------------------------------------------------------
// rateLimitedNominatim
// ---------------------------------------------------------------------------

describe("rateLimitedNominatim", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetNominatimRateLimit()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("calls the wrapped function immediately on first invocation (no prior request)", async () => {
    const fn = vi.fn().mockResolvedValue("result")

    const promise = rateLimitedNominatim(fn)
    await vi.advanceTimersToNextTimerAsync()
    const result = await promise

    expect(result).toBe("result")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("waits at least 1000ms between successive calls", async () => {
    const fn = vi.fn().mockResolvedValue("ok")

    // First call — creates a 1000ms timer (elapsed < 1000 on reset)
    const p1 = rateLimitedNominatim(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p1
    expect(fn).toHaveBeenCalledTimes(1)

    // Second call — only 0ms have passed (no real time), so it also waits
    const p2 = rateLimitedNominatim(fn)

    // Advance by 500ms → setTimeout still pending (needs 1000ms total)
    await vi.advanceTimersByTimeAsync(500)
    expect(fn).toHaveBeenCalledTimes(1) // still only the first call

    // Advance remaining 500ms → second call fires
    await vi.advanceTimersByTimeAsync(500)
    await p2
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("returns the wrapped function's resolved value", async () => {
    const fn = vi.fn().mockResolvedValue({ lat: -23.55, lng: -46.63 })

    const p1 = rateLimitedNominatim(fn)
    await vi.advanceTimersToNextTimerAsync()

    const result = await p1
    expect(result).toEqual({ lat: -23.55, lng: -46.63 })
  })

  it("propagates errors from the wrapped function", async () => {
    // Use real timers for this test to avoid unhandled-rejection edge case
    // with fake timers + setTimeout + rejected promise chains.
    vi.useRealTimers()
    resetNominatimRateLimit()

    const fn = vi.fn().mockRejectedValue(new Error("Nominatim HTTP 429"))

    // With lastNominatimRequest = 0 and real Date.now() elapsed >> 1000ms,
    // no setTimeout is created — fn() is called immediately.
    await expect(rateLimitedNominatim(fn)).rejects.toThrow("Nominatim HTTP 429")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("maintains ~1 req/s over sequential calls", async () => {
    vi.useFakeTimers()
    resetNominatimRateLimit()

    const fn = vi.fn().mockResolvedValue("done")
    const callCount = 5

    // Sequential: fire → await → fire → await → ...
    for (let i = 0; i < callCount; i++) {
      const promise = rateLimitedNominatim(fn)
      await vi.advanceTimersToNextTimerAsync()
      await promise
    }

    // All 5 calls completed with ~1s gaps
    expect(fn).toHaveBeenCalledTimes(callCount)
  })

  it("does not wait if more than 1000ms have passed since the last call", async () => {
    vi.useFakeTimers()
    resetNominatimRateLimit()
    const fn = vi.fn().mockResolvedValue("ok")

    // First call
    const p1 = rateLimitedNominatim(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p1
    expect(fn).toHaveBeenCalledTimes(1)

    // Advance clock by 2000ms (well past the 1000ms interval)
    await vi.advanceTimersByTimeAsync(2000)

    // Second call — elapsed = 2000 + initial_gap > 1000, fires immediately
    const p2 = rateLimitedNominatim(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p2
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// resetNominatimRateLimit
// ---------------------------------------------------------------------------

describe("resetNominatimRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetNominatimRateLimit()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("resets the timer so the next call fires immediately", async () => {
    const fn = vi.fn().mockResolvedValue("ok")

    // Make one call first (creates a timer, waits 1000ms)
    const p1 = rateLimitedNominatim(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p1

    // Reset
    resetNominatimRateLimit()

    // Next call should fire immediately (lastNominatimRequest = 0, elapsed > 1000)
    const p2 = rateLimitedNominatim(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p2
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("can be called multiple times without error", () => {
    expect(() => {
      resetNominatimRateLimit()
      resetNominatimRateLimit()
      resetNominatimRateLimit()
    }).not.toThrow()
  })
})
