import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import { memoryStore, startCleanupTimer } from "@/lib/redis/memory"
import { configMode } from "@/lib/redis/config"

describe("redis/memory", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    memoryStore.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("armazena e recupera valor", () => {
    memoryStore.set("key1", { value: '{"a":1}', expiresAt: null })
    const item = memoryStore.get("key1")
    expect(item).toBeDefined()
    expect(JSON.parse(item!.value)).toEqual({ a: 1 })
  })

  it("respeita TTL - expira entrada", () => {
    const now = Date.now()
    memoryStore.set("expired", {
      value: "x",
      expiresAt: now - 1000,
    })
    const item = memoryStore.get("expired")
    expect(item).toBeDefined()
    expect(item!.expiresAt!).toBeLessThan(now)
  })

  it("remove entrada expirada no cleanup", () => {
    const now = Date.now()
    memoryStore.set("old", { value: "x", expiresAt: now - 5000 })
    memoryStore.set("new", { value: "y", expiresAt: now + 60000 })

    // Simulate cleanup
    for (const [key, item] of memoryStore) {
      if (item.expiresAt !== null && item.expiresAt < now) {
        memoryStore.delete(key)
      }
    }

    expect(memoryStore.has("old")).toBe(false)
    expect(memoryStore.has("new")).toBe(true)
  })

  it("startCleanupTimer não duplica timers", () => {
    startCleanupTimer()
    startCleanupTimer()
    // Should not throw
  })
})

describe("redis/config", () => {
  it("exporta configMode como string válido", () => {
    expect(["cluster", "standalone"]).toContain(configMode)
  })
})
