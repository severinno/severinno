import { describe, it, expect } from "vitest"
import { isInCoverage } from "../coverage"

describe("isInCoverage", () => {
  it("valid point inside coverage area", () => {
    const result = isInCoverage(-23.55, -46.63, 10, -23.54, -46.62)
    expect(result).toBe(true)
  })

  it("valid point outside coverage area", () => {
    const result = isInCoverage(-23.55, -46.63, 5, -23.4, -46.5)
    expect(result).toBe(false)
  })

  it("returns false for zero radius", () => {
    const result = isInCoverage(-23.55, -46.63, 0, -23.54, -46.62)
    expect(result).toBe(false)
  })
})
