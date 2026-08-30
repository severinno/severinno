import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("zustand/middleware", () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}))

const mockProvider = {
  id: "p1", name: "Provider 1", role: "PROVIDER" as const,
  avatarUrl: null, city: "SP", state: "SP",
  avgRating: 4.5, reviewCount: 10, verified: true, active: true,
  services: [], distanceKm: null,
}

describe("recently-viewed store", () => {
  beforeEach(() => vi.clearAllMocks())

  it("initializes empty", async () => {
    const { useRecentlyViewedStore } = await import("../recently-viewed")
    expect(useRecentlyViewedStore.getState().items).toHaveLength(0)
  })

  it("addView adds provider", async () => {
    const { useRecentlyViewedStore } = await import("../recently-viewed")
    useRecentlyViewedStore.getState().addView(mockProvider as any)
    expect(useRecentlyViewedStore.getState().items).toHaveLength(1)
    expect(useRecentlyViewedStore.getState().items[0].id).toBe("p1")
  })

  it("addView deduplicates", async () => {
    const { useRecentlyViewedStore } = await import("../recently-viewed")
    useRecentlyViewedStore.getState().addView(mockProvider as any)
    useRecentlyViewedStore.getState().addView({ ...mockProvider, id: "p1" } as any)
    expect(useRecentlyViewedStore.getState().items).toHaveLength(1)
  })

  it("addView caps at 8 items", async () => {
    const { useRecentlyViewedStore } = await import("../recently-viewed")
    for (let i = 0; i < 12; i++) {
      useRecentlyViewedStore.getState().addView({ ...mockProvider, id: `p${i}` } as any)
    }
    expect(useRecentlyViewedStore.getState().items).toHaveLength(8)
  })

  it("clear empties store", async () => {
    const { useRecentlyViewedStore } = await import("../recently-viewed")
    useRecentlyViewedStore.getState().addView(mockProvider as any)
    useRecentlyViewedStore.getState().clear()
    expect(useRecentlyViewedStore.getState().items).toHaveLength(0)
  })
})
