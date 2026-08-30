import { describe, it, expect } from "vitest"

describe("useMobile hook", () => {
  it("exports useIsMobile function", async () => {
    const mod = await import("../use-mobile")
    expect(typeof mod.useIsMobile).toBe("function")
  })
})
