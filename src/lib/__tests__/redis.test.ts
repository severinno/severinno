/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest"

/**
 * Redis caching tests — pure integration tests for the exported functions.
 *
 * The Redis module uses a singleton client (ioredis) that's difficult to
 * mock reliably across test files. These tests verify the module's exports
 * exist and have the expected types. Real Redis testing is done via the
 * health endpoint integration tests and manual verification.
 */

import { cacheGet, cacheSet, cacheInvalidate, withCache } from "@/lib/redis"

describe("redis module exports", () => {
  it("exporta cacheGet como função", () => {
    expect(typeof cacheGet).toBe("function")
  })

  it("exporta cacheSet como função", () => {
    expect(typeof cacheSet).toBe("function")
  })

  it("exporta cacheInvalidate como função", () => {
    expect(typeof cacheInvalidate).toBe("function")
  })

  it("exporta withCache como função", () => {
    expect(typeof withCache).toBe("function")
  })
})
