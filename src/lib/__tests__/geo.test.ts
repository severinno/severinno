import { describe, it, expect } from "vitest"
import { haversineKm, formatDistance } from "../geo-shared"

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    const d = haversineKm(-23.5505, -46.6333, -23.5505, -46.6333)
    expect(d).toBe(0)
  })

  it("calculates approximate distance between São Paulo and Rio de Janeiro", () => {
    // São Paulo (approx)
    const spLat = -23.5505
    const spLng = -46.6333
    // Rio de Janeiro (approx)
    const rjLat = -22.9068
    const rjLng = -43.1729

    const d = haversineKm(spLat, spLng, rjLat, rjLng)
    // Real distance is ~360 km — allow 5% tolerance
    expect(d).toBeGreaterThan(340)
    expect(d).toBeLessThan(380)
  })

  it("calculates distance between São Paulo and New York", () => {
    const d = haversineKm(-23.5505, -46.6333, 40.7128, -74.006)
    // ~7700 km — allow 5% tolerance
    expect(d).toBeGreaterThan(7300)
    expect(d).toBeLessThan(8100)
  })

  it("handles equatorial points correctly", () => {
    // Equator, 0° and 1° longitude apart (~111km)
    const d = haversineKm(0, 0, 0, 1)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })

  it("handles prime meridian correctly", () => {
    // Same longitude, 1° latitude apart (~111km)
    const d = haversineKm(0, 0, 1, 0)
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
  })

  it("is symmetric (A→B = B→A)", () => {
    const d1 = haversineKm(-23.55, -46.63, -22.91, -43.17)
    const d2 = haversineKm(-22.91, -43.17, -23.55, -46.63)
    expect(d1).toBeCloseTo(d2, 10)
  })

  it("handles small distances (< 1 km)", () => {
    // ~500m between two nearby points (~0.005° apart)
    const d = haversineKm(-23.5505, -46.6333, -23.5555, -46.6333)
    expect(d).toBeGreaterThan(0.4)
    expect(d).toBeLessThan(0.7)
  })

  it("handles antipodal points (opposite sides of earth)", () => {
    const d = haversineKm(0, 0, 0, 180)
    // Half the earth's circumference (~20015 km)
    expect(d).toBeGreaterThan(19000)
    expect(d).toBeLessThan(21000)
  })
})

describe("formatDistance", () => {
  it("returns '—' for null", () => {
    expect(formatDistance(null)).toBe("—")
  })

  it("returns '—' for undefined", () => {
    expect(formatDistance(undefined)).toBe("—")
  })

  it("returns '—' for NaN", () => {
    expect(formatDistance(NaN)).toBe("—")
  })

  it("returns '—' for Infinity", () => {
    expect(formatDistance(Infinity)).toBe("—")
  })

  it("formats < 1 km in meters", () => {
    expect(formatDistance(0.5)).toBe("500 m")
  })

  it("formats 0 km as '0 m'", () => {
    expect(formatDistance(0)).toBe("0 m")
  })

  it("formats 0.85 km as '850 m'", () => {
    expect(formatDistance(0.85)).toBe("850 m")
  })

  it("formats 0.001 km as '1 m'", () => {
    expect(formatDistance(0.001)).toBe("1 m")
  })

  it("formats < 10 km with one decimal place (comma as separator)", () => {
    expect(formatDistance(1.2)).toBe("1,2 km")
  })

  it("formats 5.0 km as '5,0 km'", () => {
    expect(formatDistance(5.0)).toBe("5,0 km")
  })

  it("formats 9.9 km as '9,9 km'", () => {
    expect(formatDistance(9.9)).toBe("9,9 km")
  })

  it("formats >= 10 km as integer", () => {
    expect(formatDistance(10)).toBe("10 km")
  })

  it("formats 15.7 km as '16 km' (rounded)", () => {
    expect(formatDistance(15.7)).toBe("16 km")
  })

  it("formats 100 km as '100 km'", () => {
    expect(formatDistance(100)).toBe("100 km")
  })

  it("formats 1234.5 km as '1235 km' (rounded)", () => {
    expect(formatDistance(1234.5)).toBe("1235 km")
  })

  it("rounds correctly for 1.49 km → '1,5 km'", () => {
    expect(formatDistance(1.49)).toBe("1,5 km")
  })

  it("rounds correctly for 1.44 km → '1,4 km'", () => {
    expect(formatDistance(1.44)).toBe("1,4 km")
  })
})
