import { describe, it, expect, vi, beforeEach } from "vitest"
import { isInCoverage, getProvidersInCoverage } from "../coverage"

/**
 * coverage.test.ts
 *
 * - isInCoverage: pure single-point check (O(1), no I/O).
 * - getProvidersInCoverage: DB-first contract — a SINGLE PostGIS ST_DWithin
 *   query filters by each provider's own radiusKm and orders by ST_Distance.
 *   The old fetch-all + in-memory Haversine loop is gone (scale-risk #1
 *   closing, pinned also by db-pagination-contract).
 */

const { mockQueryRaw } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  db: { $queryRaw: mockQueryRaw },
}))

describe("isInCoverage", () => {
  it("valid point inside coverage area", () => {
    const result = isInCoverage(-23.55, -46.63, 10, -23.54, -46.62)
    expect(result).toBe(true)
  })

  it("valid point outside coverage area", () => {
    const result = isInCoverage(-23.55, -46.63, 5, -23.4, -46.5)
    expect(result).toBe(false)
  })

  it("returns false for zero radius", () => {
    const result = isInCoverage(-23.55, -46.63, 0, -23.54, -46.62)
    expect(result).toBe(false)
  })
})

describe("getProvidersInCoverage — DB-first ST_DWithin contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns DB values and DB order as-is (the ORDER BY lives in the DB, no in-memory re-sort)", async () => {
    mockQueryRaw.mockResolvedValue([
      { id: "p2", name: "Maria", distance_km: 2.345 },
      { id: "p1", name: "João", distance_km: 0.5 },
    ])

    const result = await getProvidersInCoverage(-23.55, -46.63)

    // The JS maps rows without re-sorting - the order is the DB's own
    // (ORDER BY distance_km ASC). Distance rounded to 2 decimals.
    expect(result).toEqual([
      { id: "p2", name: "Maria", distanceKm: 2.35 },
      { id: "p1", name: "João", distanceKm: 0.5 },
    ])
  })

  it("runs a single query carrying ST_DWithin and ST_Distance (no in-memory loop)", async () => {
    mockQueryRaw.mockResolvedValue([])

    await getProvidersInCoverage(-23.55, -46.63)

    expect(mockQueryRaw).toHaveBeenCalledTimes(1)
    // Tagged template: first arg is the strings array; join to inspect the SQL
    const strings = mockQueryRaw.mock.calls[0][0] as string[]
    const sql = strings.join("?")
    expect(sql).toContain("ST_DWithin")
    expect(sql).toContain("ST_Distance")
    expect(sql).toContain("radiusKm")
  })

  it("returns empty array when no provider covers the point", async () => {
    mockQueryRaw.mockResolvedValue([])

    const result = await getProvidersInCoverage(-23.55, -46.63)

    expect(result).toEqual([])
  })
})
