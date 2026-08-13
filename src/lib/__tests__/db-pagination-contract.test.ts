import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"

/**
 * db-pagination-contract.test.ts
 *
 * Shape-guard contract pin of the scale-risk #1 closing
 * (melhorias-otimizacoes.md item 1): every provider LISTING surface filters
 * and paginates in the DB (PostGIS ST_DWithin + LIMIT/OFFSET), and distances
 * come from the DB (ST_Distance batch) — never re-introducing the old
 * "fetch-all + per-item in-memory Haversine" pattern.
 *
 * Reads the SOURCE of the 3 listing surfaces (house shape-guard style,
 * mirroring scan-exit-claims / source-slices-contract). A refactor that
 * reverts any surface to the in-memory pattern fails here with the exact
 * surface named.
 */

const read = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")

const sqlBuilder = read("src/lib/sql-builder.ts")
const providersRoute = read("src/app/api/providers/route.ts")
const favoritesRoute = read("src/app/api/favorites/route.ts")
const coverage = read("src/lib/coverage.ts")

describe("DB pagination contract — scale risk #1", () => {
  // -----------------------------------------------------------------------
  // Public catalog listing (GET /api/providers) — the 1000+ surface
  // -----------------------------------------------------------------------

  it("providers pipeline filters the radius via PostGIS ST_DWithin (in the WHERE builder)", () => {
    // The ST_DWithin WHERE clause lives in the shared builder that the route
    // imports for Phase 1 (COUNT, ID resolution, unrestricted fallback).
    expect(sqlBuilder).toContain("ST_DWithin")
  })

  it("providers listing paginates in the DB via LIMIT/OFFSET with skip/take", () => {
    expect(providersRoute).toContain("LIMIT")
    expect(providersRoute).toContain("OFFSET")
    expect(providersRoute).toContain("take")
    expect(providersRoute).toContain("skip")
  })

  it("providers listing sorts by distance in the DB (ST_Distance) and has no in-memory haversine", () => {
    expect(providersRoute).toContain("ST_Distance")
    expect(providersRoute).not.toContain("haversineKm")
  })

  // -----------------------------------------------------------------------
  // Favorites listing (GET /api/favorites)
  // -----------------------------------------------------------------------

  it("favorites distances are DB-first via computeDistanceMap (no per-item haversine loop)", () => {
    expect(favoritesRoute).toContain("computeDistanceMap")
    expect(favoritesRoute).not.toContain("haversineKm")
  })

  // -----------------------------------------------------------------------
  // Coverage listing (getProvidersInCoverage)
  // -----------------------------------------------------------------------

  it("coverage listing filters by ST_DWithin in a single query (no fetch-all + in-memory filter)", () => {
    expect(coverage).toContain("ST_DWithin")
    // The migrated function must not re-introduce a Prisma findMany fetch-all
    const fn = coverage.slice(coverage.indexOf("getProvidersInCoverage"))
    expect(fn).not.toContain("findMany")
    expect(fn).toContain("ST_DWithin")
    expect(fn).toContain("ST_Distance")
  })
})
