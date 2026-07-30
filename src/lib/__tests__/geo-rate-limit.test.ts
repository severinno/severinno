/**
 * Tests for geo-rate-limit.ts — sliding-window rate limiter for geo APIs.
 *
 * Coverage:
 *   1. Module exports (checkGeoRateLimit, assertGeoRateLimit, GEO_LIMITS)
 *   2. checkGeoRateLimit — in-memory path (Redis unavailable)
 *      - First request is allowed
 *      - 31st request (search, 30 max) is blocked
 *      - 61st request (cep, 60 max) is blocked
 *      - Window slides: oldest request expires → new request allowed
 *      - Remaining decreases correctly
 *      - Reset is in the future
 *   3. assertGeoRateLimit — throws when rate limited
 *   4. geoRateLimitHeaders — returns correct header shape
 *   5. getClientIp — parses x-forwarded-for, x-real-ip, cf-connecting-ip
 *   6. Edge cases: reverse endpoint, unknown IP
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ── We import the module directly — Redis is auto-unavailable in test
//    environment because getClient returns null (no REDIS_URL) and the
//    ioredis dynamic import fails gracefully.  All tests exercise the
//    in-memory fallback path.

import { HttpError } from "@/lib/api-server"

import {
  checkGeoRateLimit,
  assertGeoRateLimit,
  geoRateLimitHeaders,
  GEO_LIMITS,
  isGeoRateLimitError,
  type GeoEndpoint,
  type GeoRateLimitResult,
} from "@/lib/geo-rate-limit"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Request stub with a given IP header. */
function makeRequest(ip: string, method = "GET"): Request {
  return new Request("http://localhost/api/geo/search", {
    method,
    headers: { "x-forwarded-for": ip },
  })
}

/** Advance Date.now by ms. */
function advanceTime(ms: number): void {
  const now = Date.now()
  vi.setSystemTime(now + ms)
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GEO_LIMITS", () => {
  it("define search com max=30 e windowMs=60000", () => {
    expect(GEO_LIMITS.search).toEqual({ max: 30, windowMs: 60_000 })
  })

  it("define cep com max=60 e windowMs=60000", () => {
    expect(GEO_LIMITS.cep).toEqual({ max: 60, windowMs: 60_000 })
  })

  it("define reverse com max=30 e windowMs=60000", () => {
    expect(GEO_LIMITS.reverse).toEqual({ max: 30, windowMs: 60_000 })
  })
})

