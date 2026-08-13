/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * sql-builder.test.ts
 *
 * Unit tests for src/lib/sql-builder.ts — pure SQL clause builder for
 * the providers search pipeline.
 *
 * The function is pure (no I/O), so all tests run without mocks.
 */

import { describe, it, expect } from "vitest"
import { buildProviderWhereClause } from "../sql-builder"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strip(str: string): string {
  return str.replace(/\s+/g, " ").trim()
}

// ---------------------------------------------------------------------------
// Base filters (always present)
// ---------------------------------------------------------------------------

describe("buildProviderWhereClause — base filters", () => {
  it("returns base filters when called with empty options", () => {
    const [sql, params] = buildProviderWhereClause({})

    expect(sql).toContain("u.role = 'PROVIDER'")
    expect(sql).toContain("u.active = true")
    expect(sql).toContain("u.verified = true")
    expect(sql).toContain('u."deletedAt" IS NULL')
    expect(params).toEqual([])
  })

  it("does not include any optional filters when no opts are given", () => {
    const [sql] = buildProviderWhereClause({})

    expect(sql).not.toContain("ST_DWithin")
    expect(sql).not.toContain("search_vector")
    expect(sql).not.toContain("EXISTS")
  })

  it("returns empty params when only base filters", () => {
    const [, params] = buildProviderWhereClause({})
    expect(params).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// PostGIS radius filter
// ---------------------------------------------------------------------------

describe("buildProviderWhereClause — PostGIS radius", () => {
  it("adds ST_DWithin clause with correct radius in meters", () => {
    const [sql, params] = buildProviderWhereClause({
      centerGeo: { lat: -23.5505, lng: -46.6333, radiusKm: 10 },
    })

    expect(sql).toContain("u.location IS NOT NULL")
    expect(sql).toContain("ST_DWithin")
    // 10 km → 10000 m
    expect(sql).toContain("10000")
    expect(strip(sql)).toMatch(/ST_DWithin\(/i)
  })

  it("passes lng as $1 and lat as $2", () => {
    const [, params] = buildProviderWhereClause({
      centerGeo: { lat: -23.5505, lng: -46.6333, radiusKm: 10 },
    })

    expect(params[0]).toBe(-46.6333) // lng
    expect(params[1]).toBe(-23.5505) // lat
  })

  it("converts radiusKm to meters (25 km → 25000)", () => {
    const [sql] = buildProviderWhereClause({
      centerGeo: { lat: 0, lng: 0, radiusKm: 25 },
    })

    expect(sql).toContain("25000")
  })

  it("converts radiusKm to meters (0 km → 0)", () => {
    const [sql] = buildProviderWhereClause({
      centerGeo: { lat: 0, lng: 0, radiusKm: 0 },
    })

    // ST_DWithin(..., 0) — zero radius, matches nothing
    expect(sql).toContain("ST_DWithin")
    expect(sql).toContain(", 0)")
  })

  it("uses $1 and $2 for lng/lat parameters", () => {
    const [sql] = buildProviderWhereClause({
      centerGeo: { lat: -23.55, lng: -46.63, radiusKm: 5 },
    })

    expect(sql).toContain("ST_MakePoint($1, $2)")
  })
})

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

describe("buildProviderWhereClause — full-text search", () => {
  it("adds to_tsquery with sanitized single-word query", () => {
    const [sql, params] = buildProviderWhereClause({
      q: "eletricista",
    })

    expect(sql).toContain("search_vector")
    expect(sql).toContain("to_tsquery")
    expect(params).toHaveLength(1)
    // Single word → "eletricista:*"
    expect(params[0]).toBe("eletricista:*")
  })

  it("converts multi-word query to tsquery AND format", () => {
    const [sql, params] = buildProviderWhereClause({
      q: "eletricista residencial",
    })

    expect(sql).toContain("search_vector")
    expect(params).toHaveLength(1)
    expect(params[0]).toBe("eletricista:* & residencial:*")
  })

  it("sanitizes special characters", () => {
    const [sql, params] = buildProviderWhereClause({
      q: "eletricista! @#$% industrial!!",
    })

    // Special chars replaced with spaces, then trimmed and joined
    expect(sql).toContain("search_vector")
    expect(params).toHaveLength(1)
    expect(params[0]).toBe("eletricista:* & industrial:*")
  })

  it("sanitizes HTML-like characters", () => {
    const [sql, params] = buildProviderWhereClause({
      q: "<script>alert('xss')</script>",
    })

    // Only alphanumeric + spaces + accented chars survive
    expect(params).toHaveLength(1)
    // Split removes all non-alpha: "script", "alert", "xss", "script"
    expect(params[0]).toBe("script:* & alert:* & xss:* & script:*")
  })

  it("keeps accented characters (À-ÿ)", () => {
    const [sql, params] = buildProviderWhereClause({
      q: "eletricista são paulo",
    })

    expect(sql).toContain("search_vector")
    expect(params).toHaveLength(1)
    expect(params[0]).toBe("eletricista:* & são:* & paulo:*")
  })

  it("does not add tsquery when query is empty after sanitization", () => {
    const [sql] = buildProviderWhereClause({
      q: "   !!!   ",
    })

    // Only special chars → sanitized to empty → no search filter
    expect(sql).not.toContain("search_vector")
  })

  it("does not add tsquery for undefined q", () => {
    const [sql] = buildProviderWhereClause({})

    expect(sql).not.toContain("search_vector")
  })

  it("does not add tsquery for empty string q", () => {
    const [sql] = buildProviderWhereClause({ q: "" })

    expect(sql).not.toContain("search_vector")
  })
})

// ---------------------------------------------------------------------------
// Category filter
// ---------------------------------------------------------------------------

describe("buildProviderWhereClause — category filter", () => {
  it("adds EXISTS subquery for single category ID", () => {
    const [sql, params] = buildProviderWhereClause({
      categoryIds: ["cat-1"],
    })

    expect(sql).toContain("EXISTS")
    // No radius/search before category → params start at $1
    expect(sql).toContain('s."categoryId" IN ($1)')
    expect(params).toEqual(["cat-1"])
  })

  it("adds EXISTS subquery for multiple category IDs", () => {
    const [sql, params] = buildProviderWhereClause({
      categoryIds: ["cat-1", "cat-2", "cat-3"],
    })

    expect(sql).toContain("EXISTS")
    // No radius/search before category → params start at $1, $2, $3
    expect(sql).toContain('s."categoryId" IN ($1,$2,$3)')
    expect(params).toEqual(["cat-1", "cat-2", "cat-3"])
  })

  it("does not add EXISTS when categoryIds is empty array", () => {
    const [sql] = buildProviderWhereClause({
      categoryIds: [],
    })

    expect(sql).not.toContain("EXISTS")
  })

  it("does not add EXISTS when categoryIds is undefined", () => {
    const [sql] = buildProviderWhereClause({})

    expect(sql).not.toContain("EXISTS")
  })

  it("references Service table with active flag", () => {
    const [sql] = buildProviderWhereClause({
      categoryIds: ["cat-1"],
    })

    expect(sql).toContain('FROM "Service" s')
    expect(sql).toContain('s."providerId" = u.id')
    expect(sql).toContain("s.active = true")
  })
})

// ---------------------------------------------------------------------------
// Combined filters
// ---------------------------------------------------------------------------

describe("buildProviderWhereClause — combined filters", () => {
  it("combines base + radius + search + category with correct param indices", () => {
    const [sql, params] = buildProviderWhereClause({
      categoryIds: ["cat-a", "cat-b"],
      q: "pintor",
      centerGeo: { lat: -23.55, lng: -46.63, radiusKm: 5 },
    })

    // Base filters: role, active, verified, deletedAt → 4 conditions
    // Radius: location IS NOT NULL + ST_DWithin($1, $2, 5000) → $1=lng, $2=lat
    // Search: to_tsquery('portuguese', $3) → $3="pintor:*"
    // Category: EXISTS (... $4,$5 ...) → $4=cat-a, $5=cat-b

    expect(sql).toContain("ST_MakePoint($1, $2)")
    expect(sql).toContain("to_tsquery('portuguese', $3)")
    expect(sql).toContain("IN ($4,$5)")

    expect(params[0]).toBe(-46.63) // $1 = lng
    expect(params[1]).toBe(-23.55) // $2 = lat
    expect(params[2]).toBe("pintor:*") // $3 = search
    expect(params[3]).toBe("cat-a") // $4
    expect(params[4]).toBe("cat-b") // $5
  })

  it("combines radius + search (no category)", () => {
    const [, params] = buildProviderWhereClause({
      q: "encanador",
      centerGeo: { lat: -23.55, lng: -46.63, radiusKm: 10 },
    })

    // $1 = lng, $2 = lat, $3 = search
    expect(params).toHaveLength(3)
    expect(params[0]).toBe(-46.63)
    expect(params[1]).toBe(-23.55)
    expect(params[2]).toBe("encanador:*")
  })

  it("combines radius + category (no search)", () => {
    const [, params] = buildProviderWhereClause({
      categoryIds: ["cat-x"],
      centerGeo: { lat: -23.55, lng: -46.63, radiusKm: 10 },
    })

    // $1 = lng, $2 = lat, $3 = cat-x
    expect(params).toHaveLength(3)
    expect(params[2]).toBe("cat-x")
  })

  it("combines search + category (no radius)", () => {
    const [, params] = buildProviderWhereClause({
      categoryIds: ["cat-y"],
      q: "marceneiro",
    })

    // No radius → $1 = search, $2 = cat-y
    expect(params).toHaveLength(2)
    expect(params[0]).toBe("marceneiro:*")
    expect(params[1]).toBe("cat-y")
  })

  it("all conditions are AND-joined", () => {
    const [sql] = buildProviderWhereClause({
      categoryIds: ["cat-1"],
      q: "teste",
      centerGeo: { lat: 0, lng: 0, radiusKm: 5 },
    })

    // Count AND occurrences — the EXISTS subquery contains internal ANDs too
    const ands = (sql.match(/\bAND\b/g) ?? []).length
    // 4 base + 2 radius + 1 search + 1 EXISTS + 2 internal-EXISTS = 10 AND occurrences
    // This validates the conditions are AND-joined, not OR-joined
    expect(ands).toBeGreaterThanOrEqual(7)
  })
})

// ---------------------------------------------------------------------------
// centerGeo = null
// ---------------------------------------------------------------------------

describe("buildProviderWhereClause — no centerGeo", () => {
  it("does not add spatial filter when centerGeo is null", () => {
    const [sql] = buildProviderWhereClause({
      centerGeo: null,
      q: "teste",
    })

    expect(sql).not.toContain("ST_DWithin")
    expect(sql).not.toContain("u.location")
  })

  it("does not add spatial filter when centerGeo is undefined", () => {
    const [sql] = buildProviderWhereClause({
      q: "teste",
    })

    expect(sql).not.toContain("ST_DWithin")
  })

  it("search + category without centerGeo uses $1 for search and $2+ for categories", () => {
    const [, params] = buildProviderWhereClause({
      categoryIds: ["cat-a", "cat-b", "cat-c"],
      q: "jardineiro",
      centerGeo: null,
    })

    // No radius → $1 = search, $2,$3,$4 = categories
    expect(params[0]).toBe("jardineiro:*")
    expect(params[1]).toBe("cat-a")
    expect(params[2]).toBe("cat-b")
    expect(params[3]).toBe("cat-c")
  })
})

// ---------------------------------------------------------------------------
// Return type shape
// ---------------------------------------------------------------------------

describe("buildProviderWhereClause — return type", () => {
  it("returns a tuple of [string, unknown[]]", () => {
    const result = buildProviderWhereClause({})
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
    expect(typeof result[0]).toBe("string")
    expect(Array.isArray(result[1])).toBe(true)
  })

  it("returns a valid SQL fragment (starts with a condition, not WHERE)", () => {
    const [sql] = buildProviderWhereClause({})
    // The returned string is the body of a WHERE clause, without the WHERE keyword
    expect(sql).toMatch(/^u\.role = 'PROVIDER'/)
    // Can be embedded: `SELECT ... WHERE ${sql}`
    expect(sql).not.toMatch(/^WHERE /i)
  })
})
