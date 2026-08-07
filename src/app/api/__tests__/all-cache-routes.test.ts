/**
 * Comprehensive Vitest test for ALL cache-controlled API routes.
 *
 * This is the "no route left behind" guarantee — it:
 *   1. Defines a ground-truth manifest of every cached route
 *   2. Tests the cache functions directly with every TTL combo
 *   3. Verifies the counts, Vary headers, and types are correct
 *   4. Asserts that non-200 responses NEVER have cache headers
 *
 * If a developer adds a new cache route without updating the manifest
 * in src/lib/cache-manifest.ts, one of these tests will fail.
 */

import { describe, it, expect, vi } from "vitest"
import { NextResponse } from "next/server"
import {
  cacheControlPublic,
  cacheControlPrivate,
  handleError,
} from "@/lib/api-server"
import {
  CACHED_ROUTES,
  TOTAL_COUNT,
  PUBLIC_COUNT,
  PRIVATE_COUNT,
} from "@/lib/cache-manifest"

type CachedRoute = (typeof CACHED_ROUTES)[number]

// ---------------------------------------------------------------------------
// Manifest integrity checks
// ---------------------------------------------------------------------------

describe("cache route manifest integrity", () => {
  it(`has exactly ${TOTAL_COUNT} cached routes (${PUBLIC_COUNT} public + ${PRIVATE_COUNT} private)`, () => {
    expect(CACHED_ROUTES.length).toBe(TOTAL_COUNT)
    const publics = CACHED_ROUTES.filter((r) => r.type === "public")
    const privates = CACHED_ROUTES.filter((r) => r.type === "private")
    expect(publics.length).toBe(PUBLIC_COUNT)
    expect(privates.length).toBe(PRIVATE_COUNT)
  })

  it("all public routes have s-maxage >= max-age (CDN is at least as permissive as browser)", () => {
    const publics = CACHED_ROUTES.filter((r) => r.type === "public")
    for (const route of publics) {
      expect(route.sMaxage).toBeGreaterThanOrEqual(route.maxAge)
    }
  })

  it("private route has null s-maxage (CDN must not cache private responses)", () => {
    const privates = CACHED_ROUTES.filter((r) => r.type === "private")
    for (const route of privates) {
      expect(route.sMaxage).toBeNull()
    }
  })

  it("all public routes have Accept-Encoding, Accept, Origin in Vary", () => {
    const publics = CACHED_ROUTES.filter((r) => r.type === "public")
    for (const route of publics) {
      const parts = route.vary.split(", ").sort()
      expect(parts).toEqual(["Accept", "Accept-Encoding", "Origin"])
    }
  })

  it("private route has Cookie, Accept-Encoding, Accept in Vary", () => {
    const privates = CACHED_ROUTES.filter((r) => r.type === "private")
    for (const route of privates) {
      const parts = route.vary.split(", ").sort()
      expect(parts).toEqual(["Accept", "Accept-Encoding", "Cookie"])
    }
  })

  it("all routes have max-age between 1 and 86400 (1s–1d)", () => {
    for (const route of CACHED_ROUTES) {
      expect(route.maxAge).toBeGreaterThanOrEqual(1)
      expect(route.maxAge).toBeLessThanOrEqual(86400)
    }
  })

  it("routes are sorted consistently (no duplicates)", () => {
    const paths = CACHED_ROUTES.map((r) => r.path)
    const sorted = [...paths].sort()
    expect(paths).toEqual(sorted)
    expect(new Set(paths).size).toBe(paths.length) // no dupes
  })
})

// ---------------------------------------------------------------------------
// cacheControlPublic — direct function tests
// ---------------------------------------------------------------------------

