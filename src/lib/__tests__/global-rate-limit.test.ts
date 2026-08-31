/**
 * Tests for global-rate-limit.ts — Edge-compatible sliding window rate limiter
 * with Upstash Redis fallback chain (Upstash → in-memory).
 *
 * Coverage:
 *   1. Primeira request — first request is allowed with max-1 remaining
 *   2. Limite excedido — Nth request (max+1) is blocked with remaining=0
 *   3. Janela desliza — old timestamps expire, new requests become allowed
 *   4. IPs diferentes — independent buckets per IP
 *   5. Bypass IPs — configured bypass IPs ignore rate limit entirely
 *   6. extractRoutePrefix — route prefix normalization via URL path
 *   7. resetGlobalRateLimiter — clears in-memory store mid-flight
 *
 * All tests exercise the in-memory fallback path (Upstash env vars absent).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  checkGlobalRateLimit,
  resetGlobalRateLimiter,
  globalRateLimitHeaders,
  getGlobalRateLimitDiagnostics,
  type GlobalRateLimitResult,
} from "@/lib/global-rate-limit"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Request stub with a given IP header and optional URL. */
function makeRequest(ip: string, url?: string, method = "GET"): Request {
  return new Request(url ?? "http://localhost/api/providers", {
    method,
    headers: { "x-forwarded-for": ip },
  })
}

/** Advance Date.now by ms (must be inside vi.useFakeTimers block). */
function advanceTime(ms: number): void {
  const now = Date.now()
  vi.setSystemTime(now + ms)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("checkGlobalRateLimit — in-memory fallback", () => {
  // Use max=5 so tests don't need 100 requests to reach the limit
  const TEST_MAX = 5
  const TEST_WINDOW_MS = 60_000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"))

    // Lower the limit for fast tests + ensure clean env
    process.env.GLOBAL_RATE_LIMIT_MAX = String(TEST_MAX)
    process.env.GLOBAL_RATE_LIMIT_WINDOW_MS = String(TEST_WINDOW_MS)
    delete process.env.GLOBAL_RATE_LIMIT_BYPASS_IPS
    delete process.env.GLOBAL_RATE_LIMIT_WHITELIST

    resetGlobalRateLimiter()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.GLOBAL_RATE_LIMIT_MAX
    delete process.env.GLOBAL_RATE_LIMIT_WINDOW_MS
    delete process.env.GLOBAL_RATE_LIMIT_BYPASS_IPS
    delete process.env.GLOBAL_RATE_LIMIT_WHITELIST
  })

  // -----------------------------------------------------------------------
  // 1. Primeira request
  // -----------------------------------------------------------------------

  it("permite a primeira requisição com remaining = max-1", async () => {
    const req = makeRequest("192.168.1.1")
    const result = await checkGlobalRateLimit(req)

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(TEST_MAX - 1) // 4
    expect(result.limit).toBe(TEST_MAX) // 5
    expect(result.reset).toBeGreaterThan(Date.now())
  })

  // -----------------------------------------------------------------------
  // 2. Limite excedido
  // -----------------------------------------------------------------------

  it("bloqueia após exceder o limite (max+1)", async () => {
    const req = makeRequest("10.0.0.1")
    let last: GlobalRateLimitResult | null = null

    // Send max requests — all allowed
    for (let i = 0; i < TEST_MAX; i++) {
      last = await checkGlobalRateLimit(req)
      expect(last.allowed).toBe(true)
    }

    // At the limit, remaining should be 0
    expect(last!.remaining).toBe(0)

    // One more — blocked
    const blocked = await checkGlobalRateLimit(req)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  // -----------------------------------------------------------------------
  // 3. Janela desliza
  // -----------------------------------------------------------------------

  it("janela desliza: requisições antigas expiram e novas são permitidas", async () => {
    const req = makeRequest("10.0.0.2")

    // Fill the window (max requests)
    for (let i = 0; i < TEST_MAX; i++) {
      await checkGlobalRateLimit(req)
    }

    // Blocked
    expect((await checkGlobalRateLimit(req)).allowed).toBe(false)

    // Advance past the window — all entries expire
    advanceTime(TEST_WINDOW_MS + 1)
    vi.setSystemTime(Date.now())

    // Should be allowed again with fresh remaining
    const result = await checkGlobalRateLimit(req)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(TEST_MAX - 1)
  })

  it("janela desliza parcialmente: algumas expiram, outras não", async () => {
    const req = makeRequest("10.0.0.3")

    // Make 1 request at T=0
    await checkGlobalRateLimit(req)

    // Advance 30s, make 4 more requests (total = max in the last 30s)
    advanceTime(30_000)
    vi.setSystemTime(Date.now())
    for (let i = 0; i < TEST_MAX - 1; i++) {
      await checkGlobalRateLimit(req)
    }

    // Blocked: max requests in the last 30s
    expect((await checkGlobalRateLimit(req)).allowed).toBe(false)

    // Advance 31s — the first request (T=0) expires, window now has max-1
    advanceTime(31_000)
    vi.setSystemTime(Date.now())

    const result = await checkGlobalRateLimit(req)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0) // max-1 existing + 1 new = max → 0 remaining
  })

  // -----------------------------------------------------------------------
  // 4. IPs diferentes
  // -----------------------------------------------------------------------

  it("IPs diferentes têm buckets independentes", async () => {
    const req1 = makeRequest("10.0.0.10")
    const req2 = makeRequest("10.0.0.11")

    // Exhaust IP1
    for (let i = 0; i < TEST_MAX; i++) {
      await checkGlobalRateLimit(req1)
    }
    expect((await checkGlobalRateLimit(req1)).allowed).toBe(false)

    // IP2 should be unaffected
    const result = await checkGlobalRateLimit(req2)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(TEST_MAX - 1)
  })

  // -----------------------------------------------------------------------
  // 5. Bypass IPs
  // -----------------------------------------------------------------------

  it("bypass IPs ignoram completamente o rate limit", async () => {
    const BYPASS_IP = "10.0.0.99"
    process.env.GLOBAL_RATE_LIMIT_BYPASS_IPS = BYPASS_IP

    const req = makeRequest(BYPASS_IP)

    // Make many requests beyond the limit
    for (let i = 0; i < TEST_MAX * 3; i++) {
      const result = await checkGlobalRateLimit(req)
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(TEST_MAX) // bypass sempre retorna max restante
    }
  })

  // -----------------------------------------------------------------------
  // 6. extractRoutePrefix (via comportamento indireto)
  // -----------------------------------------------------------------------

  it("agrupa URLs por prefixo de rota (extractRoutePrefix)", async () => {
    const ip = "10.0.0.50"

    // All these URLs share the same prefix `/api/providers`:
    //   /api/providers, /api/providers/123, /api/providers/456
    for (let i = 0; i < TEST_MAX; i++) {
      const req = makeRequest(ip, `http://localhost/api/providers/${i}`)
      const result = await checkGlobalRateLimit(req)
      expect(result.allowed).toBe(true)
    }

    // Next request to any providers/* URL should be blocked
    const blockedReq = makeRequest(ip, "http://localhost/api/providers/extra")
    expect((await checkGlobalRateLimit(blockedReq)).allowed).toBe(false)

    // But a different prefix (/api/admin) has its own counter
    const adminReq = makeRequest(ip, "http://localhost/api/admin/dashboard")
    const adminResult = await checkGlobalRateLimit(adminReq)
    expect(adminResult.allowed).toBe(true)
    expect(adminResult.remaining).toBe(TEST_MAX - 1)
  })

  // -----------------------------------------------------------------------
  // 7. resetGlobalRateLimiter
  // -----------------------------------------------------------------------

  it("resetGlobalRateLimiter limpa o store e permite novas requests", async () => {
    const req = makeRequest("10.0.0.200")

    // Exhaust
    for (let i = 0; i < TEST_MAX; i++) {
      await checkGlobalRateLimit(req)
    }
    expect((await checkGlobalRateLimit(req)).allowed).toBe(false)

    // Reset
    resetGlobalRateLimiter()

    // Fresh start
    const result = await checkGlobalRateLimit(req)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(TEST_MAX - 1)
  })
})

