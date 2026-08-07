/**
 * Tests for src/lib/viacep-rate-limit.ts
 *
 * The limiter allows up to 60 requests per 60s sliding window (bursts are
 * OK) — different from the strict 1 req/s spacing of the Nominatim limiter.
 * All timing tests use fake timers so they run in milliseconds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { rateLimitedViaCEP, resetViaCEPRateLimit } from "../viacep-rate-limit"

describe("rateLimitedViaCEP", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetViaCEPRateLimit()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("calls the wrapped function immediately on first invocation", async () => {
    const fn = vi.fn().mockResolvedValue("result")

    const promise = rateLimitedViaCEP(fn)
    await vi.advanceTimersToNextTimerAsync()
    const result = await promise

    expect(result).toBe("result")
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("allows a burst of up to 60 requests within the window without waiting", async () => {
    const fn = vi.fn().mockResolvedValue("ok")

    for (let i = 0; i < 60; i++) {
      const promise = rateLimitedViaCEP(fn)
      await vi.advanceTimersToNextTimerAsync()
      await promise
    }

    expect(fn).toHaveBeenCalledTimes(60)
  })

  it("waits for the 61st request until the oldest timestamp leaves the window", async () => {
    const fn = vi.fn().mockResolvedValue("ok")

    // Fill the window with 60 requests (fake timers freeze Date.now()).
    for (let i = 0; i < 60; i++) {
      const promise = rateLimitedViaCEP(fn)
      await vi.advanceTimersToNextTimerAsync()
      await promise
    }
    expect(fn).toHaveBeenCalledTimes(60)

    // 61st request must wait ~60s (oldest timestamp + window - now).
    const promise61 = rateLimitedViaCEP(fn)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(fn).toHaveBeenCalledTimes(60) // still blocked

    await vi.advanceTimersByTimeAsync(1_000)
    await promise61
    expect(fn).toHaveBeenCalledTimes(61)
  })

  it("forgets requests older than the window", async () => {
    const fn = vi.fn().mockResolvedValue("ok")

    const p1 = rateLimitedViaCEP(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p1

    // 60s later the window is empty again → next call fires immediately.
    await vi.advanceTimersByTimeAsync(60_000)
    const p2 = rateLimitedViaCEP(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p2

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("returns the wrapped function's resolved value", async () => {
    const fn = vi.fn().mockResolvedValue({ cep: "01310100", city: "São Paulo" })

    const p1 = rateLimitedViaCEP(fn)
    await vi.advanceTimersToNextTimerAsync()

    const result = await p1
    expect(result).toEqual({ cep: "01310100", city: "São Paulo" })
  })

  it("propagates errors from the wrapped function", async () => {
    // Real timers: with an empty window the call fires immediately.
    vi.useRealTimers()
    resetViaCEPRateLimit()

    const fn = vi.fn().mockRejectedValue(new Error("ViaCEP HTTP 503"))

    await expect(rateLimitedViaCEP(fn)).rejects.toThrow("ViaCEP HTTP 503")
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// resetViaCEPRateLimit
// ---------------------------------------------------------------------------

describe("resetViaCEPRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetViaCEPRateLimit()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("clears the budget so the next call fires immediately", async () => {
    const fn = vi.fn().mockResolvedValue("ok")

    // Fill the window (60 requests).
    for (let i = 0; i < 60; i++) {
      const promise = rateLimitedViaCEP(fn)
      await vi.advanceTimersToNextTimerAsync()
      await promise
    }
    expect(fn).toHaveBeenCalledTimes(60)

    resetViaCEPRateLimit()

    // Next call fires immediately (budget reset).
    const p = rateLimitedViaCEP(fn)
    await vi.advanceTimersToNextTimerAsync()
    await p
    expect(fn).toHaveBeenCalledTimes(61)
  })

  it("can be called multiple times without error", () => {
    expect(() => {
      resetViaCEPRateLimit()
      resetViaCEPRateLimit()
      resetViaCEPRateLimit()
    }).not.toThrow()
  })
})
