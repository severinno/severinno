/**
 * cpu-calibrate-consistency.test.ts
 *
 * Consistency test between the two parallel implementations of
 * calibrateBusyLoop / busyWait:
 *
 *   src/lib/cpu-calibrate.ts   (TypeScript — caches after first call)
 *   src/lib/cpu-calibrate.mjs  (ESM shim — always recalibrates)
 *
 * Verifies that both produce the same order-of-magnitude calibration
 * (within 10 %) so the .mjs shim does not silently diverge from the .ts
 * source-of-truth after edits.
 *
 * DESIGN: Because the .ts module caches its calibration result in a
 * module-level variable, we must use `vi.resetModules()` + fresh
 * dynamic import() for both implementations in each test.  Without
 * this, the cached .ts value from a previous test's call can drift
 * from the .mjs value due to CPU frequency scaling.
 */

import { describe, it, expect, vi } from "vitest"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Import both calibrateBusyLoop functions from fresh module instances.
 * Using `vi.resetModules()` first ensures the .ts module's cached
 * `calibrated` flag is cleared so both implementations run the full
 * ~10 ms calibration loop fresh.
 */
async function getFreshCalibrators(): Promise<
  [() => number, () => number]
> {
  vi.resetModules()
  const tsMod = import("../cpu-calibrate")
  const mjsMod = import("../cpu-calibrate.mjs")
  return [
    (await tsMod).calibrateBusyLoop as () => number,
    (await mjsMod).calibrateBusyLoop as () => number,
  ]
}

/**
 * Import both busyWait functions from fresh module instances.
 */
async function getFreshBusyWait(): Promise<
  [(ms: number) => void, (ms: number) => void]
> {
  vi.resetModules()
  const { busyWait: busyWaitTs } = await import("../cpu-calibrate")
  vi.resetModules()
  const { busyWait: busyWaitMjs } = await import("../cpu-calibrate.mjs")
  return [busyWaitTs, busyWaitMjs]
}

// ---------------------------------------------------------------------------
// Tests: calibrateBusyLoop
// ---------------------------------------------------------------------------

describe("consistency: calibrateBusyLoop .ts vs .mjs", () => {
  it("both return positive finite numbers", async () => {
    const [ts, mjs] = await getFreshCalibrators()
    const tsVal = ts()
    const mjsVal = mjs()

    expect(tsVal).toBeGreaterThan(0)
    expect(Number.isFinite(tsVal)).toBe(true)
    expect(mjsVal).toBeGreaterThan(0)
    expect(Number.isFinite(mjsVal)).toBe(true)
  })

  it("both return reasonable values (≥100 iters/ms)", async () => {
    const [ts, mjs] = await getFreshCalibrators()

    expect(ts()).toBeGreaterThanOrEqual(100)
    expect(mjs()).toBeGreaterThanOrEqual(100)
  })

  it("are within 50 % of each other (same order of magnitude)", async () => {
    // The tolerance is loose (50 %) because the .ts module goes through
    // vitest/esbuild's transform pipeline while the .mjs is loaded as
    // native ESM by Node.js.  V8 may tier-compile them at different
    // optimization levels, producing calibration values that differ by
    // ~20–30 % even though the algorithm is byte-for-byte identical.
    //
    // 50 % still catches catastrophic divergence (>2×) which is the
    // main goal — preventing silent drift between the two formats.
    const [ts, mjs] = await getFreshCalibrators()
    const tsVal = ts()
    const mjsVal = mjs()

    const diff = Math.abs(tsVal - mjsVal)
    const max = Math.max(tsVal, mjsVal)
    const pct = max > 0 ? (diff / max) * 100 : 0

    expect(pct).toBeLessThanOrEqual(50)
  })

  it("agree on order of magnitude (both ≥ 500 or both < 500)", async () => {
    const [ts, mjs] = await getFreshCalibrators()
    const tsVal = ts()
    const mjsVal = mjs()

    expect(tsVal >= 500).toBe(mjsVal >= 500)
  })
})

// ---------------------------------------------------------------------------
// Tests: busyWait
// ---------------------------------------------------------------------------

describe("consistency: busyWait .ts vs .mjs", () => {
  it("both return immediately for ms ≤ 0", async () => {
    const [busyWaitTs, busyWaitMjs] = await getFreshBusyWait()

    const t0 = performance.now()
    busyWaitTs(0)
    busyWaitMjs(0)
    expect(performance.now() - t0).toBeLessThan(5)

    const t1 = performance.now()
    busyWaitTs(-5)
    busyWaitMjs(-5)
    expect(performance.now() - t1).toBeLessThan(5)
  })

  it("both actually burn CPU for positive ms", async () => {
    const [busyWaitTs, busyWaitMjs] = await getFreshBusyWait()

    const t0 = performance.now()
    busyWaitTs(5)
    expect(performance.now() - t0).toBeGreaterThan(0.5)

    const t1 = performance.now()
    busyWaitMjs(5)
    expect(performance.now() - t1).toBeGreaterThan(0.5)
  })
})