// ---------------------------------------------------------------------------
// globalRateLimitHeaders
// ---------------------------------------------------------------------------

describe("globalRateLimitHeaders", () => {
  it("retorna cabeçalhos X-Global-RateLimit-* + Retry-After", () => {
    const result: GlobalRateLimitResult = {
      allowed: true,
      remaining: 4,
      reset: Date.now() + 30_000,
      limit: 5,
    }

    const headers = globalRateLimitHeaders(result)

    expect(headers["X-Global-RateLimit-Limit"]).toBe("5")
    expect(headers["X-Global-RateLimit-Remaining"]).toBe("4")
    expect(headers["X-Global-RateLimit-Reset"]).toBeDefined()
    expect(headers["Retry-After"]).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// getGlobalRateLimitDiagnostics
// ---------------------------------------------------------------------------

describe("getGlobalRateLimitDiagnostics", () => {
  beforeEach(() => {
    resetGlobalRateLimiter()
  })

  it("retorna storeSize=0, upstashAvailable=false, config default", () => {
    const diag = getGlobalRateLimitDiagnostics()

    expect(diag.storeSize).toBe(0)
    expect(diag.upstashAvailable).toBe(false) // env vars not set
    expect(diag.upstashConnected).toBe(false)
    expect(diag.config.max).toBe(500) // default
    expect(diag.config.windowMs).toBe(60_000) // default
    expect(diag.timestamp).toBeGreaterThan(0)
  })

  it("reflete requests no storeSize", async () => {
    const req = makeRequest("10.0.0.77")
    // Set a lower max to avoid default 100
    process.env.GLOBAL_RATE_LIMIT_MAX = "5"
    await checkGlobalRateLimit(req)

    const diag = getGlobalRateLimitDiagnostics()
    expect(diag.storeSize).toBe(1) // one key in the store

    delete process.env.GLOBAL_RATE_LIMIT_MAX
  })
})
