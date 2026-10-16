import { describe, it, expect, beforeEach, vi } from "vitest"
import { edgeCache, buildEdgeCacheHeaders } from "../edge-catalog-cache"

describe("edge-catalog-cache", () => {
  beforeEach(() => {
    edgeCache.clear()
  })

  it("retorna ORIGIN_FETCH no primeiro acesso e L1_FRESH no segundo", async () => {
    let callCount = 0
    const mockFetcher = async () => {
      callCount++
      return [{ id: 1, name: "Eletricista" }]
    }

    // 1º acesso (MISS -> ORIGIN_FETCH)
    const first = await edgeCache.getOrFetch("test:categories", mockFetcher, { ttlSeconds: 10 })
    expect(first.source).toBe("ORIGIN_FETCH")
    expect(first.data).toHaveLength(1)
    expect(callCount).toBe(1)

    // 2º acesso (HIT -> L1_FRESH)
    const second = await edgeCache.getOrFetch("test:categories", mockFetcher, { ttlSeconds: 10 })
    expect(second.source).toBe("L1_FRESH")
    expect(second.data).toEqual(first.data)
    expect(callCount).toBe(1) // Não chamou a origem novamente
  })

  it("retorna SWR_STALE e revalida em background quando expirado dentro da janela SWR", async () => {
    let value = 100
    const mockFetcher = vi.fn(async () => ++value)

    // Grava com TTL expirado mas dentro da janela SWR
    edgeCache.set("test:swr", 100, { ttlSeconds: -1, swrSeconds: 60 })

    const res = await edgeCache.getOrFetch("test:swr", mockFetcher, {
      ttlSeconds: 5,
      swrSeconds: 60,
    })

    expect(res.source).toBe("SWR_STALE")
    expect(res.data).toBe(100) // Retornou o stale imediatamente
  })

  it("invalida chaves específicas e por prefixo", () => {
    edgeCache.set("catalog:gv:centro", { count: 10 }, { ttlSeconds: 60 })
    edgeCache.set("catalog:gv:ilha", { count: 5 }, { ttlSeconds: 60 })
    edgeCache.set("user:123", { name: "Test" }, { ttlSeconds: 60 })

    const deleted = edgeCache.invalidate("catalog:gv:")
    expect(deleted).toBe(2)

    const stats = edgeCache.getStats()
    expect(stats.l1Size).toBe(1) // restou apenas user:123
  })

  it("gera cabeçalhos HTTP Cache-Control padronizados", () => {
    const headers = buildEdgeCacheHeaders(300, 900)
    expect(headers["Cache-Control"]).toBe(
      "public, s-maxage=300, stale-while-revalidate=900, max-age=60",
    )
    expect(headers["CDN-Cache-Control"]).toBe("public, max-age=300")
  })
})
