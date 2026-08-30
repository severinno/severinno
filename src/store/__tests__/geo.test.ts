import { describe, it, expect, vi } from "vitest"

vi.mock("zustand/middleware", () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}))

describe("geo store", () => {
  it("exports useGeoStore", async () => {
    const { useGeoStore } = await import("../geo")
    expect(useGeoStore).toBeDefined()
    expect(typeof useGeoStore.getState).toBe("function")
  })
})
