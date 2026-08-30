import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("zustand/middleware", () => ({
  persist: (fn: any) => fn,
  createJSONStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}))

vi.mock("@/lib/api", () => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
}))

describe("auth store", () => {
  beforeEach(() => vi.clearAllMocks())

  it("has correct initial state shape", async () => {
    const { useAuthStore } = await import("../auth")
    const state = useAuthStore.getState()
    expect(state).toHaveProperty("user")
    expect(state).toHaveProperty("status")
    expect(state).toHaveProperty("setUser")
    expect(state).toHaveProperty("logout")
  })

  it("setUser updates state", async () => {
    const { useAuthStore } = await import("../auth")
    useAuthStore.getState().setUser({
      id: "u1", name: "Test", email: "t@t.com", role: "CLIENT",
    })
    expect(useAuthStore.getState().user?.id).toBe("u1")
  })
})
