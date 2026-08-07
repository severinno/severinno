/**
 * Shared cache route manifest — single source of truth.
 *
 * Every route that uses `cacheControlPublic` or `cacheControlPrivate` MUST
 * be listed in `CACHED_ROUTES`. If you add a new cached route, add it here
 * and the change propagates to:
 *   1. The admin dashboard GET /api/admin/cache-routes
 *   2. The Vitest ground-truth validation in all-cache-routes.test.ts
 *
 * Entries are sorted alphabetically by path (no duplicates).
 */

// ── Route entry type ─────────────────────────────────────────────────────

export type CacheScope = "public" | "private"

export type CacheRouteEntry = {
  path: string
  method: "GET"
  type: CacheScope
  maxAge: number
  sMaxage: number | null  // null for private routes (CDN must not cache)
  vary: string             // Full Vary header value (e.g. "Accept-Encoding, Accept, Origin")
}

// ── Manifest ────────────────────────────────────────────────────────────

export const CACHED_ROUTES = [
  // Public (cacheControlPublic)
  { path: "/api/categories",       method: "GET" as const, type: "public" as const,  maxAge: 120, sMaxage: 600, vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/geo/cep",          method: "GET" as const, type: "public" as const,  maxAge: 60,  sMaxage: 60,  vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/geo/reverse",      method: "GET" as const, type: "public" as const,  maxAge: 60,  sMaxage: 60,  vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/geo/search",       method: "GET" as const, type: "public" as const,  maxAge: 60,  sMaxage: 60,  vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/providers",        method: "GET" as const, type: "public" as const,  maxAge: 60,  sMaxage: 60,  vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/providers/[id]",   method: "GET" as const, type: "private" as const, maxAge: 60,  sMaxage: null, vary: "Cookie, Accept-Encoding, Accept" },
  { path: "/api/reviews/recent",   method: "GET" as const, type: "public" as const,  maxAge: 60,  sMaxage: 300, vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/search",           method: "GET" as const, type: "public" as const,  maxAge: 30,  sMaxage: 30,  vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/search/providers", method: "GET" as const, type: "public" as const,  maxAge: 30,  sMaxage: 30,  vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/search/services",  method: "GET" as const, type: "public" as const,  maxAge: 30,  sMaxage: 30,  vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/services",         method: "GET" as const, type: "public" as const,  maxAge: 30,  sMaxage: 120, vary: "Accept-Encoding, Accept, Origin" },
  { path: "/api/stats/public",     method: "GET" as const, type: "public" as const,  maxAge: 30,  sMaxage: 120, vary: "Accept-Encoding, Accept, Origin" },
] as const

// ── Helpers ─────────────────────────────────────────────────────────────

/** Count of public routes (type === "public"). */
export const PUBLIC_COUNT = CACHED_ROUTES.filter((r) => r.type === "public").length

/** Count of private routes (type === "private"). */
export const PRIVATE_COUNT = CACHED_ROUTES.filter((r) => r.type === "private").length

/** Total cached routes. */
export const TOTAL_COUNT = CACHED_ROUTES.length
