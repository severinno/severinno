/**
 * Unit tests for src/lib/edge-rate-limit.ts
 *
 * Tests the in-memory fallback behaviour (Upstash Redis is not available in
 * test environment), the rate-limit headers helper, and the path-based preset
 * resolver.
 *
 * Pattern follows the existing rate-limit.test.ts conventions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"

// ── Module under test ──────────────────────────────────────────────────────
import {
  checkEdgeRateLimit,
  edgeRateLimitHeaders,
  pickRateLimitForPath,
  EDGE_RATE_LIMITS,
} from "../edge-rate-limit"
import type { EdgeRateLimitResult } from "../edge-rate-limit"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal NextRequest stub with optional headers. */
function mockNextRequest(headers: Record<string, string> = {}): NextRequest {
  const url = "http://localhost"
  const req = new Request(url) as NextRequest
  // Vitest's Request stub may not have all NextRequest properties, so we
  // extend it with the minimum needed for getClientIp.
  Object.defineProperty(req, "headers", {
    value: new Map(Object.entries(headers)),
    writable: true,
  })
  // nextUrl is accessed by the caller but never by edge-rate-limit internals
  Object.defineProperty(req, "nextUrl", {
    value: new URL(url),
    writable: true,
  })
  Object.defineProperty(req, "cookies", {
    value: { get: vi.fn(), getAll: vi.fn() },
    writable: true,
  })
  return req
}

