import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/api", () => ({ apiPost: vi.fn(), apiGet: vi.fn() }))

describe("useCheckout hook", () => {
  it("exports useCheckout function", async () => {
    const mod = await import("../use-checkout")
    expect(typeof mod.useCheckout).toBe("function")
  })
})
