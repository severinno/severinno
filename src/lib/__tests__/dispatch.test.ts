/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"
import { formatDistance } from "../geo"

describe("formatDistance", () => {
  it("formats < 1 km as meters", () => {
    expect(formatDistance(0.85)).toBe("850 m")
  })

  it("formats >= 1 km with one decimal", () => {
    expect(formatDistance(1.5)).toBe("1,5 km")
  })

  it("formats >= 10 km without decimal", () => {
    expect(formatDistance(15)).toBe("15 km")
  })

  it("handles non-finite values", () => {
    expect(formatDistance(NaN)).toBe("—")
    expect(formatDistance(Infinity)).toBe("—")
  })
})
