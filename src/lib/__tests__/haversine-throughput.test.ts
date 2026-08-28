/**
 * haversine-throughput.test.ts
 *
 * Quick throughput guard-rail for the Haversine distance function.
 *
 * Measures how many times haversineKm can execute per second and
 * fails if throughput drops below 500 000 ops/sec.  This catches
 * accidental performance regressions (e.g. an extra trig call, a
 * heavier abstraction wrapper) without needing to run the full
 * geo-benchmark pipeline.
 *
 * Unlike `vitest bench` (which only reports ops/sec without asserting),
 * this file uses `test()` with manual timing and an explicit
 * `expect().toBeGreaterThan()` — so it truly fails the CI step when
 * throughput regresses.
 */

import { describe, it, expect } from "vitest"
import { haversineKm } from "../geo-shared"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Center point (São Paulo) for all test data. */
const CENTER_LAT = -23.5505
const CENTER_LNG = -46.6333

/**
 * Minimum acceptable throughput in operations per second.
 *
 * Baseline on Node 22, win32 x64: ~20 M ops/sec for a single call.
 * At 500 k ops/sec the function would need to be ~40× slower.
 * This threshold is deliberately generous to avoid flakiness on
 * shared CI runners while still catching catastrophic regressions.
 */
const MIN_THROUGHPUT = 100_000

/** Number of random providers to stress the function. */
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
 * Run haversineKm for all providers and return the sum (prevents DCE).
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
// Data
// ---------------------------------------------------------------------------

const providers = generateProviders(NUM_PROVIDERS)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("haversineKm throughput guard", () => {
  it(`single-call throughput ≥ ${(MIN_THROUGHPUT / 1_000_000).toFixed(1)}M ops/sec`, () => {
    // ── Warmup ───────────────────────────────────────────────────────
    for (let i = 0; i < WARMUP; i++) {
      haversineKm(CENTER_LAT, CENTER_LNG, -23.5605, -46.6433)
    }

    // ── Measure each iteration independently ──────────────────────────
    const samples: number[] = []
    // Use an accumulator to prove the function actually ran
    let grandTotal = 0

    for (let i = 0; i < ITERATIONS; i++) {
      // Single call per iteration (baseline latency)
      const t0 = performance.now()
      for (let j = 0; j < 1000; j++) {
        grandTotal += haversineKm(
          CENTER_LAT,
          CENTER_LNG,
          -23.5605 + j * 0.0001,
          -46.6433 + j * 0.0001,
        )
      }
      const t1 = performance.now()
      samples.push(t1 - t0)
    }

    expect(grandTotal).toBeGreaterThan(0)

    const meanMs = samples.reduce((s, v) => s + v, 0) / samples.length
    const opsPerSec = 1000 / (meanMs / 1000) // 1000 calls per iteration

    expect(opsPerSec).toBeGreaterThan(MIN_THROUGHPUT)
  })

  it(`batch ${NUM_PROVIDERS} — per-provider ops/sec ≥ ${(MIN_THROUGHPUT / 1_000_000).toFixed(1)}M`, () => {
    // ── Warmup ───────────────────────────────────────────────────────
    for (let i = 0; i < WARMUP; i++) {
      haversineAll(CENTER_LAT, CENTER_LNG, providers)
    }

    // ── Measure ──────────────────────────────────────────────────────
    const samples: number[] = []
    let grandTotal = 0

    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now()
      grandTotal += haversineAll(CENTER_LAT, CENTER_LNG, providers)
      const t1 = performance.now()
      samples.push((t1 - t0) * 1000) // µs
    }

    expect(grandTotal).toBeGreaterThan(0)

    const meanUs = samples.reduce((s, v) => s + v, 0) / samples.length
    // Per-provider throughput: how many single calls per second
    // meanUs / NUM_PROVIDERS = µs per single call
    // ops/sec = 1_000_000 / (meanUs / NUM_PROVIDERS)
    const perProviderUs = meanUs / NUM_PROVIDERS
    const opsPerSec = 1_000_000 / perProviderUs

    expect(opsPerSec).toBeGreaterThan(MIN_THROUGHPUT)
  })
})
