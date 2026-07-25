/**
 * Unit tests for src/middleware.ts
 *
 * Tests the Edge middleware function in isolation by mocking its
 * dependencies (crypto-session, edge-rate-limit) and asserting on
 * the returned NextResponse (status, headers, redirect URL).
 *
 * Pattern follows the existing edge-rate-limit.test.ts conventions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE_NAME } from "@/lib/crypto-session"

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSignPayload = vi.fn<[string], Promise<string>>()
const mockParseCookieValue = vi.fn<
  [string],
  | { userId: string; role: string; expiresAt: number; signature: string }
  | null
>()
const mockConstantTimeEqual = vi.fn<[string, string], boolean>()
const mockCheckEdgeRateLimit = vi.fn()
const mockPickRateLimitForPath = vi.fn()
const mockEdgeRateLimitHeaders = vi.fn()

vi.mock("@/lib/crypto-session", () => ({
  SESSION_COOKIE_NAME: "severinno_session",
  signPayload: (...args: [string]) => mockSignPayload(...args),
  parseCookieValue: (...args: [string]) => mockParseCookieValue(...args),
  constantTimeEqual: (...args: [string, string]) =>
    mockConstantTimeEqual(...args),
}))

vi.mock("@/lib/edge-rate-limit", () => ({
  checkEdgeRateLimit: (...args: unknown[]) => mockCheckEdgeRateLimit(...args),
  pickRateLimitForPath: (...args: unknown[]) =>
    mockPickRateLimitForPath(...args),
  edgeRateLimitHeaders: (...args: unknown[]) =>
    mockEdgeRateLimitHeaders(...args),
}))

// ---------------------------------------------------------------------------
// Module under test (must be imported AFTER mocks)
// ---------------------------------------------------------------------------

const { middleware } = await import("../../middleware")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_SESSION_COOKIE = "user-1.CLIENT.2000000000.abcdef123456"
const VALID_SIGNATURE = "abcdef123456"

function mockNextRequest(overrides: {
  url?: string
  cookieValue?: string | null
  headers?: Record<string, string>
  method?: string
} = {}): NextRequest {
  const {
    url = "http://localhost:3000/",
    cookieValue = null,
    headers = {},
    method = "GET",
  } = overrides

  const parsedUrl = new URL(url)
  const cookieEntries: [string, string][] = cookieValue
    ? [[SESSION_COOKIE_NAME, cookieValue]]
    : []

  const req = {
    url,
    nextUrl: parsedUrl,
    method,
    headers: new Headers(headers),
    cookies: {
      get: (name: string) => {
        const entry = cookieEntries.find(([k]) => k === name)
        return entry ? { name: entry[0], value: entry[1] } : undefined
      },
      getAll: () => cookieEntries.map(([name, value]) => ({ name, value })),
    },
  } as unknown as NextRequest

  return req
}

function makeValidSession() {
  mockParseCookieValue.mockReturnValue({
    userId: "user-1",
    role: "CLIENT",
    expiresAt: 2_000_000_000, // far future
    signature: VALID_SIGNATURE,
  })
  mockSignPayload.mockResolvedValue(VALID_SIGNATURE)
  mockConstantTimeEqual.mockReturnValue(true)
}

function makeAdminSession() {
  mockParseCookieValue.mockReturnValue({
    userId: "admin-1",
    role: "ADMIN",
    expiresAt: 2_000_000_000,
    signature: VALID_SIGNATURE,
  })
  mockSignPayload.mockResolvedValue(VALID_SIGNATURE)
  mockConstantTimeEqual.mockReturnValue(true)
}

function makeProviderSession() {
  mockParseCookieValue.mockReturnValue({
    userId: "prov-1",
    role: "PROVIDER",
    expiresAt: 2_000_000_000,
    signature: VALID_SIGNATURE,
  })
  mockSignPayload.mockResolvedValue(VALID_SIGNATURE)
  mockConstantTimeEqual.mockReturnValue(true)
}

// Default: rate limit allows every request
function allowRateLimit() {
  mockPickRateLimitForPath.mockReturnValue({
    prefix: "general",
    max: 60,
    windowMs: 60_000,
  })
  mockCheckEdgeRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    limit: 60,
    reset: Date.now() + 60_000,
  })
  mockEdgeRateLimitHeaders.mockReturnValue({
    "X-RateLimit-Limit": "60",
    "X-RateLimit-Remaining": "59",
    "X-RateLimit-Reset": String(Date.now() + 60_000),
    "Retry-After": "0",
  })
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = "test-cron-secret"
})

// ---------------------------------------------------------------------------
// Security Headers
// ---------------------------------------------------------------------------

describe("security headers", () => {
  it("adds X-DNS-Prefetch-Control to all responses", async () => {
    allowRateLimit()
    const req = mockNextRequest({ url: "http://localhost:3000/" })
    const res = await middleware(req)

    expect(res.headers.get("X-DNS-Prefetch-Control")).toBe("on")
  })

  it("adds Strict-Transport-Security to all responses", async () => {
    allowRateLimit()
    const req = mockNextRequest({ url: "http://localhost:3000/" })
    const res = await middleware(req)

    expect(res.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    )
  })

  it("adds Permissions-Policy to all responses", async () => {
    allowRateLimit()
    const req = mockNextRequest({ url: "http://localhost:3000/" })
    const res = await middleware(req)

    expect(res.headers.get("Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=(self)",
    )
  })
})

// ---------------------------------------------------------------------------
// Rate Limiting Integration
// ---------------------------------------------------------------------------

describe("rate limiting", () => {
  it("applies rate limit headers to API routes", async () => {
    mockPickRateLimitForPath.mockReturnValue({
      prefix: "general",
      max: 60,
      windowMs: 60_000,
    })
    mockCheckEdgeRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 58,
      limit: 60,
      reset: Date.now() + 60_000,
    })
    mockEdgeRateLimitHeaders.mockReturnValue({
      "X-RateLimit-Limit": "60",
      "X-RateLimit-Remaining": "58",
      "X-RateLimit-Reset": "99999",
      "Retry-After": "0",
    })

    const req = mockNextRequest({ url: "http://localhost:3000/api/providers" })
    const res = await middleware(req)

    expect(res.headers.get("X-RateLimit-Limit")).toBe("60")
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("58")
    expect(res.headers.get("X-RateLimit-Reset")).toBeDefined()
  })

  it("returns 429 when rate limit is exceeded", async () => {
    mockPickRateLimitForPath.mockReturnValue({
      prefix: "login",
      max: 5,
      windowMs: 60_000,
    })
    mockCheckEdgeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 5,
      reset: Date.now() + 60_000,
    })
    mockEdgeRateLimitHeaders.mockReturnValue({
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Date.now() + 60_000),
      "Retry-After": "60",
    })

    const req = mockNextRequest({
      url: "http://localhost:3000/api/auth/login",
    })
    const res = await middleware(req)

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toContain("Muitas requisições")
  })

  it("includes Retry-After header in 429 response", async () => {
    mockPickRateLimitForPath.mockReturnValue({
      prefix: "login",
      max: 5,
      windowMs: 60_000,
    })
    mockCheckEdgeRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      limit: 5,
      reset: Date.now() + 60_000,
    })
    mockEdgeRateLimitHeaders.mockReturnValue({
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(Date.now() + 60_000),
      "Retry-After": "60",
    })

    const req = mockNextRequest({
      url: "http://localhost:3000/api/auth/login",
    })
    const res = await middleware(req)

    expect(res.headers.get("Retry-After")).toBe("60")
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5")
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0")
  })

  it("does not rate limit cron routes", async () => {
    // Cron routes should skip rate limiting entirely
    const req = mockNextRequest({
      url: "http://localhost:3000/api/cron/reminders",
      headers: { authorization: "Bearer test-cron-secret" },
    })
    const res = await middleware(req)

    // Should pass through without calling rate limit functions
    expect(mockPickRateLimitForPath).not.toHaveBeenCalled()
    expect(mockCheckEdgeRateLimit).not.toHaveBeenCalled()
  })

  it("does not rate limit non-API routes", async () => {
    const req = mockNextRequest({ url: "http://localhost:3000/" })
    const res = await middleware(req)

    expect(mockPickRateLimitForPath).not.toHaveBeenCalled()
    expect(mockCheckEdgeRateLimit).not.toHaveBeenCalled()
    // Security headers should still be present
    expect(res.headers.get("X-DNS-Prefetch-Control")).toBe("on")
  })

  it("calls pickRateLimitForPath with the correct path", async () => {
    allowRateLimit()
    const req = mockNextRequest({
      url: "http://localhost:3000/api/auth/login",
    })
    await middleware(req)

    expect(mockPickRateLimitForPath).toHaveBeenCalledWith("/api/auth/login")
  })
})

// ---------------------------------------------------------------------------
// Session Verification — valid session
// ---------------------------------------------------------------------------

describe("session verification", () => {
  it("passes through for public API routes without session", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/api/health",
      cookieValue: null,
    })
    const res = await middleware(req)

    // Public routes should pass through without error
    expect(res.status).toBe(200)
    // Should have security headers
    expect(res.headers.get("X-DNS-Prefetch-Control")).toBe("on")
  })

  it("passes through for /api/auth/me without session", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/api/auth/me",
      cookieValue: null,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("returns 401 for protected API route without cookie", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: null,
    })
    const res = await middleware(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Não autorizado")
  })

  it("returns 401 for protected API route with malformed cookie", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: "malformed-cookie-value",
    })
    const res = await middleware(req)

    expect(res.status).toBe(401)
  })

  it("returns 401 for protected API route with expired session", async () => {
    allowRateLimit()
    // Session expired (expiresAt is in the past)
    mockParseCookieValue.mockReturnValue({
      userId: "user-1",
      role: "CLIENT",
      expiresAt: 1_000_000_000, // past
      signature: VALID_SIGNATURE,
    })

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Sessão inválida")
  })

  it("returns 401 for protected API route with invalid HMAC signature", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue({
      userId: "user-1",
      role: "CLIENT",
      expiresAt: 2_000_000_000,
      signature: VALID_SIGNATURE,
    })
    mockSignPayload.mockResolvedValue("different-signature")
    mockConstantTimeEqual.mockReturnValue(false)

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Sessão inválida")
    expect(mockConstantTimeEqual).toHaveBeenCalled()
  })

  it("passes through for valid session on protected API route", async () => {
    allowRateLimit()
    makeValidSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
    // Forwarded user headers
    expect(res.headers.get("x-user-id")).toBe("user-1")
    expect(res.headers.get("x-user-role")).toBe("CLIENT")
  })

  it("redirects to home for dashboard pages without session", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/dashboard",
      cookieValue: null,
    })
    const res = await middleware(req)

    expect(res.status).toBe(307) // redirect
    expect(res.headers.get("location")).toBe("http://localhost:3000/")
  })

  it("redirects to home for dashboard pages with invalid session", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue({
      userId: "user-1",
      role: "CLIENT",
      expiresAt: 1_000_000_000,
      signature: VALID_SIGNATURE,
    })

    const req = mockNextRequest({
      url: "http://localhost:3000/dashboard",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://localhost:3000/")
  })

  it("passes through for valid session on dashboard page", async () => {
    allowRateLimit()
    makeValidSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/dashboard",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("forwards user info via headers on valid session", async () => {
    allowRateLimit()
    makeValidSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.headers.get("x-user-id")).toBe("user-1")
    expect(res.headers.get("x-user-role")).toBe("CLIENT")
  })

  it("forwards admin user info via headers", async () => {
    allowRateLimit()
    makeAdminSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/admin/finance",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.headers.get("x-user-id")).toBe("admin-1")
    expect(res.headers.get("x-user-role")).toBe("ADMIN")
  })
})

// ---------------------------------------------------------------------------
// Role-Based API Protection
// ---------------------------------------------------------------------------

describe("role-based route protection", () => {
  it("allows ADMIN on /api/admin routes", async () => {
    allowRateLimit()
    makeAdminSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/admin/finance",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("x-user-role")).toBe("ADMIN")
  })

  it("blocks CLIENT on /api/admin routes with 403", async () => {
    allowRateLimit()
    makeValidSession() // CLIENT role

    const req = mockNextRequest({
      url: "http://localhost:3000/api/admin/finance",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Acesso proibido")
  })

  it("blocks PROVIDER on /api/admin routes with 403", async () => {
    allowRateLimit()
    makeProviderSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/admin/finance",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(403)
  })

  it("allows PROVIDER on /api/provider routes", async () => {
    allowRateLimit()
    makeProviderSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/provider/wallet",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("x-user-role")).toBe("PROVIDER")
  })

  it("allows ADMIN on /api/provider routes", async () => {
    allowRateLimit()
    makeAdminSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/provider/wallet",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
    expect(res.headers.get("x-user-role")).toBe("ADMIN")
  })

  it("blocks CLIENT on /api/provider routes with 403", async () => {
    allowRateLimit()
    makeValidSession() // CLIENT

    const req = mockNextRequest({
      url: "http://localhost:3000/api/provider/wallet",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe("Acesso proibido")
  })

  it("allows CLIENT on /api/bookings (role-agnostic route)", async () => {
    allowRateLimit()
    makeValidSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("allows PROVIDER on /api/bookings (role-agnostic route)", async () => {
    allowRateLimit()
    makeProviderSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/bookings",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("handles nested /api/admin/sub routes", async () => {
    allowRateLimit()
    makeAdminSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/admin/commissions/export",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("handles nested /api/provider/sub routes", async () => {
    allowRateLimit()
    makeProviderSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/api/provider/lytex",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Cron Routes
// ---------------------------------------------------------------------------

describe("cron route protection", () => {
  it("allows cron routes with valid CRON_SECRET", async () => {
    // Cron routes bypass rate limiting AND session check
    const req = mockNextRequest({
      url: "http://localhost:3000/api/cron/reminders",
      headers: { authorization: "Bearer test-cron-secret" },
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("blocks cron routes without CRON_SECRET header", async () => {
    const req = mockNextRequest({
      url: "http://localhost:3000/api/cron/reminders",
      cookieValue: null,
    })
    const res = await middleware(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Não autorizado")
  })

  it("blocks cron routes with wrong CRON_SECRET", async () => {
    const req = mockNextRequest({
      url: "http://localhost:3000/api/cron/reminders",
      headers: { authorization: "Bearer wrong-secret" },
    })
    const res = await middleware(req)

    expect(res.status).toBe(401)
  })

  it("blocks cron routes when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET
    const req = mockNextRequest({
      url: "http://localhost:3000/api/cron/reminders",
      headers: { authorization: "Bearer test-cron-secret" },
    })
    const res = await middleware(req)

    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// Public API Routes
// ---------------------------------------------------------------------------

describe("public API routes", () => {
  const PUBLIC_ROUTES = [
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/me",
    "/api/auth/logout",
    "/api/categories",
    "/api/providers",
    "/api/search",
    "/api/search/providers",
    "/api/search/services",
    "/api/geo/cep",
    "/api/geo/reverse",
    "/api/health",
    "/api/stats/public",
    "/api/reviews/recent",
    "/api/newsletter",
    "/api/sentry",
    "/api/webhooks/lytex",
  ]

  for (const route of PUBLIC_ROUTES) {
    it(`passes through ${route} without session`, async () => {
      allowRateLimit()
      mockParseCookieValue.mockReturnValue(null)

      const req = mockNextRequest({
        url: `http://localhost:3000${route}`,
        cookieValue: null,
      })
      const res = await middleware(req)

      // Public routes don't require auth
      expect(res.status).toBe(200)
    })
  }

  it("passes through dynamic provider detail route", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/api/providers/prov-123",
      cookieValue: null,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("passes through dynamic category route", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/api/categories/cat-eletrica",
      cookieValue: null,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Settings Pages
// ---------------------------------------------------------------------------

describe("settings pages", () => {
  it("redirects to home for /settings without session", async () => {
    allowRateLimit()
    mockParseCookieValue.mockReturnValue(null)

    const req = mockNextRequest({
      url: "http://localhost:3000/settings",
      cookieValue: null,
    })
    const res = await middleware(req)

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://localhost:3000/")
  })

  it("passes through for /settings with valid session", async () => {
    allowRateLimit()
    makeValidSession()

    const req = mockNextRequest({
      url: "http://localhost:3000/settings",
      cookieValue: VALID_SESSION_COOKIE,
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// Non-API, Non-Protected Routes (should pass through)
// ---------------------------------------------------------------------------

describe("non-API non-protected routes", () => {
  it("passes through the home page", async () => {
    allowRateLimit()
    const req = mockNextRequest({ url: "http://localhost:3000/" })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("passes through static asset routes", async () => {
    allowRateLimit()
    const req = mockNextRequest({
      url: "http://localhost:3000/_next/static/chunk.js",
    })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })

  it("passes through the search page", async () => {
    allowRateLimit()
    const req = mockNextRequest({ url: "http://localhost:3000/busca" })
    const res = await middleware(req)

    expect(res.status).toBe(200)
  })
})
