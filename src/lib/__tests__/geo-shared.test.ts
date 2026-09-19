import { describe, it, expect } from "vitest"
import { haversineKm, formatDistance, isValidLatLng } from "../geo-shared"

describe("geo-shared.ts — Pure Geolocation Helpers", () => {
  // ── haversineKm ─────────────────────────────────────────────────────
  describe("haversineKm", () => {
    it("same point → 0", () => {
      expect(haversineKm(-23.55, -46.63, -23.55, -46.63)).toBe(0)
    })

    it("São Paulo to Rio de Janeiro ≈ 360km", () => {
      const dist = haversineKm(-23.5505, -46.6333, -22.9068, -43.1729)
      expect(dist).toBeGreaterThan(350)
      expect(dist).toBeLessThan(375)
    })

    it("antipodal points ≈ 20000km", () => {
      const dist = haversineKm(0, 0, 0, 180)
      expect(dist).toBeGreaterThan(19900)
      expect(dist).toBeLessThan(20100)
    })

    it("equator to pole ≈ 10000km", () => {
      const dist = haversineKm(0, 0, 90, 0)
      expect(dist).toBeGreaterThan(9900)
      expect(dist).toBeLessThan(10100)
    })

    it("known distance: London to Paris ≈ 340km", () => {
      const dist = haversineKm(51.5074, -0.1278, 48.8566, 2.3522)
      expect(dist).toBeGreaterThan(330)
      expect(dist).toBeLessThan(350)
    })

    it("short distance: 1km apart", () => {
      // ~0.009 degrees lat at equator ≈ 1km
      const dist = haversineKm(0, 0, 0.009, 0)
      expect(dist).toBeGreaterThan(0.9)
      expect(dist).toBeLessThan(1.1)
    })
  })

  // ── formatDistance ───────────────────────────────────────────────────
  describe("formatDistance", () => {
    it("null → '—'", () => {
      expect(formatDistance(null)).toBe("—")
    })

    it("undefined → '—'", () => {
      expect(formatDistance(undefined)).toBe("—")
    })

    it("NaN → '—'", () => {
      expect(formatDistance(NaN)).toBe("—")
    })

    it("Infinity → '—'", () => {
      expect(formatDistance(Infinity)).toBe("—")
    })

    it("< 1km → meters", () => {
      expect(formatDistance(0.5)).toBe("500 m")
      expect(formatDistance(0.001)).toBe("1 m")
      expect(formatDistance(0.85)).toBe("850 m")
    })

    it("1-10km → 1 decimal with comma", () => {
      expect(formatDistance(1.5)).toBe("1,5 km")
      expect(formatDistance(5.23)).toBe("5,2 km")
      expect(formatDistance(9.9)).toBe("9,9 km")
    })

    it(">= 10km → integer", () => {
      expect(formatDistance(10)).toBe("10 km")
      expect(formatDistance(15.7)).toBe("16 km")
      expect(formatDistance(100)).toBe("100 km")
    })
  })

  // ── isValidLatLng ────────────────────────────────────────────────────
  describe("isValidLatLng", () => {
    it("valid coordinates", () => {
      expect(isValidLatLng(-23.55, -46.63)).toBe(true)
    })

    it("equator/prime meridian (0, 0)", () => {
      expect(isValidLatLng(0, 0)).toBe(true)
    })

    it("boundary: lat=90, lng=180", () => {
      expect(isValidLatLng(90, 180)).toBe(true)
    })

    it("boundary: lat=-90, lng=-180", () => {
      expect(isValidLatLng(-90, -180)).toBe(true)
    })

    it("lat > 90 → false", () => {
      expect(isValidLatLng(91, 0)).toBe(false)
    })

    it("lat < -90 → false", () => {
      expect(isValidLatLng(-91, 0)).toBe(false)
    })

    it("lng > 180 → false", () => {
      expect(isValidLatLng(0, 181)).toBe(false)
    })

    it("lng < -180 → false", () => {
      expect(isValidLatLng(0, -181)).toBe(false)
    })

    it("NaN → false", () => {
      expect(isValidLatLng(NaN, 0)).toBe(false)
      expect(isValidLatLng(0, NaN)).toBe(false)
    })

    it("Infinity → false", () => {
      expect(isValidLatLng(Infinity, 0)).toBe(false)
      expect(isValidLatLng(0, Infinity)).toBe(false)
    })

    it("string input → false", () => {
      expect(isValidLatLng("23.55" as unknown as number, "-46.63" as unknown as number)).toBe(false)
    })

    it("null → false", () => {
      expect(isValidLatLng(null as unknown as number, null as unknown as number)).toBe(false)
    })
  })
})
