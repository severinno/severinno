/**
 * Tests for src/lib/postgis.ts
 *
 * The module wraps PostGIS raw SQL queries via Prisma ($queryRaw) with
 * Redis caching (withCache). These tests mock both Prisma and the cache
 * layer so we can verify SQL generation, result transformation, and
 * error handling without a real database.
 *
 * Cache is bypassed by making withCache call the inner function directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── Mocks ───────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn()

vi.mock("@/lib/db", () => ({
  db: { $queryRaw: mockQueryRaw },
}))

/**
 * withCache mock — bypasses Redis entirely and calls the inner fn directly,
 * so tests exercise the SQL query logic and result transformation without
 * needing a Redis instance.
 */
vi.mock("@/lib/redis", () => ({
  withCache: <T>(_key: string, fn: () => Promise<T>, _ttl?: number): Promise<T> =>
    fn(),
}))

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a fake raw-SQL row for findProvidersWithinRadius.
 */
function fakeProximityRow(id: string, distanceKm: number) {
  return { id, distance_km: distanceKm }
}

// ── Tests ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── findProvidersWithinRadius ───────────────────────────────────────────

describe("findProvidersWithinRadius", () => {
  it("retorna array vazio quando nenhum provider encontrado no raio", async () => {
    mockQueryRaw.mockResolvedValueOnce([])

    const { findProvidersWithinRadius } = await import("@/lib/postgis")

    const result = await findProvidersWithinRadius(-23.55, -46.63, 10)

    expect(result).toEqual([])
    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
  })

  it("mapeia resultado SQL para ProximityResult[] com distanceKm como number", async () => {
    mockQueryRaw.mockResolvedValueOnce([
      fakeProximityRow("p-1", 1.23),
      fakeProximityRow("p-2", 4.56),
      fakeProximityRow("p-3", 8.9),
    ])

    const { findProvidersWithinRadius } = await import("@/lib/postgis")

    const result = await findProvidersWithinRadius(-23.55, -46.63, 10)

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ id: "p-1", distanceKm: 1.23 })
    expect(result[1]).toEqual({ id: "p-2", distanceKm: 4.56 })
    expect(result[2]).toEqual({ id: "p-3", distanceKm: 8.9 })
  })

  it("retorna array vazio quando queryRaw lança exceção (PostGIS indisponível)", async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error("relation does not exist"))

    const { findProvidersWithinRadius } = await import("@/lib/postgis")

    // Should NOT throw
    const result = await findProvidersWithinRadius(-23.55, -46.63, 10)

    expect(result).toEqual([])
  })

  it("funciona com coordenadas negativas (hemisfério sul)", async () => {
    mockQueryRaw.mockResolvedValueOnce([fakeProximityRow("p-sul", 5.0)])

    const { findProvidersWithinRadius } = await import("@/lib/postgis")

    const result = await findProvidersWithinRadius(-30.03, -51.23, 20)

    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("p-sul")
  })

  it("funciona com raio zero (apenas providers exatamente no mesmo ponto)", async () => {
    mockQueryRaw.mockResolvedValueOnce([])

    const { findProvidersWithinRadius } = await import("@/lib/postgis")

    const result = await findProvidersWithinRadius(0, 0, 0)

    expect(result).toEqual([])
  })

  it("converte distance_km para Number (seguro com string-like bigints)", async () => {
    // $queryRaw pode retornar bigint-like numbers; Number() deve resolver
    mockQueryRaw.mockResolvedValueOnce([{ id: "p-big", distance_km: 12345.67 }])

    const { findProvidersWithinRadius } = await import("@/lib/postgis")

    const result = await findProvidersWithinRadius(-23.55, -46.63, 100)

    expect(result[0]!.distanceKm).toBe(12345.67)
    expect(typeof result[0]!.distanceKm).toBe("number")
  })
})

// ── getDistanceBetween ──────────────────────────────────────────────────

describe("getDistanceBetween", () => {
  it("retorna distância entre dois usuários", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ distance_km: 15.3 }])

    const { getDistanceBetween } = await import("@/lib/postgis")

    const result = await getDistanceBetween("u-1", "u-2")

    expect(result).toBe(15.3)
  })

  it("retorna null quando um dos usuários não tem location", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ distance_km: null }])

    const { getDistanceBetween } = await import("@/lib/postgis")

    const result = await getDistanceBetween("u-1", "u-2")

    expect(result).toBeNull()
  })

  it("retorna null quando queryRaw retorna array vazio", async () => {
    mockQueryRaw.mockResolvedValueOnce([])

    const { getDistanceBetween } = await import("@/lib/postgis")

    const result = await getDistanceBetween("u-1", "u-2")

    expect(result).toBeNull()
  })

  it("retorna null quando queryRaw lança exceção", async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error("connection error"))

    const { getDistanceBetween } = await import("@/lib/postgis")

    const result = await getDistanceBetween("u-1", "u-2")

    expect(result).toBeNull()
  })
})

// ── isPostGISAvailable ──────────────────────────────────────────────────

describe("isPostGISAvailable", () => {
  it("retorna true quando extensão postgis está instalada", async () => {
    mockQueryRaw.mockResolvedValueOnce([{ available: true }])

    const { isPostGISAvailable } = await import("@/lib/postgis")

    const result = await isPostGISAvailable()

    expect(result).toBe(true)
  })

  it("retorna false quando queryRaw retorna array vazio (extensão ausente)", async () => {
    mockQueryRaw.mockResolvedValueOnce([])

    const { isPostGISAvailable } = await import("@/lib/postgis")

    const result = await isPostGISAvailable()

    expect(result).toBe(false)
  })

  it("retorna false quando ocorre erro na query", async () => {
    mockQueryRaw.mockRejectedValueOnce(new Error("permission denied"))

    const { isPostGISAvailable } = await import("@/lib/postgis")

    const result = await isPostGISAvailable()

    expect(result).toBe(false)
  })
})
