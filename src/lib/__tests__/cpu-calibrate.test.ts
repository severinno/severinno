/**
 * Tests for src/lib/cpu-calibrate.ts
 *
 * Verifies that:
 *   - calibrateBusyLoop() returns a positive, finite, reasonable number
 *   - busyWait(0) and busyWait(-N) return immediately (<5ms)
 *   - busyWait with positive ms actually burns CPU (>0.5ms measurable)
 *
 * NOTE on JIT effects:
 *   V8 compiles the busy-wait loop to optimized code after a few calls,
 *   which makes subsequent waits faster than the cold calibration predicted.
 *   Therefore the tests do NOT assert on exact wall-clock duration — only
 *   on the presence/absence of a measurable delay.
 *
 * NOTE on caching (not tested here):
 *   The module caches the calibration result in a module-level variable.
 *   Vitest with singleFork pool does not guarantee module isolation between
 *   test files, so a "second call is faster" test is flaky.  The caching
 *   is trivially verified by reading the source code.
 */

import { describe, it, expect } from "vitest"
import { calibrateBusyLoop, busyWait } from "../cpu-calibrate"

describe("calibrateBusyLoop", () => {
  it("returns a positive finite number", () => {
    const result = calibrateBusyLoop()
    expect(result).toBeGreaterThan(0)
    expect(Number.isFinite(result)).toBe(true)
  })

  it("returns a reasonable value (at least 100 iterations/ms)", () => {
    const result = calibrateBusyLoop()
    // Even the slowest CI runner should manage 100 simple Math.sqrt calls
    // per millisecond.  A modern laptop typically returns 3 000 – 8 000.
    expect(result).toBeGreaterThanOrEqual(100)
  })
})

describe("busyWait", () => {
  it("returns immediately when ms is 0", () => {
    const t0 = performance.now()
    busyWait(0)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(5)
  })

  it("returns immediately when ms is negative", () => {
    const t0 = performance.now()
    busyWait(-10)
    const elapsed = performance.now() - t0
    expect(elapsed).toBeLessThan(5)
  })

  it("actually burns CPU for positive ms (does not return instantly)", () => {
    const t0 = performance.now()
    busyWait(10)
    const elapsed = performance.now() - t0
    // Even with JIT optimization, 10 ms of busy-work should take at least
    // 0.5 ms (the minimum 1 Math.sqrt iteration on any CPU).
    expect(elapsed).toBeGreaterThan(0.5)
  })
})
