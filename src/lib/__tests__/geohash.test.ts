/**
 * Tests for src/lib/geohash.ts
 *
 * Pure unit tests — no mocks. Vectors cross-checked against the standard
 * geohash algorithm (same scheme as postgis.ts's previous inlined encoder).
 */

import { describe, it, expect } from "vitest"
import { encodeGeohash } from "../geohash"

describe("encodeGeohash", () => {
  it("produces the canonical geohash for known coordinates", () => {
    // Well-known geohash scheme: South America is '6', Brazil '6g',
    // São Paulo region '6gy…' — vectors cross-checked against geohash.org.
    expect(encodeGeohash(-23.5505, -46.6333, 7)).toBe("6gyf4bf") // São Paulo
    expect(encodeGeohash(40.7412, -73.9927, 7)).toBe("dr5ru28") // New York
    expect(encodeGeohash(51.5194, -0.127, 7)).toBe("gcpvj4g") // London
  })

  it("defaults to precision 7", () => {
    expect(encodeGeohash(-23.5505, -46.6333)).toBe(encodeGeohash(-23.5505, -46.6333, 7))
  })

  it("returns longer hashes for higher precision", () => {
    const h5 = encodeGeohash(-23.5505, -46.6333, 5)
    const h8 = encodeGeohash(-23.5505, -46.6333, 8)
    expect(h5).toHaveLength(5)
    expect(h8).toHaveLength(8)
    // Prefix property: lower precision is a prefix of higher precision
    expect(h8.startsWith(encodeGeohash(-23.5505, -46.6333, 5))).toBe(true)
  })

  it("groups nearby points into the same cell (the reason it replaced toFixed)", () => {
    // Two points ~50m apart that straddle a 0.001° boundary would get
    // different toFixed(3) keys; geohash-7 keeps them together for most
    // urban positions. At minimum, identical cells for sub-meter offsets.
    const a = encodeGeohash(-23.5505, -46.6333, 7)
    const b = encodeGeohash(-23.5505, -46.6332, 7) // ~10cm east
    expect(a).toBe(b)
  })

  it("uses only the base32 alphabet", () => {
    const hash = encodeGeohash(-23.5505, -46.6333, 12)
    expect(hash).toMatch(/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/)
  })

  it("handles extreme coordinates without crashing", () => {
    expect(() => encodeGeohash(90, 180, 7)).not.toThrow()
    expect(() => encodeGeohash(-90, -180, 7)).not.toThrow()
    expect(() => encodeGeohash(0, 0, 7)).not.toThrow()
  })
})
