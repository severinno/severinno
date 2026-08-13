/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { default as logger } from "@/lib/logger"

describe("vi sanity check", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("vi.clearAllMocks works", () => {
    expect(typeof vi.clearAllMocks).toBe("function")
  })

  it("vi.mocked works on vi.fn", () => {
    const fn = vi.fn()
    vi.mocked(fn).mockResolvedValue("hello")
  })

  it("vi.mocked works on object property", () => {
    vi.mocked(logger.info).mockResolvedValue(undefined as any)
  })
})
