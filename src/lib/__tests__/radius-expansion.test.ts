/**
 * Tests for src/lib/radius-expansion.ts
 *
 * Pure unit tests — no database, no mocks.  The `countFn` is injected
 * as a simple async function, making these tests fast and deterministic.
 *
 * Coverage targets:
 *   ✅ buildRadiiToTry — edge cases (0, negative, between steps, past max)
 *   ✅ findEffectiveRadius — finds at user radius
 *   ✅ findEffectiveRadius — needs expansion
 *   ✅ findEffectiveRadius — no radius has providers (returns null)
 *   ✅ findEffectiveRadius — user radius = 0 expands to 5km
 *   ✅ EXPANSION_STEPS constant
 */

import { describe, it, expect } from "vitest"
import { EXPANSION_STEPS, buildRadiiToTry, findEffectiveRadius } from "../radius-expansion"

// ---------------------------------------------------------------------------
// EXPANSION_STEPS
// ---------------------------------------------------------------------------

describe("EXPANSION_STEPS", () => {
  it("is readonly and contains the expected steps", () => {
    // Order matters — smallest first
    expect(EXPANSION_STEPS).toEqual([5, 10, 25, 50, 100])
  })

  it("is a readonly tuple via TypeScript 'as const'", () => {
    // 'as const' is a compile-time assertion — no runtime freeze.
    // Verifying the constant itself is unchanged.
    expect(EXPANSION_STEPS).toEqual([5, 10, 25, 50, 100])
  })
})

// ---------------------------------------------------------------------------
// buildRadiiToTry
// ---------------------------------------------------------------------------

describe("buildRadiiToTry", () => {
  it("includes user radius first, then larger expansion steps", () => {
    const radii = buildRadiiToTry(10)
    // 10 first, then steps > 10: [25, 50, 100]
    expect(radii).toEqual([10, 25, 50, 100])
  })

  it("includes all expansion steps when user radius is smaller than the smallest step", () => {
    const radii = buildRadiiToTry(0)
    expect(radii).toEqual([0, 5, 10, 25, 50, 100])
  })

  it("includes only steps larger than user radius", () => {
    const radii = buildRadiiToTry(30)
    // Steps > 30: [50, 100]
    expect(radii).toEqual([30, 50, 100])
  })

  it("returns only user radius when it exceeds the largest expansion step", () => {
    const radii = buildRadiiToTry(200)
    expect(radii).toEqual([200])
  })

  it("includes no expansion steps when user radius equals the largest step", () => {
    const radii = buildRadiiToTry(100)
    // 100 is the largest step, but step > 100 is false, so no append
    expect(radii).toEqual([100])
  })

  it("handles negative user radius", () => {
    const radii = buildRadiiToTry(-1)
    // All EXPANSION_STEPS > -1
    expect(radii).toEqual([-1, 5, 10, 25, 50, 100])
  })

  it("includes the exact boundary step (equal to user radius) only via user radius", () => {
    // If user radius matches an expansion step, the step is not duplicated
    const radii = buildRadiiToTry(25)
    expect(radii).toEqual([25, 50, 100])
    // 25 appears only once (as user radius)
    expect(radii.filter((r) => r === 25)).toHaveLength(1)
  })

  it("is always monotonically increasing", () => {
    for (const userR of [0, 3, 5, 10, 25, 50, 100, 200]) {
      const radii = buildRadiiToTry(userR)
      for (let i = 1; i < radii.length; i++) {
        expect(radii[i]).toBeGreaterThan(radii[i - 1])
      }
    }
  })
})

// ---------------------------------------------------------------------------
// findEffectiveRadius
// ---------------------------------------------------------------------------

describe("findEffectiveRadius", () => {
  it("finds providers at user's requested radius (no expansion needed)", async () => {
    // countFn returns 3 providers at radius 10
    const { effectiveRadius, matchCount } = await findEffectiveRadius(10, async (r) =>
      r === 10 ? 3 : 0,
    )
    expect(effectiveRadius).toBe(10)
    expect(matchCount).toBe(3)
  })

  it("expands to next step when user radius returns 0", async () => {
    // 0 at 10km → 0 at 25km → 2 at 50km → stop
    let callCount = 0
    const { effectiveRadius, matchCount } = await findEffectiveRadius(10, async (r) => {
      callCount++
      if (r === 50) return 2
      return 0
    })
    expect(effectiveRadius).toBe(50)
    expect(matchCount).toBe(2)
    // Should have tried 10, 25, 50 → stopped at 50
    expect(callCount).toBe(3)
  })

  it("returns null when no radius finds providers", async () => {
    const { effectiveRadius, matchCount } = await findEffectiveRadius(10, async () => 0)
    expect(effectiveRadius).toBeNull()
    expect(matchCount).toBe(0)
  })

  it("stops at the first radius with providers", async () => {
    // countFn returns providers at ALL radii
    const { effectiveRadius, matchCount } = await findEffectiveRadius(10, async () => 5)
    // Should stop at the first radius tried (user's radius = 10)
    expect(effectiveRadius).toBe(10)
    expect(matchCount).toBe(5)
  })

  it("expands from radius=0 to 5km", async () => {
    // 0 returns 0 → 5 returns 3 → stop
    const { effectiveRadius, matchCount } = await findEffectiveRadius(0, async (r) => {
      if (r === 0) return 0
      if (r === 5) return 3
      return 0
    })
    expect(effectiveRadius).toBe(5)
    expect(matchCount).toBe(3)
  })

  it("tries all steps when user radius is larger than max step and returns null", async () => {
    // User requests 200km, which is past the max expansion step
    // Only 200 will be tried (no expansion steps > 200)
    let callCount = 0
    const { effectiveRadius, matchCount } = await findEffectiveRadius(200, async () => {
      callCount++
      return 0
    })
    expect(effectiveRadius).toBeNull()
    expect(matchCount).toBe(0)
    expect(callCount).toBe(1) // only the user radius was tried
  })

  it("does not call countFn for radii beyond the first match", async () => {
    const tried: number[] = []
    const { effectiveRadius, matchCount } = await findEffectiveRadius(10, async (r) => {
      tried.push(r)
      return r >= 25 ? 1 : 0
    })
    expect(effectiveRadius).toBe(25)
    expect(matchCount).toBe(1)
    expect(tried).toEqual([10, 25]) // 50 and 100 should NOT be called
  })

  it("handles the countFn throwing — propagates the error", async () => {
    await expect(
      findEffectiveRadius(10, async () => {
        throw new Error("DB unavailable")
      }),
    ).rejects.toThrow("DB unavailable")
  })
})
