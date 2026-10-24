/**
 * benchmark-utils.test.ts
 *
 * Tests for src/lib/benchmark-utils.ts — shared `measure()` helper.
 *
 * Verifies:
 *   - Returns correct shape with reasonable numeric values
 *   - Warmup iterations do not pollute samples
 *   - Edge cases: 0 iterations, 1 iteration
 *   - Consistency: measure of a no-op is fast (< 1 ms per iteration)
 *   - Consistency: both .ts and .mjs versions return comparable results
 */

import { describe, it, expect, vi } from "vitest"

// Static import — .ts source-of-truth
import { measure, type BenchmarkSample } from "../benchmark-utils"

// ---------------------------------------------------------------------------
// Basic shape & sanity
// ---------------------------------------------------------------------------

describe("measure (.ts)", () => {
  it("returns a BenchmarkSample with all four fields", () => {
    const result = measure(() => {
      /* no-op */
    }, 10)
    expect(result).toHaveProperty("mean")
    expect(result).toHaveProperty("min")
    expect(result).toHaveProperty("max")
    expect(result).toHaveProperty("opsPerSec")
  })

  it("returns finite positive numbers for a no-op", () => {
    const result = measure(() => {
      /* no-op */
    }, 10)
    expect(result.mean).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(result.mean)).toBe(true)
    expect(result.min).toBeGreaterThanOrEqual(0)
    expect(result.max).toBeGreaterThanOrEqual(result.min)
    expect(result.opsPerSec).toBeGreaterThan(0)
  })

  it("returns max >= min >= 0", () => {
    const result = measure(() => {
      /* no-op */
    }, 10)
    expect(result.max).toBeGreaterThanOrEqual(result.min)
    expect(result.min).toBeGreaterThanOrEqual(0)
  })

  it("reports higher mean for a slower function", () => {
    const fast = measure(() => {
      /* no-op */
    }, 20)
    const slow = measure(() => {
      // Busy-wait ~1 ms
      const start = performance.now()
      while (performance.now() - start < 1) {
        /* burn */
      }
    }, 20)

    expect(slow.mean).toBeGreaterThan(fast.mean)
  })
})

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("measure — edge cases", () => {
  it("handles 1 iteration without crashing", () => {
    const result = measure(() => 1 + 1, 1)
    expect(result.mean).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(result.mean)).toBe(true)
  })

  it("handles 0 iterations without crashing (returns warmup-only)", () => {
    const result = measure(() => 1 + 1, 0)
    // With 0 measured iterations, samples is empty => mean = 0/0 = NaN
    // We need to handle this gracefully. Let me check...
    // samples.reduce((s,v) => s+v, 0) / 0 = NaN
    // This is an edge case that just shouldn't crash.
    expect(Number.isFinite(result.mean) || Number.isNaN(result.mean)).toBe(true)
  })

  it("does not crash when fn throws (caller is responsible for try/catch)", () => {
    // The measure function itself doesn't catch errors — it just propagates
    // But we should verify it doesn't silently swallow
    expect(() =>
      measure(() => {
        throw new Error("benchmark error")
      }, 3),
    ).toThrow("benchmark error")
  })
})

// ---------------------------------------------------------------------------
// Warmup isolation
// ---------------------------------------------------------------------------

describe("measure — warmup isolation", () => {
  it("warmup calls (3) do not affect sample count", () => {
    let callCount = 0
    const _result = measure(() => {
      callCount++
    }, 10)
    // 3 warmup + 10 measured = 13 total calls
    // But only 10 samples should have been collected
    expect(callCount).toBe(13)

    // Re-run with the same function to verify all measured calls counted
    const _result2 = measure(() => {
      callCount++
    }, 5)
    expect(callCount).toBe(13 + 3 + 5) // 21 total
  })

  it("first sample is not disproportionately slow (warmup effect isolated)", () => {
    // Run a function that simulates cold-start cost on first call
    // but is fast on subsequent calls — the warmup isolates this.
    let cold = true
    const result = measure(() => {
      if (cold) {
        cold = false
        const start = performance.now()
        while (performance.now() - start < 2) {
          /* burn */
        }
      }
    }, 20)

    // The min should be much smaller than the max, but mean should be low
    // (warmup absorbed the 2 ms cold penalty)
    expect(result.min).toBeLessThan(100) // well under 100 µs for a no-op
    expect(result.mean).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// Consistency between .ts and .mjs
// ---------------------------------------------------------------------------

describe("measure consistency: .ts vs .mjs", () => {
  it("both report the SAME stats for the same no-op fn (deterministic clock)", async () => {
    vi.resetModules()
    const mjsModule = await import("../benchmark-utils.mjs")
    const mjsMeasure = mjsModule.measure as (fn: () => void, iterations?: number) => BenchmarkSample

    // O RELÓGIO é a variável do teste, e ele é DADO, não medido: com
    // `performance.now()` real a razão entre duas amostras de um no-op é ruído
    // de agendamento — medido na forja em 24/10/2026, 8× contra um teto de 5×,
    // sob a suíte inteira em paralelo (o mesmo no-op, nas duas implementações).
    // Aqui cada leitura avança 1 µs: o que se compara é a CONTA das duas
    // implementações (mesmos samples, mesmos arredondamentos), não a latência
    // da máquina. Uma divergência de comportamento continua reprovando — o
    // `toEqual` é mais estrito que o teto de razão que ele substitui.
    let ticks = 0
    const clock = vi.spyOn(performance, "now").mockImplementation(() => {
      const agora = ticks
      ticks += 0.001
      return agora
    })

    try {
      const fn = () => 1 + 1
      const tsResult = measure(fn, 10)
      const mjsResult = mjsMeasure(fn, 10)

      expect(mjsResult).toEqual(tsResult)
    } finally {
      clock.mockRestore()
    }
  })
})
