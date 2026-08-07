import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError, cacheControlPrivate } from "@/lib/api-server"
import {
  CACHED_ROUTES,
  TOTAL_COUNT,
  PUBLIC_COUNT,
  PRIVATE_COUNT,
} from "@/lib/cache-manifest"

/**
 * Static manifest of all cache-controlled API routes.
 *
 * This endpoint returns a complete registry of every route that uses
 * `cacheControlPublic` or `cacheControlPrivate`, along with their
 * Cache-Control directives, Vary headers, and notes on edge cases.
 *
 * The data source is `CACHED_ROUTES` from `src/lib/cache-manifest.ts` —
 * the single source of truth shared with the Vitest validation suite.
 *
 * @returns {CacheRoutesManifest} — see ResponseType below.
 */
export async function GET() {
  try {
    await requireRole("ADMIN")

    const now = new Date().toISOString()
    const routes: RouteEntry[] = CACHED_ROUTES.map((entry) => {
      const base = routeManifestBase(entry.path)
      return {
        method: entry.method,
        path: entry.path,
        type: entry.type,
        maxAge: entry.maxAge,
        staleWhileRevalidate: entry.sMaxage,
        vary: entry.vary.split(", "),
        cacheControl: buildCacheControl(entry),
        notes: base.notes,
      }
    })

    const manifest: CacheRoutesManifest = {
      meta: {
        generatedAt: now,
        totalRoutes: TOTAL_COUNT,
        cacheControlPublic: PUBLIC_COUNT,
        cacheControlPrivate: PRIVATE_COUNT,
      },
      routes,
    }

    return cacheControlPrivate(NextResponse.json(manifest), 60)
  } catch (e) {
    return handleError(e)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildCacheControl(entry: (typeof CACHED_ROUTES)[number]): string {
  if (entry.type === "private") {
    return `private, max-age=${entry.maxAge}`
  }
  return `public, max-age=${entry.maxAge}, s-maxage=${entry.sMaxage}, stale-while-revalidate=${entry.sMaxage}`
}

/**
 * Per-route notes describing edge cases and operational rationale.
 * Keyed by path for maintainability — adding a new route only requires
 * adding an entry here and in CACHED_ROUTES.
 */
function routeManifestBase(path: string): { notes: string[] } {
  switch (path) {
    case "/api/providers":
      return {
        notes: [
          "Two success paths: paginated listing (GET /api/providers?page=...) and empty/total=0 fallback. Both use same TTL.",
          "400 on sort=distance without coords — no cache.",
          "Empty results (total=0) still cached (returns empty array, not an error).",
        ],
      }
    case "/api/categories":
      return {
        notes: [
          "Longest TTL among all routes (category tree changes rarely).",
          "404 on empty tree (notFound via handleError) — no cache.",
        ],
      }
    case "/api/search":
      return {
        notes: [
          "Textual search (q param). Short TTL for freshness.",
          "400 on missing q — no cache.",
        ],
      }
    case "/api/services":
      return {
        notes: [
          "s-maxage (120s) longer than max-age (30s) for CDN resilience.",
        ],
      }
    case "/api/reviews/recent":
      return {
        notes: [
          "s-maxage=300 (5 min) — reviews change slowly, CDN can serve stale copies.",
        ],
      }
    case "/api/stats/public":
      return {
        notes: [
          "Aggregate counters. s-maxage=120s allows CDN to absorb traffic spikes.",
          "Fallback returns zeros with 200 (no cache).",
        ],
      }
    case "/api/geo/cep":
      return {
        notes: [
          "CEP → address lookup. CEP is stable, 60s is conservative.",
          "404 on unknown CEP — no cache.",
        ],
      }
    case "/api/geo/reverse":
      return {
        notes: [
          "lat/lng → address reverse geocode.",
          "400 on missing coords — no cache.",
          "502 on external API failure — no cache.",
        ],
      }
    case "/api/geo/search":
      return {
        notes: [
          "Free-form/structured Nominatim geocode search.",
          "Shared 1 req/s Nominatim rate limit; CDN cache absorbs repeated lookups.",
          "400 on missing q — no cache.",
        ],
      }
    case "/api/search/providers":
      return {
        notes: [
          "Geolocated provider search (q + lat/lng). Short TTL for freshness.",
          "All errors through handleError — no cache.",
        ],
      }
    case "/api/search/services":
      return {
        notes: [
          "Textual service search (q param). Short TTL.",
          "400 on missing q (early return) — no cache.",
        ],
      }
    case "/api/providers/[id]":
      return {
        notes: [
          "Contains personalized `favorited` field per user session.",
          "Vary: Cookie separates cache per authenticated session.",
          "No s-maxage — CDN must not cache private responses.",
          "404 on missing provider — no cache (notFound via handleError).",
        ],
      }
    default:
      return { notes: [] }
  }
}

// ── Types ────────────────────────────────────────────────────────────────

type CacheScope = "public" | "private"

type RouteEntry = {
  /** HTTP method (currently always GET). */
  method: "GET"
  /** Route path (no host prefix). Placeholders are literal (e.g. [id]). */
  path: string
  /** public → CDN + browser cache. private → browser-only cache. */
  type: CacheScope
  /** Cache max-age in seconds (same value used by the route). */
  maxAge: number
  /** stale-while-revalidate in seconds. null for private routes. */
  staleWhileRevalidate: number | null
  /** Vary header directives as an array for consumption. */
  vary: string[]
  /** Full Cache-Control header value as sent by the route. */
  cacheControl: string
  /** Operational notes about edge cases or rationale. */
  notes: string[]
}

type CacheRoutesManifest = {
  meta: {
    generatedAt: string
    totalRoutes: number
    cacheControlPublic: number
    cacheControlPrivate: number
  }
  routes: RouteEntry[]
}
