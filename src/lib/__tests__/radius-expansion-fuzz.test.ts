/**
 * radius-expansion-fuzz.test.ts
 *
 * Fuzzing test for `buildRadiiToTry` — generates 1000 random values of
 * `userRadiusKm` and verifies the invariants:
 *
 *   1. radii[0] === userRadiusKm  (user radius is always first)
 *   2. radii[i] > radii[i-1]       (monotonically increasing)
 *   3. ∀ r ∈ radii, r === userRadiusKm ∨ r ∈ EXPANSION_STEPS
 *      (every value is either the user radius or a predefined step)
 *   4. No duplicate expansion steps
 *
 * The input space covers:
 *   - Negative values (including very large negatives)
 *   - Zero
 *   - Between expansion steps
 *   - Exactly on each expansion step
 *   - Above the max step (including very large values)
 *   - Fractional / floating point
 *   - JavaScript edge values (Infinity, -Infinity, NaN)
 */

import { describe, it, expect } from "vitest"
import { buildRadiiToTry, EXPANSION_STEPS } from "../radius-expansion"
import { setSeed, fuzzRadiusValue, validateRadii } from "@/lib/__tests__"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of fuzz iterations. */
const FUZZ_ITERATIONS = 1000

// ---------------------------------------------------------------------------
// Fuzz test
// ---------------------------------------------------------------------------

describe("buildRadiiToTry fuzzing", () => {
  it(`maintains invariants across ${FUZZ_ITERATIONS} random inputs`, () => {
    setSeed(42)
    const failures: string[] = []

    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const userRadiusKm = fuzzRadiusValue()
      const radii = buildRadiiToTry(userRadiusKm)
      const result = validateRadii(userRadiusKm, radii)

      if (!result.pass) {
        failures.push(
          `  [${failures.length + 1}] ` +
            `input=${userRadiusKm} output=[${radii.join(",")}] ` +
            `→ ${result.reason}`,
        )
      }
    }

    if (failures.length > 0) {
      throw new Error(
        `buildRadiiToTry failed invariants in ${failures.length}/${FUZZ_ITERATIONS} fuzz cases:\n` +
          failures.join("\n") +
          `\n\n(Re-run with seed=42 for the same sequence.)`,
      )
    }
  })

  // -----------------------------------------------------------------------
  // Edge case: JavaScript numeric edge values
  // -----------------------------------------------------------------------

  it("handles Infinity without crashing", () => {
    const radii = buildRadiiToTry(Infinity)
    expect(radii).toEqual([Infinity])
    // No expansion steps because Infinity > all steps
    expect(radii.length).toBe(1)
  })

  it("handles -Infinity without crashing", () => {
    const radii = buildRadiiToTry(-Infinity)
    // -Infinity should include all EXPANSION_STEPS since all steps > -Infinity
    expect(radii[0]).toBe(-Infinity)
    expect(radii.length).toBe(EXPANSION_STEPS.length + 1)
  })

  it("handles NaN — produces [NaN] (no crash)", () => {
    const radii = buildRadiiToTry(NaN)
    expect(radii).toEqual([NaN])
    // NaN comparisons always return false, so no expansion steps are appended
    expect(radii.length).toBe(1)
  })

  it("handles Number.MIN_VALUE (subnormal) without crashing", () => {
    const radii = buildRadiiToTry(Number.MIN_VALUE) // 5e-324
    // All EXPANSION_STEPS > 5e-324, so all should be included
    expect(radii[0]).toBe(Number.MIN_VALUE)
    expect(radii.slice(1)).toEqual([...EXPANSION_STEPS])
    expect(radii.length).toBe(EXPANSION_STEPS.length + 1)
  })

  // -----------------------------------------------------------------------
  // Determinism: same seed produces same sequence
  // -----------------------------------------------------------------------

  it("is deterministic with the seeded PRNG", () => {
    // Reset seed and run first 10 values twice
    setSeed(42)
    const firstRun: number[] = []
    for (let i = 0; i < 10; i++) {
      firstRun.push(fuzzRadiusValue())
    }

    setSeed(42)
    const secondRun: number[] = []
    for (let i = 0; i < 10; i++) {
      secondRun.push(fuzzRadiusValue())
    }

    expect(firstRun).toEqual(secondRun)
  })
})
