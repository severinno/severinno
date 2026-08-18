/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"
import { hashPassword, verifyPassword } from "../crypto"

describe("hashPassword", () => {
  it("returns a salt:hash formatted string", () => {
    const result = hashPassword("my-password")
    expect(result).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/)
  })

  it("produces different hashes for the same password (random salt)", () => {
    const h1 = hashPassword("same-password")
    const h2 = hashPassword("same-password")
    expect(h1).not.toBe(h2)
  })
})

describe("verifyPassword", () => {
  it("returns true for correct password", () => {
    const hash = hashPassword("correct-password")
    expect(verifyPassword("correct-password", hash)).toBe(true)
  })

  it("returns false for wrong password", () => {
    const hash = hashPassword("real-password")
    expect(verifyPassword("wrong-password", hash)).toBe(false)
  })

  it("returns false for malformed stored hash", () => {
    expect(verifyPassword("any", "")).toBe(false)
    expect(verifyPassword("any", "invalid")).toBe(false)
    expect(verifyPassword("any", "only-salt:")).toBe(false)
  })

  it("returns false for null/undefined stored value", () => {
    expect(verifyPassword("any", null as unknown as string)).toBe(false)
    expect(verifyPassword("any", undefined as unknown as string)).toBe(false)
  })

  it("handles empty password", () => {
    const hash = hashPassword("")
    expect(verifyPassword("", hash)).toBe(true)
    expect(verifyPassword("not-empty", hash)).toBe(false)
  })
})
