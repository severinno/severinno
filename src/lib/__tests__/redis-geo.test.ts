import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(() => null),
}))

vi.mock("@/lib/postgis", () => ({
  findProvidersWithinRadius: vi.fn(async () => []),
}))

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock("@/lib/db", () => ({
  db: { user: { findMany: vi.fn() } },
}))

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  indexProviderLocation,
  removeProviderFromGeoIndex,
  searchNearbyProvidersFast,
  seedGeoIndex,
  RedisGeoCache,
} from "@/lib/redis-geo"
import { findProvidersWithinRadius } from "@/lib/postgis"

// ── Known provider IDs used across tests (for cleanup) ───────────────────────

const KNOWN_IDS = ["prov-alpha", "prov-beta", "prov-gamma", "prov-delta", "prov-epsilon"]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove all known test providers from the in-memory index. */
async function clearTestProviders(): Promise<void> {
  for (const id of KNOWN_IDS) {
    await removeProviderFromGeoIndex(id)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("redis-geo.ts — Turbo Geospatial Indexing", () => {
  beforeEach(async () => {
    await clearTestProviders()
  })

  // ── indexProviderLocation ──────────────────────────────────────────────

  describe("indexProviderLocation", () => {
    it("adds a provider to the in-memory geo index", async () => {
      await indexProviderLocation("prov-alpha", -23.55, -46.63)
      const stats = await RedisGeoCache.getStats()
      expect(stats.cachedLocations).toBeGreaterThanOrEqual(1)
    })

    it("ignores empty providerId", async () => {
      await indexProviderLocation("", -23.55, -46.63)
      // Should not have added an entry with key ""
      const entries = await searchNearbyProvidersFast(-23.55, -46.63, 10)
      expect(entries.find((e) => e.id === "")).toBeUndefined()
    })

    it("ignores null/zero lat", async () => {
      await indexProviderLocation("prov-beta", 0, -46.63)
      const results = await searchNearbyProvidersFast(-23.55, -46.63, 10)
      expect(results.find((r) => r.id === "prov-beta")).toBeUndefined()
    })

    it("ignores null/zero lng", async () => {
      await indexProviderLocation("prov-gamma", -23.55, 0)
      const results = await searchNearbyProvidersFast(-23.55, -46.63, 10)
      expect(results.find((r) => r.id === "prov-gamma")).toBeUndefined()
    })
  })

  // ── removeProviderFromGeoIndex ─────────────────────────────────────────

  describe("removeProviderFromGeoIndex", () => {
    it("removes a provider from the in-memory index", async () => {
      await indexProviderLocation("prov-alpha", -23.55, -46.63)
      await removeProviderFromGeoIndex("prov-alpha")

      const results = await searchNearbyProvidersFast(-23.55, -46.63, 10)
      expect(results.find((r) => r.id === "prov-alpha")).toBeUndefined()
    })

    it("is safe to call with a non-existent ID", async () => {
      await expect(removeProviderFromGeoIndex("non-existent-id")).resolves.toBeUndefined()
    })
  })

  // ── searchNearbyProvidersFast ──────────────────────────────────────────

  describe("searchNearbyProvidersFast", () => {
    it("returns results from in-memory index when populated", async () => {
      await indexProviderLocation("prov-alpha", -23.5505, -46.6333)

      const results = await searchNearbyProvidersFast(-23.5505, -46.6333, 1)
      expect(results.length).toBe(1)
      expect(results[0].id).toBe("prov-alpha")
      expect(results[0].source).toBe("fast-index")
    })

    it("returns empty when no providers are in radius", async () => {
      await indexProviderLocation("prov-alpha", -23.5505, -46.6333)

      // São Paulo center → search 1km radius far away in Rio
      const results = await searchNearbyProvidersFast(-22.9068, -43.1729, 1)
      expect(results).toEqual([])
    })

    it("falls back to PostGIS when in-memory index is empty", async () => {
      vi.mocked(findProvidersWithinRadius).mockResolvedValueOnce([
        { id: "postgis-prov", distanceKm: 3.2 },
      ])

      const results = await searchNearbyProvidersFast(-23.5505, -46.6333, 10)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe("postgis-prov")
      expect(results[0].source).toBe("postgis")
      expect(results[0].distanceKm).toBe(3.2)
    })

    it("sorts results by distance (nearest first)", async () => {
      // Place three providers at different distances from a center point
      // Center: (-23.5505, -46.6333)
      await indexProviderLocation("prov-alpha", -23.5505, -46.6333) // 0 km
      await indexProviderLocation("prov-beta", -23.5555, -46.6333) // ~0.56 km south
      await indexProviderLocation("prov-gamma", -23.57, -46.6333) // ~2.17 km south

      const results = await searchNearbyProvidersFast(-23.5505, -46.6333, 5)

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe("prov-alpha")
      expect(results[1].id).toBe("prov-beta")
      expect(results[2].id).toBe("prov-gamma")
      expect(results[0].distanceKm).toBeLessThan(results[1].distanceKm)
      expect(results[1].distanceKm).toBeLessThan(results[2].distanceKm)
    })

    it("respects the limit parameter", async () => {
      // Seed 5 providers spread around the center
      await indexProviderLocation("prov-alpha", -23.5505, -46.6333)
      await indexProviderLocation("prov-beta", -23.5555, -46.6333)
      await indexProviderLocation("prov-gamma", -23.56, -46.6333)
      await indexProviderLocation("prov-delta", -23.565, -46.6333)
      await indexProviderLocation("prov-epsilon", -23.57, -46.6333)

      const results = await searchNearbyProvidersFast(-23.5505, -46.6333, 10, 2)
      expect(results).toHaveLength(2)
    })

    it("rounds distanceKm to one decimal place", async () => {
      await indexProviderLocation("prov-alpha", -23.551, -46.6333)

      const results = await searchNearbyProvidersFast(-23.5505, -46.6333, 1)
      expect(results).toHaveLength(1)
      // Verify rounding: distance should match toFixed pattern
      const rounded = Math.round(results[0].distanceKm * 10) / 10
      expect(results[0].distanceKm).toBe(rounded)
    })
  })

  // ── seedGeoIndex ───────────────────────────────────────────────────────

  describe("seedGeoIndex", () => {
    it("bulk seeds multiple providers and returns count", async () => {
      const count = seedGeoIndex([
        { id: "prov-alpha", lat: -23.5505, lng: -46.6333 },
        { id: "prov-beta", lat: -23.5605, lng: -46.6433 },
        { id: "prov-gamma", lat: -23.5705, lng: -46.6533 },
      ])

      expect(count).toBe(3)
      const results = await searchNearbyProvidersFast(-23.5505, -46.6333, 50)
      expect(results).toHaveLength(3)
    })

    it("skips providers with invalid (falsy) coordinates", async () => {
      const count = seedGeoIndex([
        { id: "prov-alpha", lat: -23.5505, lng: -46.6333 },
        { id: "bad-1", lat: 0, lng: -46.6333 },
        { id: "bad-2", lat: -23.5505, lng: 0 },
        { id: "bad-3", lat: 0, lng: 0 },
      ])

      // Only 1 valid provider
      expect(count).toBe(1)
    })

    it("returns 0 for empty array", async () => {
      const count = seedGeoIndex([])
      expect(count).toBe(0)
    })
  })

  // ── RedisGeoCache.getStats ─────────────────────────────────────────────

  describe("RedisGeoCache.getStats", () => {
    it("returns correct shape with in-memory-grid engine when populated", async () => {
      await indexProviderLocation("prov-alpha", -23.5505, -46.6333)

      const stats = await RedisGeoCache.getStats()
      expect(stats).toHaveProperty("cachedLocations")
      expect(stats).toHaveProperty("engine")
      expect(stats.cachedLocations).toBeGreaterThanOrEqual(1)
      expect(stats.engine).toBe("in-memory-grid")
    })

    it("returns redis-geo-ready engine when index is empty", async () => {
      await clearTestProviders()

      const stats = await RedisGeoCache.getStats()
      expect(stats.cachedLocations).toBe(0)
      expect(stats.engine).toBe("redis-geo-ready")
    })
  })
})
