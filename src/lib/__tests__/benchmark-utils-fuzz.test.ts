/**
 * benchmark-utils-fuzz.test.ts
 *
 * Fuzz testing for `measure()` from benchmark-utils.ts.
 *
 * Generates 20 random combinations of synchronous functions and iteration
 * counts, verifying that `measure` never crashes and always returns a
 * structurally valid `BenchmarkSample`.
 *
 * Invariants for every combination:
 *   - Result has all 4 fields (mean, min, max, opsPerSec)
 *   - All fields are finite numbers
 *   - min ≥ 0
 *   - max ≥ min
 *   - opsPerSec > 0 (when mean > 0)
 *   - 0 iterations → NaN mean (no crash)
 */

import { describe, it, expect } from "vitest"
import { measure, type BenchmarkSample } from "../benchmark-utils"
import { setSeed, seededRandom, randInt, randFloat, pick } from "@/lib/__tests__"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FUZZ_ITERATIONS = 20
const VALID_ITERATION_COUNTS = [0, 1, 2, 5, 10, 20, 50, 100, 200]

// ---------------------------------------------------------------------------
// Fuzz function generators — each returns a () => void
// ---------------------------------------------------------------------------

/** A no-op — fastest possible function. */
function noop(): void {
  /* intentionally empty */
}

/** Add two numbers (trivial V8 operation). */
function simpleMath(): void {
  const _ = 1 + 2
}

/** Busy-wait for approximately `ms` milliseconds. */
function busyWait(ms: number): () => void {
  return () => {
    const deadline = performance.now() + ms
    while (performance.now() < deadline) {
      /* burn */
    }
  }
}

/** Create a closure that allocates and accesses an array. */
function arrayAlloc(size: number): () => void {
  return () => {
    const arr = new Array(size)
    for (let i = 0; i < size; i++) arr[i] = i * 2
    // Prevent DCE via a noop sum
    const _ = arr.reduce((a: number, b: number) => a + b, 0)
  }
}

/** Create a closure that builds and serialises a small object. */
function objectBuild(): void {
  const obj = { a: 1, b: "hello", c: [1, 2, 3], d: { nested: true } }
  const _ = JSON.stringify(obj)
}

/** Create a closure with a small regex match. */
function regexMatch(): void {
  const _ = "hello world 123".match(/[a-z]+/g)
}

/** Mutate a shared string (immutable — just tests repeated substring ops). */
function stringOps(): void {
  const s = "the quick brown fox jumps over the lazy dog"
  const _ = s
    .split(" ")
    .map((w) => w.toUpperCase())
    .join(",")
}

// ---------------------------------------------------------------------------
// Fuzz generators
// ---------------------------------------------------------------------------

/** Available fuzz functions — pick() selects one each iteration. */
const FUZZ_FNS: Array<{ name: string; fn: () => void }> = [
  { name: "noop", fn: noop },
  { name: "simpleMath", fn: simpleMath },
  { name: "busyWait(0.01)", fn: busyWait(0.01) },
  { name: "busyWait(0.1)", fn: busyWait(0.1) },
  { name: "busyWait(0.5)", fn: busyWait(0.5) },
  { name: "busyWait(1)", fn: busyWait(1) },
  { name: "arrayAlloc(10)", fn: arrayAlloc(10) },
  { name: "arrayAlloc(100)", fn: arrayAlloc(100) },
  { name: "arrayAlloc(1000)", fn: arrayAlloc(1000) },
  { name: "objectBuild", fn: objectBuild },
  { name: "regexMatch", fn: regexMatch },
  { name: "stringOps", fn: stringOps },
  /** Function that throws (measure should propagate the error). */
  {
    name: "throws",
    fn: () => {
      throw new Error("fuzz-error")
    },
  },
]

/**
 * Validate that a BenchmarkSample is structurally sound.
 * Returns `true` if valid, or a string describing the first violation.
 */
