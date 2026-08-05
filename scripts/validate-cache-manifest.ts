#!/usr/bin/env tsx
/**
 * Validate cache manifest against actual route handlers.
 *
 * Scans every src/app/api/ route file for usage of
 * cacheControlPublic / cacheControlPrivate and cross-references
 * against the static CACHED_ROUTES manifest from cache-manifest.ts.
 *
 * Detects:
 *   1. Routes that use cache but are missing from the manifest
 *   2. Routes in the manifest that no longer use cache (stale)
 *   3. Routes whose TTL values differ from the manifest
 *
 * Usage:
 *   bun scripts/validate-cache-manifest.ts
 *   npx tsx scripts/validate-cache-manifest.ts
 *
 * Exit code:
 *   0 - all good (manifest matches code)
 *   1 - mismatch found (check stderr for details)
 */

import { readFileSync } from "node:fs"
import { globSync } from "glob"
import { resolve, sep } from "node:path"

// Import the single source of truth
import { CACHED_ROUTES } from "../src/lib/cache-manifest"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(import.meta.dirname, "..")
const API_ROUTES_GLOB = "src/app/api/**/route.ts"

// Paths that are intentionally excluded from caching (auth-required,
// mutating, internal, or real-time)
const EXCLUDED_PREFIXES = [
  "/api/admin",        // requireRole — already private/auth
  "/api/auth",         // authentication endpoints
  "/api/availability", // user-specific availability
  "/api/bookings",     // user-specific bookings
  "/api/chat",         // real-time chat
  "/api/cron",         // internal cron jobs
  "/api/favorites",    // user-specific favorites
  "/api/health",       // monitoring (no cache needed)
  "/api/messages",     // user-specific messages
  "/api/metrics",      // monitoring
  "/api/newsletter",   // POST (subscribe)
  "/api/notifications",// user-specific
  "/api/provider",     // provider-specific (auth required)
  "/api/push",         // user-specific push subscriptions
  "/api/quotes",       // user-specific quotes
  // /api/reviews/* not listed: GET /api/reviews/recent IS cached.
  // POST /api/reviews won't have cacheControlPublic, so not flagged.
  "/api/sentry",       // POST sentry errors
  "/api/services/[id]", // provider-specific service detail
  "/api/stats/activity", // auth required
  "/api/tracking",     // booking-specific tracking
  "/api/upload",       // POST upload
  "/api/users",        // user-specific data
  "/api/webhooks",     // POST webhooks
]