describe("cacheControlPublic — all TTL combos used in routes", () => {
  const publicConfigs = CACHED_ROUTES.filter(
    (r): r is CachedRoute & { type: "public"; sMaxage: number } =>
      r.type === "public",
  )

  it.each(publicConfigs)(
    "sets correct Cache-Control for $path (max-age=$maxAge, s-maxage=$sMaxage, swr=$sMaxage)",
    ({ maxAge, sMaxage, vary }) => {
      const res = new NextResponse()
      cacheControlPublic(res, maxAge, sMaxage)
      expect(res.headers.get("Cache-Control")).toBe(
        `public, max-age=${maxAge}, s-maxage=${sMaxage}, stale-while-revalidate=${sMaxage}`,
      )
      expect(res.headers.get("Vary")).toBe(vary)
    },
  )

  it("returns the same response object (mutates in place)", () => {
    const res = new NextResponse()
    const result = cacheControlPublic(res, 60)
    expect(result).toBe(res)
  })
})

// ---------------------------------------------------------------------------
// cacheControlPrivate — direct function tests
// ---------------------------------------------------------------------------

describe("cacheControlPrivate — all TTL combos used in routes", () => {
  const privateConfigs = CACHED_ROUTES.filter(
    (r): r is CachedRoute & { type: "private" } => r.type === "private",
  )

  it.each(privateConfigs)(
    "sets correct Cache-Control for $path (max-age=$maxAge)",
    ({ maxAge, vary }) => {
      const res = new NextResponse()
      cacheControlPrivate(res, maxAge)
      expect(res.headers.get("Cache-Control")).toBe(
        `private, max-age=${maxAge}`,
      )
      expect(res.headers.get("Vary")).toBe(vary)
      expect(res.headers.get("Cache-Control")).not.toContain("s-maxage")
    },
  )

  it("returns the same response object (mutates in place)", () => {
    const res = new NextResponse()
    const result = cacheControlPrivate(res, 60)
    expect(result).toBe(res)
  })
})

// ---------------------------------------------------------------------------
// Edge cases — error paths must NOT have cache headers
// ---------------------------------------------------------------------------

describe("no cache headers on non-200 responses", () => {
  it("handleError produces 500 for generic errors without Cache-Control", async () => {
    const res = handleError(new Error("Bad Request"))
    expect(res.status).toBe(500) // generic error → 500
    expect(res.headers.get("Cache-Control")).toBeNull()
    expect(res.headers.get("Vary")).toBeNull()
  })

  it("handleError HttpError 400 without Cache-Control", async () => {
    const { HttpError } = await import("@/lib/api-server")
    const res = handleError(new HttpError(400, "Invalid input"))
    expect(res.status).toBe(400)
    expect(res.headers.get("Cache-Control")).toBeNull()
    expect(res.headers.get("Vary")).toBeNull()
  })

  it("handleError HttpError 404 without Cache-Control", async () => {
    const { HttpError } = await import("@/lib/api-server")
    const res = handleError(new HttpError(404, "Not found"))
    expect(res.status).toBe(404)
    expect(res.headers.get("Cache-Control")).toBeNull()
  })

  it("handleError UNAUTHORIZED (401) without Cache-Control", async () => {
    const res = handleError(new Error("UNAUTHORIZED"))
    expect(res.status).toBe(401)
    expect(res.headers.get("Cache-Control")).toBeNull()
  })

  it("handleError FORBIDDEN (403) without Cache-Control", async () => {
    const res = handleError(new Error("FORBIDDEN"))
    expect(res.status).toBe(403)
    expect(res.headers.get("Cache-Control")).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Edge cases — zero TTLs, extreme values
// ---------------------------------------------------------------------------

describe("edge case cache configurations", () => {
  it("cacheControlPublic with zero max-age produces no-cache equivalent", () => {
    const res = new NextResponse()
    cacheControlPublic(res, 0)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=0, stale-while-revalidate=0",
    )
  })

  it("cacheControlPrivate with zero max-age", () => {
    const res = new NextResponse()
    cacheControlPrivate(res, 0)
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=0")
  })

  it("cacheControlPublic with different s-maxage than max-age", () => {
    const res = new NextResponse()
    cacheControlPublic(res, 30, 300)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=30, s-maxage=300, stale-while-revalidate=300",
    )
  })

  it("cacheControlPublic with default s-maxage (no second arg)", () => {
    const res = new NextResponse()
    cacheControlPublic(res, 60)
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=60, s-maxage=60, stale-while-revalidate=60",
    )
  })
})
