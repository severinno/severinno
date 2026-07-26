/**
 * Shared Vitest helpers for cache header assertions.
 *
 * Use these in any route test that uses cacheControlPublic to avoid
 * duplicating Cache-Control and Vary assertions across files.
 *
 * @example
 *   import { expectCacheHeaders, expectNoCacheHeaders } from "./cache-test-utils"
 *
 *   // Response from cacheControlPublic(response, 60)
 *   expectCacheHeaders(res, 60)                    // s-maxage defaults to 60
 *   expectCacheHeaders(res, 120, 600)              // explicit s-maxage
 *   expectNoCacheHeaders(res)                       // no cache headers
 */

import { expect } from "vitest"

const VARY_VALUE = "Accept-Encoding, Accept, Origin"

/**
 * Assert that a response has correct cache headers set by cacheControlPublic.
 *
 * Checks:
 *   1. Cache-Control: public, max-age={maxAge}, s-maxage={sMaxage}
 *   2. Vary: Accept-Encoding, Accept, Origin
 *
 * @param res      - The NextResponse to check headers on.
 * @param maxAge   - Expected max-age in seconds.
 * @param sMaxage  - Expected s-maxage in seconds (defaults to maxAge).
 */
export function expectCacheHeaders(
  res: { status: number; headers: { get: (name: string) => string | null } },
  maxAge: number,
  sMaxage?: number,
): void {
  const swr = sMaxage ?? maxAge

  expect(res.status).toBe(200)
  expect(res.headers.get("Cache-Control")).toBe(
    `public, max-age=${maxAge}, s-maxage=${swr}`,
  )
  expect(res.headers.get("Vary")).toBe(VARY_VALUE)
}

/**
 * Assert that a response has private cache headers set by cacheControlPrivate.
 *
 * Checks:
 *   1. Cache-Control: private, max-age={maxAge} (no s-maxage)
 *   2. Vary: Cookie, Accept-Encoding, Accept
 *
 * Use for routes with user-personalized data (e.g. `favorited` flag).
 *
 * @param res     - The NextResponse to check headers on.
 * @param maxAge  - Expected max-age in seconds.
 */
export function expectPrivateCacheHeaders(
  res: { status: number; headers: { get: (name: string) => string | null } },
  maxAge: number,
): void {
  expect(res.status).toBe(200)
  expect(res.headers.get("Cache-Control")).toBe(
    `private, max-age=${maxAge}`,
  )
  expect(res.headers.get("Vary")).toBe("Cookie, Accept-Encoding, Accept")
}

/**
 * Assert that a response does NOT have cache headers.
 *
 * This is the expected state for error responses (4xx) and any
 * response that bypasses cacheControlPublic (e.g. early returns).
 *
 * Does NOT assert on status — the caller should check that separately.
 *
 * @param res - The NextResponse to check headers on.
 */
export function expectNoCacheHeaders(
  res: { headers: { get: (name: string) => string | null } },
): void {
  expect(res.headers.get("Cache-Control")).toBeNull()
  expect(res.headers.get("Vary")).toBeNull()
}