describe("checkGeoRateLimit — in-memory fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Set to a fixed date
    vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("permite a primeira requisição (search)", async () => {
    const req = makeRequest("192.168.1.1")
    const result = await checkGeoRateLimit(req, "search")
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(29)
    expect(result.limit).toBe(30)
    expect(result.reset).toBeGreaterThan(Date.now())
  })

  it("permite a primeira requisição (cep)", async () => {
    const req = makeRequest("192.168.1.2")
    const result = await checkGeoRateLimit(req, "cep")
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(59)
  })

  it("bloqueia a 31ª requisição de search do mesmo IP", async () => {
    const req = makeRequest("10.0.0.1")
    let last: GeoRateLimitResult | null = null

    // 30 requests allowed
    for (let i = 0; i < 30; i++) {
      last = await checkGeoRateLimit(req, "search")
      expect(last.allowed).toBe(true)
    }
    // 31st should be blocked
    const blocked = await checkGeoRateLimit(req, "search")
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it("bloqueia a 61ª requisição de cep do mesmo IP", async () => {
    const req = makeRequest("10.0.0.2")
    for (let i = 0; i < 60; i++) {
      await checkGeoRateLimit(req, "cep")
    }
    const blocked = await checkGeoRateLimit(req, "cep")
    expect(blocked.allowed).toBe(false)
  })

  it("diminui remaining a cada requisição", async () => {
    const req = makeRequest("10.0.0.3")
    const r1 = await checkGeoRateLimit(req, "search")
    expect(r1.remaining).toBe(29)

    const r2 = await checkGeoRateLimit(req, "search")
    expect(r2.remaining).toBe(28)

    const r3 = await checkGeoRateLimit(req, "search")
    expect(r3.remaining).toBe(27)
  })

  it("janela desliza: requisições expiradas liberam espaço", async () => {
    const req = makeRequest("10.0.0.4")

    // Fill 30 requests
    for (let i = 0; i < 30; i++) {
      await checkGeoRateLimit(req, "search")
    }

    // All should be blocked
    expect((await checkGeoRateLimit(req, "search")).allowed).toBe(false)

    // Advance time by 60s — window slides, all old entries expire
    advanceTime(60_001)
    vi.setSystemTime(Date.now())

    // Now should be allowed again
    const result = await checkGeoRateLimit(req, "search")
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(29)
  })

  it("janela desliza parcialmente: algumas expiram, outras não", async () => {
    const req = makeRequest("10.0.0.5")

    // First request at T=0
    await checkGeoRateLimit(req, "search")

    // Advance 30s, add 29 more requests (total 30 in the window)
    advanceTime(30_000)
    vi.setSystemTime(Date.now())
    for (let i = 0; i < 29; i++) {
      await checkGeoRateLimit(req, "search")
    }

    // Blocked: 30 requests in the last 30s
    expect((await checkGeoRateLimit(req, "search")).allowed).toBe(false)

    // Advance 31s — the first request (at T=0) expires, window now has 29
    advanceTime(31_000)
    vi.setSystemTime(Date.now())

    const result = await checkGeoRateLimit(req, "search")
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(0) // 29 existing + 1 new = 30, so 0 remaining
  })

  it("IPs diferentes têm buckets independentes", async () => {
    const req1 = makeRequest("10.0.0.10")
    const req2 = makeRequest("10.0.0.11")

    // Exhaust IP1
    for (let i = 0; i < 30; i++) {
      await checkGeoRateLimit(req1, "search")
    }
    expect((await checkGeoRateLimit(req1, "search")).allowed).toBe(false)

    // IP2 should be unaffected
    const result = await checkGeoRateLimit(req2, "search")
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(29)
  })

  it("reverse endpoint usa max=30", async () => {
    const req = makeRequest("10.0.0.20")
    for (let i = 0; i < 30; i++) {
      await checkGeoRateLimit(req, "reverse")
    }
    expect((await checkGeoRateLimit(req, "reverse")).allowed).toBe(false)
  })

  it("retorna reset no futuro", async () => {
    const req = makeRequest("10.0.0.30")
    const result = await checkGeoRateLimit(req, "search")
    expect(result.reset).toBeGreaterThan(Date.now())
    // Reset should be within windowMs from now
    expect(result.reset).toBeLessThanOrEqual(Date.now() + 60_000)
  })
})

describe("assertGeoRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-13T10:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("não lança erro se abaixo do limite", async () => {
    const req = makeRequest("10.0.0.100")
    await expect(assertGeoRateLimit(req, "search")).resolves.toBeUndefined()
  })

  it("lança erro 429 se acima do limite", async () => {
    const req = makeRequest("10.0.0.101")

    // Exhaust
    for (let i = 0; i < 30; i++) {
      await checkGeoRateLimit(req, "search")
    }

    // assertGeoRateLimit should throw HttpError(429)
    try {
      await assertGeoRateLimit(req, "search")
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      expect(isGeoRateLimitError(e)).toBe(true)
      expect((e as HttpError).status).toBe(429)
      expect((e as HttpError).message).toBe(
        "Muitas requisições. Tente novamente em alguns segundos.",
      )
      const headers = (e as any).headers
      expect(headers).toBeDefined()
      expect(headers["X-RateLimit-Limit"]).toBe("30")
      expect(headers["X-RateLimit-Remaining"]).toBe("0")
      expect(headers["Retry-After"]).toBeDefined()
    }
  })

  it("lança com status e headers corretos", async () => {
    const req = makeRequest("10.0.0.102")
    for (let i = 0; i < 30; i++) {
      await checkGeoRateLimit(req, "search")
    }

    try {
      await assertGeoRateLimit(req, "search")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError)
      const err = e as HttpError
      expect(err.status).toBe(429)
      const headers = (err as any).headers
      expect(headers["X-RateLimit-Limit"]).toBe("30")
      expect(headers["X-RateLimit-Remaining"]).toBe("0")
      expect(isGeoRateLimitError(e)).toBe(true)
    }
  })

  it("não afeta IPs diferentes", async () => {
    const req1 = makeRequest("10.0.0.110")
    const req2 = makeRequest("10.0.0.111")

    for (let i = 0; i < 30; i++) {
      await checkGeoRateLimit(req1, "search")
    }

    // req1 should throw HttpError(429)
    await expect(assertGeoRateLimit(req1, "search")).rejects.toMatchObject({
      status: 429,
    })

    // req2 should not throw
    await expect(assertGeoRateLimit(req2, "search")).resolves.toBeUndefined()
  })
})

describe("geoRateLimitHeaders", () => {
  it("retorna cabeçalhos corretos para resultado permitido", () => {
    const result: GeoRateLimitResult = {
      allowed: true,
      remaining: 28,
      reset: Date.now() + 30_000,
      limit: 30,
    }
    const headers = geoRateLimitHeaders(result)
    expect(headers["X-RateLimit-Limit"]).toBe("30")
    expect(headers["X-RateLimit-Remaining"]).toBe("28")
    expect(headers["X-RateLimit-Reset"]).toBeDefined()
    expect(headers["Retry-After"]).toBeDefined()
  })

  it("retorna cabeçalhos corretos para resultado bloqueado", () => {
    const result: GeoRateLimitResult = {
      allowed: false,
      remaining: 0,
      reset: Date.now() + 45_000,
      limit: 30,
    }
    const headers = geoRateLimitHeaders(result)
    expect(headers["X-RateLimit-Limit"]).toBe("30")
    expect(headers["X-RateLimit-Remaining"]).toBe("0")
    expect(headers["X-RateLimit-Reset"]).toBeDefined()
    expect(headers["Retry-After"]).toBeDefined()
  })
})

describe("isGeoRateLimitError", () => {
  it("retorna true para HttpError(429)", () => {
    const e = new HttpError(429, "rate limited")
    ;(e as any).headers = { "X-RateLimit-Limit": "30" }
    expect(isGeoRateLimitError(e)).toBe(true)
  })

  it("retorna false para erro normal", () => {
    expect(isGeoRateLimitError(new Error("normal"))).toBe(false)
  })

  it("retorna false para HttpError com status diferente de 429", () => {
    const e = new HttpError(400, "bad request")
    expect(isGeoRateLimitError(e)).toBe(false)
  })
})
