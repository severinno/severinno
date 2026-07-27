/**
 * benchmark-utils.ts
 *
 * Shared benchmarking utilities for performance tests and standalone
 * benchmark scripts.
 *
 * ESM shim at benchmark-utils.mjs — keep both files in sync.
 *
 * Usage:
 * ```ts
 * import { measure } from "@/lib/benchmark-utils"
 *
 * const { mean, min, max, opsPerSec } = measure(
 *   () => myExpensiveFunction(data),
 *   100,   // iterations
 * )
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A synthetic provider point (lat/lng). */
export interface SyntheticProvider {
  lat: number
  lng: number
}

/** Result of a single benchmark run. */
export interface BenchmarkSample {
  /** Mean wall-clock time per iteration, in µs. */
  mean: number
  /** Minimum single-iteration time, in µs. */
  min: number
  /** Maximum single-iteration time, in µs. */
  max: number
  /** Throughput: operations per second (1 000 000 / mean). */
  opsPerSec: number
}

// ---------------------------------------------------------------------------
// measure — sample a function across multiple iterations
// ---------------------------------------------------------------------------

/**
 * Measure the average wall-clock time of `fn()` across `iterations` calls.
 *
 *  1. Runs 3 warmup iterations (excluded from samples).
 *  2. Runs `iterations` measured iterations.
 *  3. Returns `{ mean, min, max, opsPerSec }` in **microseconds**.
 *
 * The warmup phase is excluded from results so V8 JIT compilation
 * and module-loading overhead do not distort the measurements.
 *
 * @param fn         — The synchronous function to benchmark.
 * @param iterations — Number of measured iterations (default 100).
 */
// ---------------------------------------------------------------------------
// generateProviders — synthetic data factory
// ---------------------------------------------------------------------------

/**
 * Generate `count` synthetic provider points uniformly distributed
 * within `spreadKm` km of `center`.
 *
 * Used by standalone benchmarks and performance tests so they share
 * a single source of truth for synthetic geodata.
 *
 * The function uses `Math.random()` (unseeded) since benchmark data
 * does not need reproducibility — only consistent distribution.
 *
 * @param count    — Number of points to generate.
 * @param spreadKm — Radius of the uniform circle (default 50 km).
 * @param center   — Center point (default São Paulo).
 */
export function generateProviders(
  count: number,
  spreadKm: number = 50,
  center: { lat: number; lng: number } = { lat: -23.5505, lng: -46.6333 },
): SyntheticProvider[] {
  const degPerKm = { lat: 1 / 111, lng: 1 / 102 }
  const out: SyntheticProvider[] = []
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI
    const dist = Math.random() * spreadKm
    out.push({
      lat: center.lat + Math.cos(angle) * dist * degPerKm.lat,
      lng: center.lng + Math.sin(angle) * dist * degPerKm.lng,
    })
  }
  return out
}

export function measure(fn: () => void, iterations: number = 100): BenchmarkSample {
  const samples: number[] = []

  // Warmup (excluded from results)
  for (let i = 0; i < 3; i++) fn()

  // Measured iterations
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    fn()
    const t1 = performance.now()
    samples.push((t1 - t0) * 1000) // µs
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length

  return {
    mean: Math.round(mean * 10) / 10,
    min: Math.round(sorted[0] * 10) / 10,
    max: Math.round(sorted[sorted.length - 1] * 10) / 10,
    opsPerSec: Math.round(1_000_000 / mean),
  }
}