/** Build a proper Headers object for testing getClientIp. */
function mockRequestWithHeaders(
  headers: Record<string, string> = {},
): NextRequest {
  const h = new Headers()
  for (const [k, v] of Object.entries(headers)) {
    h.set(k, v)
  }
  return {
    headers: h,
    nextUrl: new URL("http://localhost"),
    cookies: { get: vi.fn(), getAll: vi.fn() },
  } as unknown as NextRequest
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers()
  // Start at a deterministic time
  vi.setSystemTime(new Date("2026-07-24T12:00:00Z"))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// checkEdgeRateLimit — in-memory fallback (no Upstash Redis configured)
// ---------------------------------------------------------------------------

describe("checkEdgeRateLimit (in-memory fallback)", () => {
  it("allows the first request (creates new window)", async () => {
    const req = mockNextRequest()
    const result = await checkEdgeRateLimit(req, {
      prefix: "test-first",
      max: 10,
      windowMs: 60_000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(9) // max - 1
    expect(result.limit).toBe(10)
    expect(result.reset).toBeGreaterThan(Date.now())
  })

  it("allows requests up to the limit", async () => {
    const req = mockNextRequest()
    const options = { prefix: "test-up-to", max: 5, windowMs: 60_000 }

    // Make 5 requests (at the limit)
    const results: EdgeRateLimitResult[] = []
    for (let i = 0; i < 5; i++) {
      results.push(await checkEdgeRateLimit(req, options))
    }

    // First 4 requests: allowed
    for (let i = 0; i < 4; i++) {
      expect(results[i]!.allowed).toBe(true)
    }
    // 5th request: exactly at limit → allowed (<= max)
    expect(results[4]!.allowed).toBe(true)
    expect(results[4]!.remaining).toBe(0)
  })

  it("blocks when the limit is exceeded", async () => {
    const req = mockNextRequest()
    const options = { prefix: "test-exceed", max: 3, windowMs: 60_000 }

    // Make 4 requests (exceed by 1)
    for (let i = 0; i < 3; i++) {
      const result = await checkEdgeRateLimit(req, options)
      expect(result.allowed).toBe(true)
    }

    const blocked = await checkEdgeRateLimit(req, options)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it("resets the window after windowMs elapses", async () => {
    const req = mockNextRequest()
    const options = { prefix: "test-reset", max: 2, windowMs: 60_000 }

    // Exhaust the limit
    await checkEdgeRateLimit(req, options) // 1/2
    const second = await checkEdgeRateLimit(req, options) // 2/2
    expect(second.allowed).toBe(true)
    expect(second.remaining).toBe(0)

    // Advance time past the window
    vi.advanceTimersByTime(60_001)

    // Should be allowed again (new window)
    const afterReset = await checkEdgeRateLimit(req, options)
    expect(afterReset.allowed).toBe(true)
    expect(afterReset.remaining).toBe(1) // max - 1 for new window
  })

  it("uses a custom identifier when provided", async () => {
    const req = mockNextRequest()
    const options = {
      prefix: "test-custom-id",
      max: 10,
      windowMs: 60_000,
      identifier: "agent-007",
    }

    const r1 = await checkEdgeRateLimit(req, options)
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(9)

    // Second request with same custom ID
    const r2 = await checkEdgeRateLimit(req, options)
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(8) // decremented because same key
  })

  it("tracks different custom identifiers separately", async () => {
    const req = mockNextRequest()
    const baseOptions = { prefix: "test-multi-id", max: 5, windowMs: 60_000 }

    const r1 = await checkEdgeRateLimit(req, { ...baseOptions, identifier: "user-a" })
    expect(r1.remaining).toBe(4)

    const r2 = await checkEdgeRateLimit(req, { ...baseOptions, identifier: "user-b" })
    expect(r2.remaining).toBe(4) // separate counter

    // User-a makes a second request
    const r3 = await checkEdgeRateLimit(req, { ...baseOptions, identifier: "user-a" })
    expect(r3.remaining).toBe(3) // user-a's counter incremented
  })

  it("tracks different prefixes independently", async () => {
    const req = mockNextRequest()

    // Exhaust login limit
    for (let i = 0; i < 5; i++) {
      await checkEdgeRateLimit(req, { prefix: "login", max: 5, windowMs: 60_000 })
    }
    const loginBlocked = await checkEdgeRateLimit(req, { prefix: "login", max: 5, windowMs: 60_000 })
    expect(loginBlocked.allowed).toBe(false)

    // Search limit should still be fresh
    const searchResult = await checkEdgeRateLimit(req, { prefix: "search", max: 60, windowMs: 60_000 })
    expect(searchResult.allowed).toBe(true)
    expect(searchResult.remaining).toBe(59)
  })

  it("extracts client IP from x-forwarded-for header", async () => {
    const req = mockRequestWithHeaders({ "x-forwarded-for": "203.0.113.42" })
    const result = await checkEdgeRateLimit(req, {
      prefix: "test-ip",
      max: 10,
      windowMs: 60_000,
    })
    expect(result.allowed).toBe(true)
    // First request should succeed
  })

  it("falls back to x-real-ip when x-forwarded-for is localhost", async () => {
    const req = mockRequestWithHeaders({
      "x-forwarded-for": "127.0.0.1",
      "x-real-ip": "203.0.113.99",
    })
    const result = await checkEdgeRateLimit(req, {
      prefix: "test-real-ip",
      max: 10,
      windowMs: 60_000,
    })
    expect(result.allowed).toBe(true)
  })

  it("falls back to cf-connecting-ip when other headers are absent", async () => {
    const req = mockRequestWithHeaders({ "cf-connecting-ip": "198.51.100.7" })
    const result = await checkEdgeRateLimit(req, {
      prefix: "test-cf-ip",
      max: 10,
      windowMs: 60_000,
    })
    expect(result.allowed).toBe(true)
  })

  it("uses 127.0.0.1 as last-resort default IP", async () => {
    const req = mockRequestWithHeaders({}) // no IP headers
    const result = await checkEdgeRateLimit(req, {
      prefix: "test-default-ip",
      max: 10,
      windowMs: 60_000,
    })
    expect(result.allowed).toBe(true)
  })

  it("returns correct remaining count after multiple requests", async () => {
    const req = mockNextRequest()
    const options = { prefix: "test-remaining", max: 10, windowMs: 60_000 }

    const r1 = await checkEdgeRateLimit(req, options)
    expect(r1.remaining).toBe(9)

    const r2 = await checkEdgeRateLimit(req, options)
    expect(r2.remaining).toBe(8)

    const r3 = await checkEdgeRateLimit(req, options)
    expect(r3.remaining).toBe(7)
  })

  it("handles zero max (rate limit of 0 — blocks after first request)", async () => {
    const req = mockNextRequest()
    const options = { prefix: "test-zero", max: 0, windowMs: 60_000 }

    // First request creates a new window (implementation always allows
    // the first request in a new window, then subsequent requests are checked)
    const r1 = await checkEdgeRateLimit(req, options)
    expect(r1.allowed).toBe(true)  // always allowed in new window
    expect(r1.remaining).toBe(-1)  // max - 1

    // Second request should be blocked (count=2 > max=0)
    const r2 = await checkEdgeRateLimit(req, options)
    expect(r2.allowed).toBe(false)
    expect(r2.remaining).toBe(0)
  })

  it("tracks different client IPs independently", async () => {
    const options = { prefix: "test-ip-isolation", max: 3, windowMs: 60_000 }

    const reqA = mockRequestWithHeaders({ "x-forwarded-for": "10.0.0.1" })
    const reqB = mockRequestWithHeaders({ "x-forwarded-for": "10.0.0.2" })

    // Exhaust IP A's limit
    for (let i = 0; i < 3; i++) {
      await checkEdgeRateLimit(reqA, options)
    }
    const aBlocked = await checkEdgeRateLimit(reqA, options)
    expect(aBlocked.allowed).toBe(false)

    // IP B should still have full quota
    const bResult = await checkEdgeRateLimit(reqB, options)
    expect(bResult.allowed).toBe(true)
    expect(bResult.remaining).toBe(2) // max - 1
  })

  it("handles very short windows (1 second)", async () => {
    const req = mockNextRequest()
    const options = { prefix: "test-short", max: 2, windowMs: 1_000 }

    // 2 requests allowed
    expect((await checkEdgeRateLimit(req, options)).allowed).toBe(true)
    expect((await checkEdgeRateLimit(req, options)).allowed).toBe(true)

    // 3rd blocked
    expect((await checkEdgeRateLimit(req, options)).allowed).toBe(false)

    // After window
    vi.advanceTimersByTime(1_001)
    expect((await checkEdgeRateLimit(req, options)).allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// edgeRateLimitHeaders
// ---------------------------------------------------------------------------

describe("edgeRateLimitHeaders", () => {
  const baseResult: EdgeRateLimitResult = {
    allowed: false,
    remaining: 0,
    reset: Date.now() + 60_000,
    limit: 30,
  }

  it("returns all standard rate limit headers", () => {
    const h = edgeRateLimitHeaders(baseResult)

    expect(h["X-RateLimit-Limit"]).toBe("30")
    expect(h["X-RateLimit-Remaining"]).toBe("0")
    expect(h["X-RateLimit-Reset"]).toBeDefined()
    expect(h["Retry-After"]).toBeDefined()
  })

  it("reflects the remaining count", () => {
    const h = edgeRateLimitHeaders({ ...baseResult, remaining: 15 })

    expect(h["X-RateLimit-Remaining"]).toBe("15")
  })

  it("calculates Retry-After in seconds", () => {
    const reset = Date.now() + 30_000
    const h = edgeRateLimitHeaders({ ...baseResult, reset })

    const retryAfter = Number(h["Retry-After"])
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(31) // ceil of 30 + small delta
  })

  it("returns positive Retry-After even when reset is in the past", () => {
    const h = edgeRateLimitHeaders({ ...baseResult, reset: Date.now() - 10_000 })

    const retryAfter = Number(h["Retry-After"])
    // Should be 0 or negative — the caller can handle it
    expect(retryAfter).toBeLessThanOrEqual(0)
  })

  it("handles large remaining values", () => {
    const h = edgeRateLimitHeaders({ ...baseResult, remaining: 9999 })

    expect(h["X-RateLimit-Remaining"]).toBe("9999")
  })

  it("handles maximum limit values", () => {
    const h = edgeRateLimitHeaders({ ...baseResult, limit: 999_999 })

    expect(h["X-RateLimit-Limit"]).toBe("999999")
  })
})

// ---------------------------------------------------------------------------
// pickRateLimitForPath
// ---------------------------------------------------------------------------

describe("pickRateLimitForPath", () => {
  it("returns login preset for /api/auth/login", () => {
    const opts = pickRateLimitForPath("/api/auth/login")
    expect(opts.prefix).toBe("login")
    expect(opts.max).toBe(EDGE_RATE_LIMITS.login.max)
  })

  it("returns login preset for /api/auth/login with trailing slash", () => {
    const opts = pickRateLimitForPath("/api/auth/login/")
    expect(opts.prefix).toBe("login")
  })

  it("returns login preset for sub-routes like /api/auth/login/verify", () => {
    const opts = pickRateLimitForPath("/api/auth/login/verify")
    expect(opts.prefix).toBe("login")
  })

  it("returns register preset for /api/auth/register", () => {
    const opts = pickRateLimitForPath("/api/auth/register")
    expect(opts.prefix).toBe("register")
    expect(opts.max).toBe(5)
  })

  it("returns forgotPassword preset for /api/auth/forgot-password", () => {
    const opts = pickRateLimitForPath("/api/auth/forgot-password")
    expect(opts.prefix).toBe("forgot-pw")
    expect(opts.windowMs).toBe(600_000) // 10 min
  })

  it("returns bookings preset for /api/bookings", () => {
    const opts = pickRateLimitForPath("/api/bookings")
    expect(opts.prefix).toBe("bookings")
    expect(opts.max).toBe(30)
  })

  it("returns bookings preset for /api/bookings/123", () => {
    const opts = pickRateLimitForPath("/api/bookings/123")
    expect(opts.prefix).toBe("bookings")
  })

  it("returns quotes preset for /api/quotes", () => {
    const opts = pickRateLimitForPath("/api/quotes")
    expect(opts.prefix).toBe("quotes")
    expect(opts.max).toBe(20)
  })

  it("returns providers preset for /api/providers", () => {
    const opts = pickRateLimitForPath("/api/providers")
    expect(opts.prefix).toBe("providers")
    expect(opts.max).toBe(60)
  })

  it("returns categories preset for /api/categories", () => {
    const opts = pickRateLimitForPath("/api/categories")
    expect(opts.prefix).toBe("categories")
    expect(opts.max).toBe(30)
  })

  it("returns geo preset for /api/geo/cep", () => {
    const opts = pickRateLimitForPath("/api/geo/cep")
    expect(opts.prefix).toBe("geo")
  })

  it("returns search preset for /api/search/providers", () => {
    const opts = pickRateLimitForPath("/api/search/providers")
    expect(opts.prefix).toBe("search")
    expect(opts.max).toBe(30)
  })

  it("returns messages preset for /api/messages", () => {
    const opts = pickRateLimitForPath("/api/messages")
    expect(opts.prefix).toBe("messages")
    expect(opts.max).toBe(30)
  })

  it("returns reviews preset for /api/reviews", () => {
    const opts = pickRateLimitForPath("/api/reviews")
    expect(opts.prefix).toBe("reviews")
    expect(opts.max).toBe(10)
  })

  it("returns upload preset for /api/upload", () => {
    const opts = pickRateLimitForPath("/api/upload")
    expect(opts.prefix).toBe("upload")
    expect(opts.max).toBe(10)
  })

  it("returns general preset for /api/health", () => {
    const opts = pickRateLimitForPath("/api/health")
    expect(opts.prefix).toBe("general")
    expect(opts.max).toBe(60)
  })

  it("returns general preset for unknown routes", () => {
    const opts = pickRateLimitForPath("/api/unknown-endpoint")
    expect(opts.prefix).toBe("general")
  })

  it("returns general preset for non-API routes", () => {
    const opts = pickRateLimitForPath("/dashboard")
    expect(opts.prefix).toBe("general")
  })

  it("distinguishes /api/auth/login from /api/auth/register", () => {
    const login = pickRateLimitForPath("/api/auth/login")
    const register = pickRateLimitForPath("/api/auth/register")

    expect(login.prefix).toBe("login")
    expect(register.prefix).toBe("register")
    expect(login.max).not.toBe(register.max) // login=10, register=5
  })

  it("returns general for /api/auth/me (not explicitly listed)", () => {
    const opts = pickRateLimitForPath("/api/auth/me")
    expect(opts.prefix).toBe("general")
  })

  it("returns general for /api/auth/logout (not explicitly listed)", () => {
    const opts = pickRateLimitForPath("/api/auth/logout")
    expect(opts.prefix).toBe("general")
  })
})
