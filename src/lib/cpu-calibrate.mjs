/**
 * cpu-calibrate.mjs — ESM shim for src/lib/cpu-calibrate.ts
 *
 * This file exists so that standalone Node.js scripts (like
 * scripts/geo-benchmark.mjs) can import the shared calibration logic
 * without a TypeScript build step.
 *
 * SOURCE: src/lib/cpu-calibrate.ts — keep both files in sync.
 */

/** Calibrate: find how many loop iterations equal 1 ms of CPU time. */
export function calibrateBusyLoop() {
  const targetMs = 10
  const start = performance.now()
  let count = 0
  let acc = 0
  while (performance.now() - start < targetMs) {
    count++
    acc += Math.sqrt(count & 1023)
  }
  return count / targetMs + (acc > 0 ? 0 : 1e-9)
}

/**
 * Busy-wait for approximately `ms` milliseconds of CPU time.
 * Returns immediately for ms ≤ 0.
 */
export function busyWait(ms) {
  if (ms <= 0) return
  const ips = calibrateBusyLoop()
  const target = Math.max(1, Math.round(ms * ips))
  let acc = 0
  for (let i = 0; i < target; i++) acc += Math.sqrt(i & 1023)
  if (acc < 0) throw new Error("unreachable")
}