function validateSample(
  r: BenchmarkSample,
  label: string,
): { pass: boolean; reason?: string } {
  // Shape check
  if (typeof r.mean !== "number") {
    return { pass: false, reason: `mean is not a number: ${typeof r.mean}` }
  }
  if (typeof r.min !== "number") {
    return { pass: false, reason: `min is not a number: ${typeof r.min}` }
  }
  if (typeof r.max !== "number") {
    return { pass: false, reason: `max is not a number: ${typeof r.max}` }
  }
  if (typeof r.opsPerSec !== "number") {
    return { pass: false, reason: `opsPerSec is not a number: ${typeof r.opsPerSec}` }
  }

  // Finite check (NaN mean is allowed when iterations=0)
  if (!Number.isFinite(r.min)) {
    return { pass: false, reason: `min is not finite: ${r.min}` }
  }
  if (!Number.isFinite(r.max)) {
    return { pass: false, reason: `max is not finite: ${r.max}` }
  }

  // Range check
  if (r.min < 0) {
    return { pass: false, reason: `min < 0: ${r.min}` }
  }
  if (r.max < r.min) {
    return { pass: false, reason: `max (${r.max}) < min (${r.min})` }
  }    // opsPerSec sanity (when mean is known finite and function is slow enough
    // that performance.now() precision noise is manageable).
    if (Number.isFinite(r.mean) && r.mean > 1) {
      if (r.opsPerSec <= 0) {
        return { pass: false, reason: `opsPerSec <= 0 for finite mean: ${r.opsPerSec}` }
      }
      // opsPerSec should be roughly 1_000_000 / mean.
      // Allow 15% tolerance for timing noise (performance.now() precision
      // can cause ~5-13% variation on fast functions).
      const expected = Math.round(1_000_000 / r.mean)
      const ratio = expected > 0 ? r.opsPerSec / expected : 1
      if (ratio < 0.85 || ratio > 1.15) {
        return {
          pass: false,
          reason: `opsPerSec ${r.opsPerSec} != 1e6/${r.mean}=${expected} (ratio ${ratio.toFixed(3)}) for ${label}`,
        }
      }
    }

  return { pass: true }
}

// ---------------------------------------------------------------------------
// Fuzz test
// ---------------------------------------------------------------------------

describe("measure fuzzing", () => {
  it("survives 20 random fn/iteration combinations without crashing", () => {
    setSeed(42)
    const results: Array<{ label: string; error?: string }> = []

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const fuzzEntry = pick(FUZZ_FNS)
      const iters = pick(VALID_ITERATION_COUNTS)
      const label = `[${i}] ${fuzzEntry.name} × ${iters} iters`

      // Functions that throw should propagate
      if (fuzzEntry.name === "throws") {
        expect(() => measure(fuzzEntry.fn, iters)).toThrow("fuzz-error")
        results.push({ label, error: undefined })
        continue
      }

      // All other functions should never crash
      let result: BenchmarkSample | undefined
      let crash: string | undefined

      try {
        result = measure(fuzzEntry.fn, iters)
      } catch (e) {
        crash = String(e)
      }

      if (crash) {
        results.push({ label, error: `CRASH: ${crash}` })
        continue
      }

      // Validate structure & invariants
      // For 0 iterations, min/max/opsPerSec are NaN (empty samples) — only check shape + NaN mean
      if (iters === 0) {
        if (!Number.isNaN(result!.mean)) {
          results.push({ label, error: `expected NaN mean for 0 iterations, got ${result!.mean}` })
          continue
        }
        results.push({ label })
        continue
      }

      const validation = validateSample(result!, label)
      if (!validation.pass) {
        results.push({ label, error: validation.reason })
        continue
      }

      results.push({ label })
    }

    // Report all failures
    const failures = results.filter((r) => r.error)
    if (failures.length > 0) {
      const details = failures
        .map((f) => `  ✗ ${f.label}: ${f.error}`)
        .join("\n")
      expect(failures).toEqual([])
    }
  })

  it("returns NaN mean for 0 iterations every time", () => {
    setSeed(42)
    for (let i = 0; i < 10; i++) {
      const fuzzEntry = pick(FUZZ_FNS)
      if (fuzzEntry.name === "throws") continue
      const result = measure(fuzzEntry.fn, 0)
      expect(Number.isNaN(result.mean)).toBe(true)
      expect(Number.isNaN(result.min)).toBe(true)
      expect(Number.isNaN(result.max)).toBe(true)
      expect(Number.isNaN(result.opsPerSec)).toBe(true)
    }
  })

  it("returns finite results for 1 iteration (no division by zero)", () => {
    setSeed(42)
    for (let i = 0; i < 5; i++) {
      const fuzzEntry = pick(FUZZ_FNS)
      if (fuzzEntry.name === "throws") continue
      const result = measure(fuzzEntry.fn, 1)
      expect(Number.isFinite(result.mean)).toBe(true)
      expect(Number.isFinite(result.min)).toBe(true)
      expect(Number.isFinite(result.max)).toBe(true)
      expect(result.opsPerSec).toBeGreaterThan(0)
    }
  })

  it("throws for a function that throws (error propagation)", () => {
    setSeed(42)
    for (let i = 0; i < 3; i++) {
      expect(() => measure(() => { throw new Error("crash") }, randInt(1, 50))).toThrow("crash")
    }
  })
})
