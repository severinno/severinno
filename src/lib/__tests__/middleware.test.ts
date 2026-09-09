/**
 * Tests for proxy.ts (Next.js 16 — formerly middleware.ts) — global rate
 * limiting middleware for /api/*.
 *
 * Coverage:
 *   1. Request permitido — checkGlobalRateLimit permite → NextResponse.next()
 *      com headers X-Global-RateLimit-* + CORS
 *   2. Request bloqueado — checkGlobalRateLimit nega → 429 com Retry-After,
 *      body JSON com error/retryAfter e headers de rate limit
 *   3. Rotas bypass — /api/health e /api/webhooks/* (incl. trailing slash)
 *      → checkGlobalRateLimit NÃO é chamado
 *   4. OPTIONS preflight — 204 + headers CORS, sem chamar o rate limiter
 *
 * checkGlobalRateLimit é mockado; globalRateLimitHeaders permanece real
 * (função pura e determinística) para validar a integração real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// NOTE: root proxy.ts (global rate limiting, formerly middleware.ts).
// From src/lib/__tests__/, the root is ../../../.
import { proxy } from "../../../proxy"
import { globalRateLimitHeaders, type GlobalRateLimitResult } from "@/lib/global-rate-limit"

// ---------------------------------------------------------------------------
// Mocks — only checkGlobalRateLimit is mocked; globalRateLimitHeaders stays
// real so the middleware's header wiring is exercised against real output.
// ---------------------------------------------------------------------------

const { mockCheckGlobalRateLimit } = vi.hoisted(() => ({
  mockCheckGlobalRateLimit: vi.fn(),
}))

vi.mock("@/lib/global-rate-limit", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/global-rate-limit")>()
  return { ...mod, checkGlobalRateLimit: mockCheckGlobalRateLimit }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NextRequest for the middleware with a stable client IP. */
function makeRequest(path: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "x-forwarded-for": "203.0.113.10", origin: "http://localhost:3000" },
  })
}

function allowedResult(overrides: Partial<GlobalRateLimitResult> = {}): GlobalRateLimitResult {
  return {
    allowed: true,
    remaining: 99,
    reset: Date.now() + 60_000,
    limit: 100,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("middleware — global rate limit", () => {
  beforeEach(() => {
    mockCheckGlobalRateLimit.mockReset()
    // Ensure the env-var whitelist doesn't leak between tests
    delete process.env.GLOBAL_RATE_LIMIT_WHITELIST
  })

  afterEach(() => {
    delete process.env.GLOBAL_RATE_LIMIT_WHITELIST
  })

  // -------------------------------------------------------------------------
  // 1. Request permitido
  // -------------------------------------------------------------------------

  it("permite a requisição e anexa headers X-Global-RateLimit-* + CORS", async () => {
    mockCheckGlobalRateLimit.mockResolvedValue(allowedResult())

    const req = makeRequest("/api/providers")
    const response = await proxy(req)

    // checkGlobalRateLimit recebe a própria request (para extrair IP/rota)
    expect(mockCheckGlobalRateLimit).toHaveBeenCalledTimes(1)
    expect(mockCheckGlobalRateLimit).toHaveBeenCalledWith(req)

    // NextResponse.next() → 200
    expect(response.status).toBe(200)

    // Headers de rate limit — valores vêm do globalRateLimitHeaders REAL
    expect(response.headers.get("X-Global-RateLimit-Limit")).toBe("100")
    expect(response.headers.get("X-Global-RateLimit-Remaining")).toBe("99")
    expect(response.headers.get("X-Global-RateLimit-Reset")).toBeDefined()

    // CORS — origem permitida (dev default) é ecoada
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000")
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET")
  })

  // -------------------------------------------------------------------------
  // 2. Request bloqueado
  // -------------------------------------------------------------------------

  it("bloqueia com 429 + Retry-After quando o limite é excedido", async () => {
    const reset = Date.now() + 30_000
    mockCheckGlobalRateLimit.mockResolvedValue(
      allowedResult({ allowed: false, remaining: 0, reset }),
    )

    const req = makeRequest("/api/providers")
    const response = await proxy(req)

    expect(response.status).toBe(429)

    // Retry-After (≈30s a partir de agora, arredondado) + headers de limite
    const retryAfter = response.headers.get("Retry-After")
    expect(retryAfter).toBeDefined()
    expect(Number(retryAfter)).toBeGreaterThan(0)
    expect(Number(retryAfter)).toBeLessThanOrEqual(30)
    expect(response.headers.get("X-Global-RateLimit-Limit")).toBe("100")

    // Body JSON com error + retryAfter
    const body = JSON.parse(await response.text())
    expect(body.error).toMatch(/Muitas requisições/i)
    expect(body.retryAfter).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // 3. Rotas bypass
  // -------------------------------------------------------------------------

  it("não aplica rate limit em /api/health (rota fixa)", async () => {
    const response = await proxy(makeRequest("/api/health"))

    expect(response.status).toBe(200)
    expect(mockCheckGlobalRateLimit).not.toHaveBeenCalled()
    expect(response.headers.get("X-Global-RateLimit-Limit")).toBeNull()
  })

  it("normaliza trailing slash — /api/health/ também é bypass", async () => {
    const response = await proxy(makeRequest("/api/health/"))

    expect(response.status).toBe(200)
    expect(mockCheckGlobalRateLimit).not.toHaveBeenCalled()
  })

  it("não aplica rate limit em /api/webhooks/* (prefixo)", async () => {
    const response = await proxy(makeRequest("/api/webhooks/evolution/message"))

    expect(response.status).toBe(200)
    expect(mockCheckGlobalRateLimit).not.toHaveBeenCalled()
    expect(response.headers.get("X-Global-RateLimit-Limit")).toBeNull()
  })

  it("respeita GLOBAL_RATE_LIMIT_WHITELIST via env var", async () => {
    process.env.GLOBAL_RATE_LIMIT_WHITELIST = "/api/health"

    const response = await proxy(makeRequest("/api/health/detailed"))

    expect(response.status).toBe(200)
    expect(mockCheckGlobalRateLimit).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // 4. OPTIONS preflight
  // -------------------------------------------------------------------------

  it("responde OPTIONS preflight com 204 + CORS sem consultar o rate limiter", async () => {
    const response = await proxy(makeRequest("/api/providers", "OPTIONS"))

    expect(response.status).toBe(204)
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000")
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("OPTIONS")
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization")
    expect(mockCheckGlobalRateLimit).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Header wiring — globalRateLimitHeaders real
  // -------------------------------------------------------------------------

  it("usa o globalRateLimitHeaders real para os headers de resposta", async () => {
    const result = allowedResult({ remaining: 42 })
    mockCheckGlobalRateLimit.mockResolvedValue(result)

    const response = await proxy(makeRequest("/api/geo/search"))

    const expected = globalRateLimitHeaders(result)
    // Retry-After é derivado de Date.now() dentro do middleware — comparado
    // separadamente com margem para evitar flakiness em CI lento.
    for (const [key, value] of Object.entries(expected)) {
      if (key === "Retry-After") continue
      expect(response.headers.get(key)).toBe(value)
    }
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0)
  })
})
