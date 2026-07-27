/**
 * cpu-calibrate.ts
 *
 * Shared CPU busy-loop calibration for benchmarks and performance tests.
 *
 * ESM shim at cpu-calibrate.mjs — keep both files in sync.
 *
 * Instead of calling `setTimeout` (which measures wall-clock time, not CPU
 * time, and breaks vitest bench's sync timer), this module burns CPU cycles
 * proportional to a target latency using a calibrated busy-loop.
 *
 * The calibration runs once at module load and adapts to the current CPU
 * speed and V8 JIT tier, making the simulated delay portable across
 * different machines and CI runners.
 *
 * Usage (PostGIS simulation):
 * ```ts
 * import { calibrate, busyWait } from "@/lib/cpu-calibrate"
 *
 * // Simulate a DB query that takes ~2 ms + 0.022 ms per row
 * function simulatedQuery(rowCount: number) {
 *   busyWait(2 + 0.022 * rowCount)
 * }
 * ```
 */

/** Result of calibrateBusyLoop — iterations of busy-work per ms. */
let itersPerMs = 0
let calibrated = false

/**
 * Run the calibration and return iterations-per-millisecond for the
 * current CPU / V8 tier.
 *
 * The calibration loop runs for ~10 ms of wall-clock time, counting how
 * many iterations of `Math.sqrt` it can execute.  The result is cached
 * after the first call.
 *
 * The accumulator (`acc`) prevents V8 from dead-code-eliminating the
 * loop body across the `performance.now()` boundary.
 */
export function calibrateBusyLoop(): number {
  if (calibrated) return itersPerMs

  const targetMs = 10
  const start = performance.now()
  let count = 0
  let acc = 0
  while (performance.now() - start < targetMs) {
    count++
    acc += Math.sqrt(count & 1023)
  }
  // Guard prevents DCE; acc is always > 0 so the term is always 0
  itersPerMs = count / targetMs + (acc > 0 ? 0 : 1e-9)
  calibrated = true
  return itersPerMs
}

/**
 * Busy-wait for approximately `ms` milliseconds of CPU time.
 *
 * Uses the cached calibration value.  The minimum wait is 1 iteration
 * (even for `ms` very close to 0).
 *
 * @throws Never — the `if (acc < 0)` guard is unreachable but prevents
 *   V8 from eliding the loop body.
 */
export function busyWait(ms: number): void {
  // Short-circuit zero/negative wait requests
  if (ms <= 0) return

  // Ensure calibration has run (idempotent if already called)
  const ips = calibrateBusyLoop()
  const target = Math.max(1, Math.round(ms * ips))
  let acc = 0
  for (let i = 0; i < target; i++) acc += Math.sqrt(i & 1023)
  // Prevent dead-code elimination of the loop
  if (acc < 0) throw new Error("unreachable")
}
