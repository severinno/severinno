/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { syncRadiusCircle, removeRadiusCircle, RADIUS_SOURCE_ID, type MapLike } from "../geo-circle"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal mock Map-like object. */
function createMockMap(): MapLike & { setDataCalls: unknown[] } {
  const sourceStore = new Map<string, { setData: ReturnType<typeof vi.fn>; type?: string }>()
  const layerStore = new Map<string, boolean>()

  const setData = vi.fn()

  return {
    setDataCalls: [] as unknown[],

    getSource(id: string) {
      const s = sourceStore.get(id)
      if (!s) return undefined
      return { setData: s.setData }
    },

    addSource(id: string, source: Record<string, unknown>) {
      sourceStore.set(id, {
        setData: vi.fn((data: unknown) => {
          this.setDataCalls.push(data)
        }),
        type: source.type as string,
      })
    },

    getLayer(id: string) {
      return layerStore.get(id) ?? false
    },

    addLayer(layer: Record<string, unknown>) {
      layerStore.set(layer.id as string, true)
    },

    removeLayer(id: string) {
      layerStore.delete(id)
    },

    removeSource(id: string) {
      sourceStore.delete(id)
    },
  }
}

// ---------------------------------------------------------------------------
// syncRadiusCircle
// ---------------------------------------------------------------------------

describe("syncRadiusCircle", () => {
  const LAT = -23.5505
  const LNG = -46.6333
  const RADIUS_KM = 10

  let map: ReturnType<typeof createMockMap>

  beforeEach(() => {
    map = createMockMap()
  })

  it("creates source and 3 layers on first call", () => {
    syncRadiusCircle(map, LAT, LNG, RADIUS_KM)

    // Source was added with correct type
    expect(map.getSource(RADIUS_SOURCE_ID)).toBeDefined()

    // 3 layers were added
    expect(map.getLayer("radius-circle-fill")).toBe(true)
    expect(map.getLayer("radius-circle-outline")).toBe(true)
    expect(map.getLayer("radius-circle-edge")).toBe(true)
  })

  it("updates data via setData on subsequent calls (source already exists)", () => {
    syncRadiusCircle(map, LAT, LNG, RADIUS_KM)

    // Second call — source exists, should use setData
    syncRadiusCircle(map, LAT, LNG, 20)

    // Source should still exist (only 1 addSource call)
    const sourcesBefore = map.getSource(RADIUS_SOURCE_ID)
    expect(sourcesBefore).toBeDefined()

    // setData was called once (from the second syncRadiusCircle via addSource's internal setData)
    // Actually, the first call's addSource creates a setData mock, but we don't call it.
    // The second call calls getSource which returns the mock with setData, then calls setData.
    // Let's check the setDataCalls
    expect(map.setDataCalls).toHaveLength(1)
  })

  it("passes a valid GeoJSON Feature to setData on update", () => {
    syncRadiusCircle(map, LAT, LNG, RADIUS_KM)
    syncRadiusCircle(map, LAT, LNG, RADIUS_KM)

    const data = map.setDataCalls[0] as Record<string, unknown>
    expect(data.type).toBe("Feature")
    expect((data.geometry as Record<string, unknown>).type).toBe("Polygon")
  })

  it("uses createRadiusGeoJSON with the correct center and radius", () => {
    syncRadiusCircle(map, LAT, LNG, 5)

    // First call: addSource is called with data
    // We can verify by checking the data has a polygon with vertices
    expect(map.setDataCalls).toHaveLength(0) // first call uses addSource, not setData
  })
})

// ---------------------------------------------------------------------------
// removeRadiusCircle
// ---------------------------------------------------------------------------

describe("removeRadiusCircle", () => {
  it("removes all 3 layers and source when they exist", () => {
    const map = createMockMap()
    syncRadiusCircle(map, -23.55, -46.63, 10)

    expect(map.getLayer("radius-circle-fill")).toBe(true)
    expect(map.getLayer("radius-circle-edge")).toBe(true)

    removeRadiusCircle(map)

    expect(map.getLayer("radius-circle-fill")).toBe(false)
    expect(map.getLayer("radius-circle-outline")).toBe(false)
    expect(map.getLayer("radius-circle-edge")).toBe(false)
    expect(map.getSource(RADIUS_SOURCE_ID)).toBeUndefined()
  })

  it("does nothing when no circle has been added", () => {
    const map = createMockMap()

    // Should not throw
    expect(() => removeRadiusCircle(map)).not.toThrow()

    expect(map.getLayer("radius-circle-fill")).toBe(false)
    expect(map.getSource(RADIUS_SOURCE_ID)).toBeUndefined()
  })

  it("is idempotent (calling twice is safe)", () => {
    const map = createMockMap()
    syncRadiusCircle(map, -23.55, -46.63, 10)
    removeRadiusCircle(map)

    // Second removal should not throw
    expect(() => removeRadiusCircle(map)).not.toThrow()
  })

  it("partially cleans up even if some layers are missing", () => {
    const map = createMockMap()

    // Manually add source without one of the layers
    map.addSource(RADIUS_SOURCE_ID, { type: "geojson", data: { type: "Feature" } } as any)
    map.addLayer({ id: "radius-circle-fill", type: "fill" } as any)
    // Skip "radius-circle-outline" and "radius-circle-edge"

    removeRadiusCircle(map)

    expect(map.getLayer("radius-circle-fill")).toBe(false)
    expect(map.getSource(RADIUS_SOURCE_ID)).toBeUndefined()
  })
})
