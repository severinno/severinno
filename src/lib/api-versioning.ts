/**
 * api-versioning.ts
 *
 * API versioning middleware for the Severinno Marketplace.
 *
 * Strategy: URL-based versioning with backward-compatible redirects.
 *
 * How it works:
 *   1. /api/v1/* requests are handled by the current (unversioned) routes
 *   2. /api/v2/* requests can be routed to different handlers in the future
 *   3. Unversioned /api/* requests continue to work (no breaking changes)
 *
 * This allows gradual migration of clients to versioned endpoints while
 * maintaining backward compatibility.
 */

import { NextResponse, type NextRequest } from "next/server"

// Current API version (bumped on breaking changes)
export const CURRENT_API_VERSION = "v1"

// Supported versions (add new versions here)
export const SUPPORTED_VERSIONS = ["v1"] as const

/**
 * Check if a pathname targets a versioned API endpoint.
 */
export function isVersionedApi(pathname: string): boolean {
  return /^\/api\/v\d+\//.test(pathname)
}

/**
 * Extract the version from a versioned API path.
 * Returns null if not a versioned path.
 */
export function extractApiVersion(pathname: string): string | null {
  const match = pathname.match(/^\/api\/(v\d+)\//)
  return match?.[1] ?? null
}

/**
 * Strip the version prefix from a pathname.
 * "/api/v1/providers" → "/api/providers"
 */
export function stripVersionPrefix(pathname: string): string {
  return pathname.replace(/^\/api\/v\d+/, "/api")
}

/**
 * Middleware logic for API versioning.
 *
 * - /api/v1/* → rewrite to /api/* (current version)
 * - /api/v2/* → rewrite to /api/* (future: different handlers)
 * - /api/* (unversioned) → pass through (backward compatible)
 */
export function handleApiVersioning(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl

  // Only process versioned API routes
  if (!isVersionedApi(pathname)) return null

  const version = extractApiVersion(pathname)
  if (!version) return null

  // Check if version is supported
  if (!SUPPORTED_VERSIONS.includes(version as (typeof SUPPORTED_VERSIONS)[number])) {
    return NextResponse.json(
      {
        error: `API version "${version}" is not supported`,
        supportedVersions: SUPPORTED_VERSIONS,
        currentVersion: CURRENT_API_VERSION,
      },
      { status: 400 },
    )
  }

  // Rewrite to the unversioned path (current implementation)
  const rewrittenPath = stripVersionPrefix(pathname)
  const url = request.nextUrl.clone()
  url.pathname = rewrittenPath

  // Add version header for observability
  const response = NextResponse.rewrite(url)
  response.headers.set("X-API-Version", version)

  return response
}