// Some routes are GET but intentionally not cached
// (list as full paths for clarity)
const INTENTIONALLY_UNCHACED = [
  "/api/categories/[id]",  // individual category — currently not cached
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a file path like `src/app/api/providers/[id]/route.ts` to `/api/providers/[id]`. */
function filePathToApiRoute(filePath: string): string {
  // Normalize Windows backslashes
  const normalized = filePath.split(sep).join("/")

  // Normalize: src/app/api/providers/route.ts -> /api/providers
  const match = normalized.match(/^.*src\/app\/api\/(.+\.ts)$/)
  if (!match) return normalized

  // Drop /route.ts suffix, preserve everything before it
  let route = match[1].replace(/\/route\.ts$/, "")

  // Convert `\[id\]` (Windows: \[id\]) or `[id]` to `[id]` (Next.js param)
  route = route.replace(/\\?\[/g, "[").replace(/\\?\]/g, "]")

  return "/api/" + route
}

/** Check if a route should have cache headers (public GET, not excluded). */
function shouldHaveCache(apiPath: string): boolean {
  if (EXCLUDED_PREFIXES.some((p) => apiPath.startsWith(p))) return false
  if (INTENTIONALLY_UNCHACED.includes(apiPath)) return false
  // POST routes shouldn't have cache
  // (we only check GET routes, but some route files might handle POST only)
  return true
}

/** Extract TTL values from a route file's cacheControlPublic/Private calls. */
function extractTtlFromFile(content: string, apiPath: string): { maxAge: number; sMaxage: number | null; type: "public" | "private" } | null {
  // Match cacheControlPublic(res, <maxAge>, <sMaxage?>) or cacheControlPrivate(res, <maxAge>)
  const publicMatch = content.match(/cacheControlPublic\([^,]+,\s*(\d+)(?:\s*,\s*(\d+))?/)
  const privateMatch = content.match(/cacheControlPrivate\([^,]+,\s*(\d+)/)

  if (publicMatch) {
    return {
      type: "public",
      maxAge: parseInt(publicMatch[1], 10),
      sMaxage: publicMatch[2] ? parseInt(publicMatch[2], 10) : parseInt(publicMatch[1], 10),
    }
  }

  if (privateMatch) {
    return {
      type: "private",
      maxAge: parseInt(privateMatch[1], 10),
      sMaxage: null,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

function main(): void {
  const manifestPaths = new Set(CACHED_ROUTES.map((r) => r.path))
  const manifestPathToEntry = new Map(CACHED_ROUTES.map((r) => [r.path, r]))

  // Discover all route files
  const routeFiles = globSync(API_ROUTES_GLOB, { cwd: PROJECT_ROOT })

  const errors: string[] = []
  const foundInCode: Array<{ path: string; ttl: ReturnType<typeof extractTtlFromFile> }> = []

  for (const file of routeFiles) {
    const fullPath = resolve(PROJECT_ROOT, file)
    const content = readFileSync(fullPath, "utf-8")
    const apiPath = filePathToApiRoute(file)

    // Check if this file uses cache functions
    const hasCache = content.includes("cacheControlPublic") || content.includes("cacheControlPrivate")
    const shouldCache = shouldHaveCache(apiPath)

    if (hasCache) {
      foundInCode.push({
        path: apiPath,
        ttl: extractTtlFromFile(content, apiPath),
      })

      // Only flag missing from manifest if this route SHOULD have cache
      // (excluded routes like /api/admin/* use cache but aren't in the manifest)
      if (shouldCache && !manifestPaths.has(apiPath as never)) {
        errors.push(
          `❌ MISSING FROM MANIFEST: ${apiPath}\n` +
          `   Found cacheControlPublic/Private in ${file}\n` +
          `   Add it to src/lib/cache-manifest.ts`,
        )
      }
    } else if (shouldCache) {
      // Route doesn't use cache but might be expected to
      // This is informational — not all GET routes need cache
      // Only flag if it's in the manifest (stale entry)
      if (manifestPaths.has(apiPath as never)) {
        errors.push(
          `❌ STALE IN MANIFEST: ${apiPath}\n` +
          `   Listed in CACHED_ROUTES but no cacheControlPublic/Private found in ${file}\n` +
          `   Either add cache to the route or remove it from src/lib/cache-manifest.ts`,
        )
      }
    }
  }

  // Check for routes in manifest that don't exist in code
  const foundPaths = new Set(foundInCode.map((r) => r.path))
  for (const [path, entry] of manifestPathToEntry) {
    if (!foundPaths.has(path)) {
      // It's possible the route file doesn't exist anymore (renamed, deleted)
      const matchingFile = routeFiles.find((f) => filePathToApiRoute(f) === path)
      if (!matchingFile) {
        errors.push(
          `❌ STALE IN MANIFEST: ${path}\n` +
          `   Listed in CACHED_ROUTES but no corresponding route file found\n` +
          `   Remove it from src/lib/cache-manifest.ts`,
        )
      }
    }
  }

  // Verify TTL values match between manifest and code
  for (const { path, ttl } of foundInCode) {
    if (!ttl) continue
    const manifestEntry = manifestPathToEntry.get(path as never)
    if (!manifestEntry) continue

    if (ttl.maxAge !== manifestEntry.maxAge) {
      errors.push(
        `❌ TTL MISMATCH: ${path}\n` +
        `   Manifest: maxAge=${manifestEntry.maxAge}, Code: maxAge=${ttl.maxAge}\n` +
        `   Update src/lib/cache-manifest.ts`,
      )
    }

    if (ttl.type === "public" && ttl.sMaxage !== null && ttl.sMaxage !== manifestEntry.sMaxage) {
      errors.push(
        `❌ TTL MISMATCH: ${path}\n` +
        `   Manifest: sMaxage=${manifestEntry.sMaxage}, Code: sMaxage=${ttl.sMaxage}\n` +
        `   Update src/lib/cache-manifest.ts`,
      )
    }

    if (ttl.type !== manifestEntry.type) {
      errors.push(
        `❌ TYPE MISMATCH: ${path}\n` +
        `   Manifest: ${manifestEntry.type}, Code: ${ttl.type}\n` +
        `   Update src/lib/cache-manifest.ts`,
      )
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────

  const manifestCount = manifestPaths.size
  const codeCount = foundInCode.length

  console.log(`\n  📋 Cache Manifest Validation\n`)
  console.log(`     Manifest entries: ${manifestCount}`)
  console.log(`     Routes with cache: ${codeCount}`)
  console.log(`     Route files scanned: ${routeFiles.length}`)
  console.log()

  if (errors.length === 0) {
    console.log(`  ✅ All good! Manifest matches the code.\n`)
    process.exit(0)
  }

  console.log(`  ❌ ${errors.length} issue(s) found:\n`)
  for (const err of errors) {
    console.error(`  ${err}\n`)
  }
  process.exit(1)
}

main()
