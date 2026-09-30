/**
 * geo-performance-regression.test.ts
 *
 * Performance regression test for the Haversine distance calculation.
 * Fails if `haversineKm` becomes pathologically slower (≥6× the
 * measured baseline of ~0.05 µs/provider on Node 22, win32 x64).
 *
 * The 0.3 µs/provider threshold is 6× the baseline — safely above the
 * ±40 % run-to-run variance on shared CI runners and the CPU contention
 * of parallel vitest forks on Windows.  With `retry: 2` the test will
 * re-run up to 3 times before failing, which eliminates flakiness from
 * occasional CPU throttling or V8 GC pauses.
 *
 * If the Haversine function is intentionally made slower (e.g. higher
 * precision), update the threshold accordingly.
 */

import { existsSync } from "node:fs"
import { describe, it, expect } from "vitest"
import { haversineKm } from "../geo-shared"
import { busyWait } from "../cpu-calibrate"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Center point (São Paulo) for all test data. */
const CENTER_LAT = -23.5505
const CENTER_LNG = -46.6333

/**
 * Maximum allowed time per haversineKm call, in microseconds.
 *
 * Baseline: ~0.05 µs/provider (10K run, Node 22, win32 x64).
 * Threshold: 6× baseline = 0.3 µs/provider (parallel-fork safe on Windows).
 * Retry: 2 (runs up to 3× before failing) to absorb CPU throttling.
 *
 * O TETO é por AMBIENTE: dentro do container do job da forja, a contenção da
 * suíte INTEIRA em paralelo sobre 4 vCPU passa do teto de máquina dedicada —
 * medido na rodada 28ffaf84: 0.31/0.53/0.39 µs com 4 efêmeros bootando junto
 * (as 3 tentativas do retry, todas acima de 0.3). 1.0 (20× a baseline) mantém
 * o propósito do teste — pegar a desaceleração PATOLÓGICA, não o ruído do
 * ambiente — com folga sobre o pior caso medido.
 */
const EM_CONTAINER_JOB = existsSync("/.dockerenv") || existsSync("/run/.containerenv")
const THRESHOLD_US_PER_PROVIDER = EM_CONTAINER_JOB ? 1.0 : 0.3

/** Number of random providers to generate for the benchmark. */
const NUM_PROVIDERS = 5000

/** Timed iterations after warmup. */
const ITERATIONS = 5

/** Warmup iterations (not measured). */
const WARMUP = 3

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateProviders(count: number, spreadKm = 50): Array<{ lat: number; lng: number }> {
  const degPerKm = { lat: 1 / 111, lng: 1 / 102 }
  const out: Array<{ lat: number; lng: number }> = []
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * 2 * Math.PI
    const dist = Math.random() * spreadKm
    out.push({
      lat: CENTER_LAT + Math.cos(angle) * dist * degPerKm.lat,
      lng: CENTER_LNG + Math.sin(angle) * dist * degPerKm.lng,
    })
  }
  return out
}

/**
 * Run haversineKm for all providers and accumulate.
 * Returns the sum so V8 cannot dead-code-eliminate the loop.
 */
function haversineAll(
  centerLat: number,
  centerLng: number,
  providers: Array<{ lat: number; lng: number }>,
): number {
  let sum = 0
  for (const p of providers) {
    sum += haversineKm(centerLat, centerLng, p.lat, p.lng)
  }
  return sum
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("Haversine performance regression", () => {
  it(`completes ${NUM_PROVIDERS} Haversine calculations within threshold`, { retry: 2 }, () => {
    const providers = generateProviders(NUM_PROVIDERS)

    // ── Warmup ───────────────────────────────────────────────────────
    // Exercising the shared cpu-calibrate module (real consumer + warmup)
    busyWait(1)
    for (let i = 0; i < WARMUP; i++) {
      haversineAll(CENTER_LAT, CENTER_LNG, providers)
    }

    // ── Measure ──────────────────────────────────────────────────────
    const samples: number[] = []
    let grandTotal = 0 // accumulated to prevent DCE of haversineAll

    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now()
      grandTotal += haversineAll(CENTER_LAT, CENTER_LNG, providers)
      const t1 = performance.now()
      samples.push((t1 - t0) * 1000) // µs
    }

    // Consume grandTotal outside the timed block (prevents DCE, no timer noise)
    expect(grandTotal).toBeGreaterThan(0)

    const mean = samples.reduce((s, v) => s + v, 0) / samples.length
    const perProvider = mean / NUM_PROVIDERS

    // ── Assert ───────────────────────────────────────────────────────
    expect(perProvider).toBeLessThan(THRESHOLD_US_PER_PROVIDER)
  })
})
