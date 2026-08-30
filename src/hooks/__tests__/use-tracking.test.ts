import { describe, it, expect } from "vitest"

describe("useTracking hook", () => {
  it("exports useTracking function", async () => {
    const mod = await import("../use-tracking")
    expect(typeof mod.useTracking).toBe("function")
  })
})
