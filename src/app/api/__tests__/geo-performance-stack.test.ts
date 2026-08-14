import { describe, it, expect, beforeEach } from "vitest"
import { latLngToH3, h3ToLatLng, h3GetKRing, h3ToGeoBoundary, clusterByH3 } from "@/lib/h3-grid"
import { tileToBBox } from "@/lib/vector-tiles"
import { calculate1xNDistanceMatrix } from "@/lib/osrm-table"
import { encodeGeohash, decodeGeohash, getOrSetGeohashCache, clearGeohashCache } from "@/lib/geohash-cache"
import { optimizeDailyRoute2Opt, RouteStop } from "@/lib/tsp-route-optimizer"

describe("1. H3 Hexagonal Spatial Indexing Engine", () => {
  const spCenter = { lat: -23.5505, lng: -46.6333 }

  it("should encode lat/lng to an H3-compatible cell index", () => {
    const h3 = latLngToH3(spCenter.lat, spCenter.lng, 7)
    expect(h3).toBeDefined()
    expect(h3.startsWith("87")).toBe(true)
    expect(h3.length).toBeGreaterThanOrEqual(12)
  })

  it("should decode H3 index back to approximate original coordinates", () => {
    const h3 = latLngToH3(spCenter.lat, spCenter.lng, 7)
    const decoded = h3ToLatLng(h3)

    expect(Math.abs(decoded.lat - spCenter.lat)).toBeLessThan(0.02)
    expect(Math.abs(decoded.lng - spCenter.lng)).toBeLessThan(0.02)
  })

  it("should return 7 cells for a k=1 ring around center", () => {
    const h3 = latLngToH3(spCenter.lat, spCenter.lng, 7)
    const kRing = h3GetKRing(h3, 1)

    expect(kRing.length).toBeGreaterThanOrEqual(7)
    expect(kRing).toContain(h3)
  })

  it("should generate a valid 6-vertex closed GeoJSON polygon ring", () => {
    const h3 = latLngToH3(spCenter.lat, spCenter.lng, 7)
    const boundary = h3ToGeoBoundary(h3)

    expect(boundary.length).toBe(7) // 6 vertices + 1 closing vertex
    expect(boundary[0]).toEqual(boundary[6])
  })

  it("should cluster multiple coordinates into H3 density buckets", () => {
    const points = [
      { id: "1", lat: -23.5505, lng: -46.6333 },
      { id: "2", lat: -23.5510, lng: -46.6335 },
      { id: "3", lat: -23.6040, lng: -46.6610 },
    ]

    const clusters = clusterByH3(points, 7)
    expect(clusters.length).toBeGreaterThanOrEqual(1)
    expect(clusters[0].count).toBeGreaterThanOrEqual(1)
    expect(clusters[0].boundary.length).toBe(7)
  })
})

describe("2. Vector Tiles Bbox Engine", () => {
  it("should calculate valid geographic bounding box for Slippy Map tiles", () => {
    // Zoom 12 tile in São Paulo
    const bbox = tileToBBox(12, 1494, 2378)
    expect(bbox.minLat).toBeLessThan(bbox.maxLat)
    expect(bbox.minLng).toBeLessThan(bbox.maxLng)
    expect(bbox.minLat).toBeGreaterThan(-90)
    expect(bbox.maxLat).toBeLessThan(90)
  })
})

describe("3. OSRM Table 1xN Distance Matrix Batch Engine", () => {
  it("should compute distance and ETA for multiple destinations in a single call", async () => {
    const origin = { lat: -23.5505, lng: -46.6333 } // Centro SP
    const destinations = [
      { id: "prov-pinheiros", lat: -23.565, lng: -46.687, name: "Pinheiros" },
      { id: "prov-moema", lat: -23.604, lng: -46.661, name: "Moema" },
      { id: "prov-tatuape", lat: -23.541, lng: -46.576, name: "Tatuapé" },
    ]

    const matrix = await calculate1xNDistanceMatrix(origin, destinations)

    expect(matrix.length).toBe(3)
    for (const item of matrix) {
      expect(item.distanceKm).toBeGreaterThan(0)
      expect(item.durationMinutes).toBeGreaterThan(0)
      expect(["osrm-table", "haversine-urban-fallback"]).toContain(item.source)
    }
  })
})

describe("4. Geohash Encoder & SWR Edge Cache", () => {
  beforeEach(() => {
    clearGeohashCache()
  })

  it("should encode and decode geohashes with high precision", () => {
    const lat = -23.55052
    const lng = -46.633308
    const geohash = encodeGeohash(lat, lng, 6)

    expect(geohash.length).toBe(6)

    const decoded = decodeGeohash(geohash)
    expect(Math.abs(decoded.lat - lat)).toBeLessThan(0.01)
    expect(Math.abs(decoded.lng - lng)).toBeLessThan(0.01)
  })

  it("should cache results using SWR strategy", async () => {
    let callCount = 0
    const fetcher = async () => {
      callCount++
      return [{ id: "prov-1", name: "Carlos" }]
    }

    const res1 = await getOrSetGeohashCache("6gyf4b", "eletricista", fetcher, 60)
    expect(res1.source).toBe("fresh-db")
    expect(callCount).toBe(1)

    const res2 = await getOrSetGeohashCache("6gyf4b", "eletricista", fetcher, 60)
    expect(res2.source).toBe("cache-hit")
    expect(callCount).toBe(1) // Should not invoke DB again
  })
})

describe("5. 2-Opt TSP Route Optimizer Engine", () => {
  it("should optimize a sequence of multiple daily appointments", () => {
    const baseLocation = { lat: -23.5505, lng: -46.6333 } // Downtown Base

    const stops: RouteStop[] = [
      { id: "stop-far", title: "Instalação Santo Amaro", address: "Av Santo Amaro", lat: -23.63, lng: -46.69 },
      { id: "stop-near", title: "Troca Disjuntor Bela Vista", address: "Av Paulista", lat: -23.56, lng: -46.65 },
      { id: "stop-mid", title: "Reparo Pinheiros", address: "Rua dos Pinheiros", lat: -23.57, lng: -46.68 },
    ]

    const plan = optimizeDailyRoute2Opt(baseLocation, stops)

    expect(plan.orderedStops.length).toBe(3)
    expect(plan.optimizedDistanceKm).toBeLessThanOrEqual(plan.initialDistanceKm)
    expect(plan.googleMapsUrl).toContain("https://www.google.com/maps/dir")
    expect(plan.wazeUrl).toContain("https://waze.com/ul")
  })
})
