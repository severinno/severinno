import { describe, it, expect } from "vitest"
import { haversineKm, formatDistance } from "../geo-client"

describe("geo-client haversineKm", () => {
  it("returns zero for same coordinates", () => {
    expect(haversineKm(-23.55, -46.63, -23.55, -46.63)).toBe(0)
  })

  it("calculates ~1km between nearby points", () => {
    const d = haversineKm(-23.55, -46.63, -23.543, -46.625)
    expect(d).toBeGreaterThan(0.5)
    expect(d).toBeLessThan(2)
  })

  it("calculates ~430km between São Paulo and Rio", () => {
    const d = haversineKm(-23.55, -46.63, -22.9, -43.2)
    expect(d).toBeGreaterThan(350)
    expect(d).toBeLessThan(500)
  })
})

describe("geo-client formatDistance", () => {
  it('returns "—" for null', () => {
    expect(formatDistance(null)).toBe("—")
  })

  it('returns "—" for undefined', () => {
    expect(formatDistance(undefined)).toBe("—")
  })

  it('returns "—" for NaN', () => {
    expect(formatDistance(NaN)).toBe("—")
  })

  it("formats <1km as meters", () => {
    expect(formatDistance(0.85)).toBe("850 m")
  })

  it("formats <10km with one decimal", () => {
    expect(formatDistance(5.3)).toBe("5,3 km")
  })

  it("formats >=10km as integer", () => {
    expect(formatDistance(15)).toBe("15 km")
  })
})
