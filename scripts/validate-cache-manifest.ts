#!/usr/bin/env tsx
// @ts-nocheck
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
 *   4. Regressions of the Cache-Control header format emitted by
 *      cacheControlPublic (the stale-while-revalidate directive) in
 *      src/lib/api-server.ts
 *   5. Malformed cacheControlPublic/Private calls in route handlers
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
import { fileURLToPath } from "node:url"

// Import the single source of truth
import { CACHED_ROUTES } from "../src/lib/cache-manifest"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// fileURLToPath-based (not import.meta.dirname): robust under vitest's module
// transform AND plain node/bun — same pattern as scripts/barrel-lint.mjs.
// Note TWO "..": the URL is <root>/scripts/validate-cache-manifest.ts, so we
// climb past scripts/ to the repo root (import.meta.dirname would be
// <root>/scripts — a single ".." from the FILE lands in scripts/, not root).
const PROJECT_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..")
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

/**
 * Extract TTL values from a route file's cacheControlPublic/Private calls.
 * Exported pure for unit tests (incl. CRLF line-ending tolerance) — the CLI
 * flow runs only when this file is the entry point.
 */
export function extractTtlFromFile(content: string, apiPath: string): { maxAge: number; sMaxage: number | null; type: "public" | "private" } | null {
  // Simple form: cacheControlPublic(res, <maxAge>, <sMaxage?>) or cacheControlPrivate(res, <maxAge>)
  const publicMatch = content.match(/cacheControlPublic\([^,]+,\s*(\d+)(?:\s*,\s*(\d+))?/)
  const privateMatch = content.match(/cacheControlPrivate\([^,]+,\s*(\d+)/)

  // Wrapped form: cacheControlPublic(NextResponse.json({ ... }), <maxAge>, <sMaxage?>) —
  // the first argument is an inline expression containing commas, so the simple
  // regex above can't see past it. Match up to the first ')' (end of the wrapped
  // expression) and then the trailing numeric TTL args.
  const wrappedPublicMatch =
    publicMatch ??
    content.match(/cacheControlPublic\([\s\S]*?\)\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/)
  const wrappedPrivateMatch =
    privateMatch ??
    content.match(/cacheControlPrivate\([\s\S]*?\)\s*,\s*(\d+)\s*\)/)

  if (wrappedPublicMatch) {
    return {
      type: "public",
      maxAge: parseInt(wrappedPublicMatch[1], 10),
      sMaxage: wrappedPublicMatch[2]
        ? parseInt(wrappedPublicMatch[2], 10)
        : parseInt(wrappedPublicMatch[1], 10),
    }
  }

  if (wrappedPrivateMatch) {
    return {
      type: "private",
      maxAge: parseInt(wrappedPrivateMatch[1], 10),
      sMaxage: null,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Header-format validation
// ---------------------------------------------------------------------------

/**
 * Expected Cache-Control format emitted by `cacheControlPublic`.
 *
 * Every public cached route must advertise stale-while-revalidate so shared
 * caches (CDN) can keep serving stale content while revalidating in the
 * background (RFC 5861). The header is built in ONE place —
 * src/lib/api-server.ts — so a regression of the directive is caught here in
 * ~2s instead of depending on e2e tests against a live server.
 *
 * Variable names inside the template literal are matched loosely
 * (\$\{[^}]+\}) so renaming maxAge/swr does not trip the gate — only the
 * directive format is normative. The (?:,\s*[^,]+)*? skips allow OTHER
 * directives to be interleaved (e.g. `immutable`) because Cache-Control
 * directives are order-independent — but all three required directives must
 * still be present, in order, so removals/reorders keep failing.
 */
export const PUBLIC_CACHE_CONTROL_FORMAT =
  /public,\s*max-age=\$\{[^}]+\}(?:,\s*[^,]+)*?,\s*s-maxage=\$\{[^}]+\}(?:,\s*[^,]+)*?,\s*stale-while-revalidate=\$\{[^}]+\}/

const API_SERVER_SOURCE = "src/lib/api-server.ts"

/**
 * Read `cacheControlPublic` from its single source of truth and verify the
 * header format still contains the stale-while-revalidate directive.
 */
function validatePublicCacheControlFormat(): string[] {
  const fullPath = resolve(PROJECT_ROOT, API_SERVER_SOURCE)
  const content = readFileSync(fullPath, "utf-8")

  const fnMatch = content.match(/function cacheControlPublic\s*\([\s\S]*?\n\s*}/)
  if (!fnMatch) {
    return [
      `❌ HEADER FORMAT: cacheControlPublic not found in ${API_SERVER_SOURCE}\n` +
        `   It is the single source of truth for the stale-while-revalidate\n` +
        `   directive — every public cached route depends on it.`,
    ]
  }

  if (!PUBLIC_CACHE_CONTROL_FORMAT.test(fnMatch[0])) {
    const rendered = fnMatch[0]
      .split(/\r?\n/) // CRLF-tolerant (`.gitattributes text=auto` on Windows)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
    return [
      `❌ HEADER FORMAT: cacheControlPublic lost the stale-while-revalidate directive\n` +
        `   Expected: public, max-age={maxAge}, s-maxage={swr}, stale-while-revalidate={swr}\n` +
        `   Found in ${API_SERVER_SOURCE}: ${rendered}\n` +
        `   Restore the directive so CDN caches keep serving stale content during revalidation.`,
    ]
  }

  return []
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
      const ttl = extractTtlFromFile(content, apiPath)
      foundInCode.push({
        path: apiPath,
        ttl,
      })

      // A cacheControlPublic/Private call that fails to parse means the call
      // signature regressed (non-numeric TTL, missing args, renamed helper).
      // The directive is emitted by the helper, so a broken call silently
      // weakens the cache contract — flag it here instead.
      //
      // Gated on shouldCache: excluded routes (e.g. /api/admin/cache-routes)
      // may reference the helpers as object property names without calling
      // them — those are outside the manifest contract and must not fail.
      if (!ttl && shouldCache) {
        errors.push(
          `❌ MALFORMED CACHE CALL: ${apiPath}\n` +
            `   Could not parse cacheControlPublic/Private call in ${file}\n` +
            `   Expected one of:\n` +
            `     cacheControlPublic(res, <maxAge>, <swr?>)\n` +
            `     cacheControlPublic(NextResponse.json({ ... }), <maxAge>, <swr?>)\n` +
            `     cacheControlPrivate(res, <maxAge>)`,
        )
      }

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

  // ── Header-format check (single source of truth) ───────────────────────

  errors.push(...validatePublicCacheControlFormat())

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

// Entry-point guard — unit tests import the pure helpers (extractTtlFromFile,
// PUBLIC_CACHE_CONTROL_FORMAT) without running the full scan (same pattern as
// scripts/pre-commit-tests.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
