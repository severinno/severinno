/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Hoisted mocks ─────────────────────────────────────────────────────────

const { mockRedisClient, resetStore } = vi.hoisted(() => {
  let store = new Map<string, { value: string; ttl: number; expiresAt: number }>()

  return {
    mockRedisClient: {
      status: "ready",
      setex: vi.fn(async (key: string, ttl: number, value: string) => {
        store.set(key, { value, ttl, expiresAt: Date.now() + ttl * 1000 })
        return "OK"
      }),
      get: vi.fn(async (key: string) => {
        const entry = store.get(key)
        if (!entry || Date.now() > entry.expiresAt) {
          store.delete(key)
          return null
        }
        return entry.value
      }),
      del: vi.fn(async (key: string) => {
        store.delete(key)
        return 1
      }),
    },
    resetStore: () => {
      store = new Map()
    },
  }
})

let mockRedisAvailable = true
vi.mock("@/lib/redis", () => ({
  getClient: vi.fn(() => (mockRedisAvailable ? mockRedisClient : null)),
  cacheSet: vi.fn(),
  cacheGet: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────

import { storePayload, getPayload } from "../push-store"

describe("push-store", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRedisAvailable = true
    resetStore()
  })

  // ── storePayload ──────────────────────────────────────────────────────────

  describe("storePayload", () => {
    it("armazena payload no Redis quando disponível", async () => {
      const payload = { title: "Test", body: "Hello", url: "/" }
      const id = await storePayload(payload)

      expect(id).toBeDefined()
      expect(id.length).toBeGreaterThanOrEqual(16)
      expect(mockRedisClient.setex).toHaveBeenCalled()
      expect(mockRedisClient.setex.mock.calls[0][0]).toContain("push:payload:")
      expect(mockRedisClient.setex.mock.calls[0][1]).toBe(300) // 5 min TTL
    })

    it("armazena em memória quando Redis está indisponível", async () => {
      mockRedisAvailable = false
      const payload = { title: "Test", body: "Memory fallback" }
      const id = await storePayload(payload)

      expect(id).toBeDefined()
      expect(id.length).toBeGreaterThanOrEqual(16)
    })

    it("retorna ID único a cada chamada", async () => {
      const id1 = await storePayload({ a: 1 })
      const id2 = await storePayload({ b: 2 })

      expect(id1).not.toBe(id2)
    })
  })

  // ── getPayload ────────────────────────────────────────────────────────────

  describe("getPayload", () => {
    it("recupera payload do Redis após store", async () => {
      const original = { title: "Test Title", body: "Test Body", url: "/test" }
      const id = await storePayload(original)

      const retrieved = await getPayload(id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.title).toBe("Test Title")
      expect(retrieved!.body).toBe("Test Body")
      expect(retrieved!.url).toBe("/test")
    })

    it("recupera payload da memória quando Redis indisponível", async () => {
      mockRedisAvailable = false
      const original = { title: "Memory", body: "Fallback" }
      const id = await storePayload(original)

      const retrieved = await getPayload(id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.title).toBe("Memory")
      expect(retrieved!.body).toBe("Fallback")
    })

    it("retorna null para ID inexistente", async () => {
      const result = await getPayload("nonexistent-id-12345")
      expect(result).toBeNull()
    })

    it("deleta payload após leitura (one-time access)", async () => {
      const payload = { title: "One Time" }
      const id = await storePayload(payload)

      await getPayload(id) // First read — succeeds
      const second = await getPayload(id) // Second read — should be deleted

      expect(second).toBeNull()
    })

    it("retorna null para payload expirado", async () => {
      mockRedisAvailable = true

      // Store a payload with a key that looks expired
      const payload = { title: "Expired" }
      const id = await storePayload(payload)

      // Verify it works initially
      const first = await getPayload(id)
      expect(first).not.toBeNull()

      // After first read it's deleted, so second read returns null
      const second = await getPayload(id)
      expect(second).toBeNull()
    })
  })
})
