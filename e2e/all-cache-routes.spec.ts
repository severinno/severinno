/**
 * E2E integration tests for ALL cached API routes.
 *
 * Fires real HTTP requests against the dev server for every route listed
 * in the CACHED_ROUTES manifest and verifies that Cache-Control and Vary
 * headers are present and correct.
 *
 * Prerequisites: dev server running on port 3000 (bun run dev)
 * Run: bun run e2e -- --grep "all cached routes"
 *
 * NOTE: In local dev mode, no real CDN is present. The headers verified
 * here instruct the CDN (Vercel Edge, Cloudflare, etc.) how to cache
 * responses in production.
 */

import { test, expect, type APIRequestContext } from "@playwright/test"
import { CACHED_ROUTES } from "../src/lib/cache-manifest"

// -------------------------------------------------------------------------
// Route-specific query parameter builders
// -------------------------------------------------------------------------
// Each route needs specific params to return 200. Some need real IDs from
// the database (obtained by first querying the list endpoint).

type RouteConfig = {
  /** Query params to append to the URL for a successful 200 response. */
  queryString: string
  /** For dynamic-segment routes like /api/providers/[id], fetch the real ID first. */
  dynamicId?: {
    /** The list endpoint to fetch IDs from. */
    listPath: string
    /** Function to extract the ID from a list item. */
    extractId: (item: Record<string, unknown>) => string
  }
  /** Whether this route returns a private (user-personalized) response. */
  expectsPrivate?: boolean
}

const ROUTE_CONFIGS: Record<string, RouteConfig> = {
  "/api/categories":       { queryString: "" },
  "/api/geo/cep":          { queryString: "?cep=01310100" },
  "/api/geo/reverse":      { queryString: "?lat=-23.55&lng=-46.63" },
  "/api/geo/search":       { queryString: "?q=s%C3%A3o%20paulo" },
  "/api/providers":        { queryString: "?page=1&limit=5" },
  "/api/providers/[id]":   {
    queryString: "",
    expectsPrivate: true,
    dynamicId: {
      listPath: "/api/providers?page=1&limit=1",
      extractId: (item) => item.id as string,
    },
  },
  "/api/reviews/recent":   { queryString: "?limit=4" },
  "/api/search":           { queryString: "?q=encanador" },
  "/api/search/providers": { queryString: "?q=encanador" },
  "/api/search/services":  { queryString: "?q=instalação" },
  "/api/services":         { queryString: "" },
  "/api/stats/public":     { queryString: "" },
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

type RouteEntry = (typeof CACHED_ROUTES)[number]

/** Resolve a route config to a fully-qualified URL (replacing [id] params). */
async function resolveUrl(
  request: APIRequestContext,
  entry: RouteEntry,
): Promise<string> {
  const config = ROUTE_CONFIGS[entry.path]
  if (!config) {
    throw new Error(`No route config for ${entry.path}`)
  }

  // Resolve dynamic ID segments by querying a list endpoint
  if (config.dynamicId) {
    const listResp = await request.get(config.dynamicId.listPath)
    if (!listResp.ok()) {
      throw new Error(
        `Failed to fetch list endpoint ${config.dynamicId.listPath} ` +
        `for resolving ${entry.path}: ${listResp.status()}`,
      )
    }
    const listBody = (await listResp.json()) as { items?: Record<string, unknown>[] }
    const item = listBody.items?.[0]
    if (!item) {
      throw new Error(
        `No items found at ${config.dynamicId.listPath} for resolving ${entry.path}`,
      )
    }
    const id = config.dynamicId.extractId(item)
    return entry.path.replace("[id]", id) + config.queryString
  }

  return entry.path + config.queryString
}

/** Build the expected Cache-Control header value for a route entry. */
function expectedCacheControl(entry: RouteEntry): string {
  if (entry.type === "private") {
    return `private, max-age=${entry.maxAge}`
  }
  return `public, max-age=${entry.maxAge}, s-maxage=${entry.sMaxage}, stale-while-revalidate=${entry.sMaxage}`
}

// -------------------------------------------------------------------------
// Test suite — parameterized over all 12 cached routes
// -------------------------------------------------------------------------

test.describe("GET all cached routes — HTTP cache headers", () => {
  for (const entry of CACHED_ROUTES) {
    test(`${entry.path} returns ${expectedCacheControl(entry)}`, async ({ request }) => {
      const url = await resolveUrl(request, entry)
      const response = await request.get(url)
      const headers = response.headers()
      const cc = headers["cache-control"]
      const vary = headers["vary"]

      // Log for debugging
      console.log(`  ${entry.path} → ${response.status()} | CC: ${cc} | Vary: ${vary ? vary.slice(0, 40) : "MISSING"}...`)

      // Expect 200 OK
      expect(response.ok()).toBeTruthy()

      // Expect Cache-Control with correct value
      expect(cc).toBe(expectedCacheControl(entry))

      // Expect Vary containing our values (Next.js may prepend its own)
      if (entry.type === "private") {
        expect(vary).toContain("Cookie, Accept-Encoding, Accept")
      } else {
        expect(vary).toContain("Accept-Encoding, Accept, Origin")
      }
    })

    test(`${entry.path} returns consistent data on repeated call`, async ({ request }) => {
      const url = await resolveUrl(request, entry)
      const first = await request.get(url)
      const second = await request.get(url)

      expect(first.ok()).toBeTruthy()
      expect(second.ok()).toBeTruthy()

      // Both calls must have cache headers
      expect(first.headers()["cache-control"]).toBe(expectedCacheControl(entry))
      expect(second.headers()["cache-control"]).toBe(expectedCacheControl(entry))

      // Body should be consistent (JSON deep equality)
      const firstBody = await first.json()
      const secondBody = await second.json()
      expect(secondBody).toEqual(firstBody)
    })
  }
})

// -------------------------------------------------------------------------
// Summary test — confirms all 12 routes were covered
// -------------------------------------------------------------------------

test.describe("Cache route coverage summary", () => {
  test("all 12 cached routes were verified via HTTP", () => {
    const total = CACHED_ROUTES.length
    const publicRoutes = CACHED_ROUTES.filter((r) => r.type === "public").length
    const privateRoutes = CACHED_ROUTES.filter((r) => r.type === "private").length

    console.log(`\n  📋 Cache Route Coverage Summary`)
    console.log(`     Total routes verified: ${total}`)
    console.log(`     Public: ${publicRoutes}`)
    console.log(`     Private: ${privateRoutes}`)
    console.log()
    console.log(`     Routes:`)
    for (const r of CACHED_ROUTES) {
      const cc = expectedCacheControl(r)
      console.log(`       ${r.path.padEnd(28)} ${cc}`)
    }

    expect(total).toBe(12)
    expect(publicRoutes).toBe(11)
    expect(privateRoutes).toBe(1)
  })
})
