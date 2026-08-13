/**
 * sql-booking-builder.test.ts
 *
 * Unit tests for src/lib/sql-booking-builder.ts — pure SQL WHERE clause
 * builder for the bookings search.
 *
 * The function is pure (no I/O), so all tests run without mocks.
 */

import { describe, it, expect } from "vitest"
import { buildBookingWhereClause } from "../sql-booking-builder"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strip(str: string): string {
  return str.replace(/\s+/g, " ").trim()
}

// ---------------------------------------------------------------------------
// Base filters (always present)
// ---------------------------------------------------------------------------

describe("buildBookingWhereClause — base filters", () => {
  it("always includes the soft-delete guard", () => {
    const [sql] = buildBookingWhereClause({})
    expect(sql).toContain('b."deletedAt" IS NULL')
  })

  it("returns empty params when no options given", () => {
    const [, params] = buildBookingWhereClause({})
    expect(params).toHaveLength(0)
  })

  it("does not include any optional filters when no opts are given", () => {
    const [sql] = buildBookingWhereClause({})
    expect(sql).not.toContain("ST_DWithin")
    expect(sql).not.toContain("location")
  })
})

// ---------------------------------------------------------------------------
// Basic filters
// ---------------------------------------------------------------------------

describe("buildBookingWhereClause — basic filters", () => {
  it("filters by clientId", () => {
    const [sql, params] = buildBookingWhereClause({ clientId: "client-1" })
    expect(sql).toContain('b."clientId" = $1')
    expect(params).toEqual(["client-1"])
  })

  it("filters by providerId", () => {
    const [sql, params] = buildBookingWhereClause({ providerId: "prov-1" })
    expect(sql).toContain('b."providerId" = $1')
    expect(params).toEqual(["prov-1"])
  })

  it("filters by status", () => {
    const [sql, params] = buildBookingWhereClause({ status: "IN_PROGRESS" })
    expect(sql).toContain('b."status" = $1')
    expect(params).toEqual(["IN_PROGRESS"])
  })

  it("filters by scheduled date range", () => {
    const [sql, params] = buildBookingWhereClause({
      scheduledAfter: "2025-01-01T00:00:00Z",
      scheduledBefore: "2025-12-31T23:59:59Z",
    })
    expect(sql).toContain('b."scheduledAt" >= $1::timestamptz')
    expect(sql).toContain('b."scheduledAt" <= $2::timestamptz')
    expect(params).toHaveLength(2)
  })

  it("filters by created date range", () => {
    const [sql, params] = buildBookingWhereClause({
      createdAtAfter: "2025-01-01T00:00:00Z",
    })
    expect(sql).toContain('b."createdAt" >= $1::timestamptz')
    expect(params).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// PostGIS radius filter
// ---------------------------------------------------------------------------

describe("buildBookingWhereClause — PostGIS radius", () => {
  it("adds ST_DWithin clause on b.location with radius in meters", () => {
    const [sql, params] = buildBookingWhereClause({
      centerGeo: { lat: -23.5505, lng: -46.6333, radiusKm: 10 },
    })

    expect(sql).toContain("b.location IS NOT NULL")
    expect(strip(sql)).toContain("ST_DWithin(b.location,")
    // 10 km → 10000 m
    expect(sql).toContain("10000")
    expect(params).toHaveLength(2)
  })

  it("passes lng as first param and lat as second", () => {
    const [, params] = buildBookingWhereClause({
      centerGeo: { lat: -23.5505, lng: -46.6333, radiusKm: 10 },
    })

    expect(params[0]).toBe(-46.6333) // lng
    expect(params[1]).toBe(-23.5505) // lat
  })

  it("converts radiusKm to meters (25 km → 25000)", () => {
    const [sql] = buildBookingWhereClause({
      centerGeo: { lat: 0, lng: 0, radiusKm: 25 },
    })

    expect(sql).toContain("25000")
  })

  it("uses $1 and $2 for lng/lat when no other filters present", () => {
    const [sql] = buildBookingWhereClause({
      centerGeo: { lat: -23.55, lng: -46.63, radiusKm: 5 },
    })

    expect(sql).toContain("ST_MakePoint($1, $2)")
  })

  it("does not add spatial filter when centerGeo is null", () => {
    const [sql] = buildBookingWhereClause({
      centerGeo: null,
      status: "CONFIRMED",
    })

    expect(sql).not.toContain("ST_DWithin")
    expect(sql).not.toContain("location")
  })

  it("does not add spatial filter when centerGeo is undefined", () => {
    const [sql] = buildBookingWhereClause({ status: "CONFIRMED" })

    expect(sql).not.toContain("ST_DWithin")
  })
})

// ---------------------------------------------------------------------------
// Combined filters
// ---------------------------------------------------------------------------

describe("buildBookingWhereClause — combined filters", () => {
  it("combines status + radius with correct param indices", () => {
    const [sql, params] = buildBookingWhereClause({
      status: "IN_PROGRESS",
      centerGeo: { lat: -23.55, lng: -46.63, radiusKm: 5 },
    })

    // soft-delete guard + status($1) + location IS NOT NULL + ST_DWithin($2, $3)
    expect(sql).toContain('b."status" = $1')
    expect(sql).toContain("ST_MakePoint($2, $3)")
    expect(params[0]).toBe("IN_PROGRESS") // $1 = status
    expect(params[1]).toBe(-46.63) // $2 = lng
    expect(params[2]).toBe(-23.55) // $3 = lat
  })

  it("combines providerId + scheduledAfter + radius", () => {
    const [sql, params] = buildBookingWhereClause({
      providerId: "prov-9",
      scheduledAfter: "2025-01-01T00:00:00Z",
      centerGeo: { lat: 0, lng: 0, radiusKm: 10 },
    })

    // providerId($1) + scheduledAt($2) + location + ST_DWithin($3, $4)
    expect(sql).toContain('b."providerId" = $1')
    expect(sql).toContain('b."scheduledAt" >= $2::timestamptz')
    expect(sql).toContain("ST_MakePoint($3, $4)")
    expect(params).toHaveLength(4)
  })

  it("all conditions are AND-joined", () => {
    const [sql] = buildBookingWhereClause({
      providerId: "prov-1",
      status: "CONFIRMED",
      centerGeo: { lat: 0, lng: 0, radiusKm: 5 },
    })

    const ands = (sql.match(/\bAND\b/g) ?? []).length
    // 1 guard + providerId + status + location IS NOT NULL + ST_DWithin
    // = 5 conditions → 4 ANDs
    expect(ands).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Return type shape
// ---------------------------------------------------------------------------

describe("buildBookingWhereClause — return type", () => {
  it("returns a tuple of [string, unknown[]]", () => {
    const result = buildBookingWhereClause({})
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
    expect(typeof result[0]).toBe("string")
    expect(Array.isArray(result[1])).toBe(true)
  })

  it("returns a SQL fragment without the WHERE keyword", () => {
    const [sql] = buildBookingWhereClause({})
    expect(sql).not.toMatch(/^WHERE /i)
  })
})
