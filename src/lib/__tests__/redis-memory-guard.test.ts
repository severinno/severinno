import { describe, it, expect, vi, beforeEach } from "vitest"
import { checkRedisMemoryGuard, parseInfoSection } from "@/lib/redis-memory-guard"

vi.mock("@/lib/redis", () => ({
  ensureConnected: vi.fn(),
  activeTier: "standalone",
}))

describe("redis-memory-guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("parseInfoSection extrai corretamente chave-valor de strings INFO do Redis", () => {
    const raw = `
# Memory
used_memory:10485760
used_memory_human:10M
maxmemory:52428800
maxmemory_policy:allkeys-lru
mem_fragmentation_ratio:1.15
`
    const parsed = parseInfoSection(raw)
    expect(parsed.used_memory).toBe("10485760")
    expect(parsed.used_memory_human).toBe("10M")
    expect(parsed.maxmemory_policy).toBe("allkeys-lru")
    expect(parsed.mem_fragmentation_ratio).toBe("1.15")
  })

  it("retorna status HEALTHY quando memória está normal e chaves têm TTL", async () => {
    const mockClient = {
      info: vi.fn((section: string) => {
        if (section === "memory") {
          return Promise.resolve(`
used_memory:10485760
used_memory_human:10M
maxmemory:104857600
maxmemory_human:100M
maxmemory_policy:allkeys-lru
mem_fragmentation_ratio:1.10
`)
        }
        return Promise.resolve(`
evicted_keys:0
expired_keys:150
keyspace_hits:1200
keyspace_misses:40
`)
      }),
      scan: vi.fn().mockResolvedValueOnce(["0", ["cache:user:1", "cache:service:2"]]),
      ttl: vi.fn().mockResolvedValue(3600),
    }

    const report = await checkRedisMemoryGuard(mockClient as any)

    expect(report.status).toBe("HEALTHY")
    expect(report.memory?.usedMemoryHuman).toBe("10M")
    expect(report.memory?.memoryPressurePct).toBe(10)
    expect(report.sampleSize).toBe(2)
    expect(report.noTtlKeysCount).toBe(0)
    expect(report.warnings).toHaveLength(0)
  })

  it("alerta CRITICAL quando chaves de negócio críticas estão sem TTL sob allkeys-lru", async () => {
    const mockClient = {
      info: vi.fn((section: string) => {
        if (section === "memory") {
          return Promise.resolve(`
used_memory:20971520
used_memory_human:20M
maxmemory:104857600
maxmemory_human:100M
maxmemory_policy:allkeys-lru
mem_fragmentation_ratio:1.12
`)
        }
        return Promise.resolve(`
evicted_keys:20
expired_keys:50
keyspace_hits:800
keyspace_misses:20
`)
      }),
      scan: vi.fn().mockResolvedValueOnce(["0", ["referral:user:abc", "session:user:xyz"]]),
      ttl: vi.fn().mockResolvedValue(-1), // Sem TTL!
    }

    const report = await checkRedisMemoryGuard(mockClient as any)

    expect(report.status).toBe("CRITICAL")
    expect(report.noTtlKeysCount).toBe(2)
    expect(report.noTtlRatioPct).toBe(100)
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Detectadas chaves de negócio críticas SEM TTL"),
      ]),
    )
  })

  it("alerta CRITICAL quando pressão de memória >= 85%", async () => {
    const mockClient = {
      info: vi.fn((section: string) => {
        if (section === "memory") {
          return Promise.resolve(`
used_memory:90000000
used_memory_human:90M
maxmemory:100000000
maxmemory_human:100M
maxmemory_policy:allkeys-lru
mem_fragmentation_ratio:1.15
`)
        }
        return Promise.resolve(`
evicted_keys:1500
expired_keys:200
keyspace_hits:5000
keyspace_misses:800
`)
      }),
      scan: vi.fn().mockResolvedValueOnce(["0", []]),
      ttl: vi.fn().mockResolvedValue(100),
    }

    const report = await checkRedisMemoryGuard(mockClient as any)

    expect(report.status).toBe("CRITICAL")
    expect(report.memory?.memoryPressurePct).toBe(90)
    expect(report.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining("Pressão de memória crítica: 90%")]),
    )
  })

  it("retorna fallback gracioso quando o cliente Redis é nulo", async () => {
    const report = await checkRedisMemoryGuard(null)

    expect(report).toBeDefined()
    expect(report.status).toBe("WARNING")
    expect(report.warnings[0]).toContain("fallback de memória")
  })
})
