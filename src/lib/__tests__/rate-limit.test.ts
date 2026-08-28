import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock redis module (checkRateLimit uses getClient() from redis.ts)
const mockGetClient = vi.fn()
vi.mock("@/lib/redis", () => ({
  getClient: (...args: unknown[]) => mockGetClient(...args),
}))

import { checkRateLimit, rateLimitHeaders, __testing__resetRateLimiter } from "../rate-limit"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal Request for route handler tests. */
function mockRequest(): Request {
  return new Request("http://localhost")
}

/** Build a mock redis client with controllable methods. */
function mockRedisClient(overrides: Record<string, unknown> = {}) {
  return {
    incr: vi.fn().mockResolvedValue(1),
    pexpire: vi.fn().mockResolvedValue("OK"),
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetClient.mockReturnValue(null) // default: no Redis (in-memory fallback)
  __testing__resetRateLimiter()
})

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  it("allows request when Redis is unavailable (in-memory fallback)", async () => {
    const result = await checkRateLimit(mockRequest(), {
      prefix: "test-redis-unavail",
      max: 30,
      windowMs: 60_000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(29) // max - 1 (first request in window)
    expect(result.reset).toBeGreaterThan(Date.now())
    expect(result.limit).toBe(30)
  })

  it("allows request when under limit", async () => {
    const client = mockRedisClient({ incr: vi.fn().mockResolvedValue(5) })
    mockGetClient.mockReturnValue(client)

    const result = await checkRateLimit(mockRequest(), {
      prefix: "test",
      max: 30,
      windowMs: 60_000,
    })

    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(25) // 30 - 5
    expect(result.reset).toBeGreaterThan(0)
    expect(client.incr).toHaveBeenCalledWith(expect.stringContaining("test"))
    expect(client.pexpire).not.toHaveBeenCalled() // not the first request
  })

  it("blocks request when over limit", async () => {
    const client = mockRedisClient({ incr: vi.fn().mockResolvedValue(31) })
    mockGetClient.mockReturnValue(client)

    const result = await checkRateLimit(mockRequest(), {
      prefix: "test",
      max: 30,
      windowMs: 60_000,
    })

    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0) // max(0, 30 - 31)
    expect(result.reset).toBeGreaterThan(0)
  })

  it("allows at exactly the limit", async () => {
    const client = mockRedisClient({ incr: vi.fn().mockResolvedValue(30) })
    mockGetClient.mockReturnValue(client)

    const result = await checkRateLimit(mockRequest(), {
      prefix: "test",
      max: 30,
      windowMs: 60_000,
    })

    expect(result.allowed).toBe(true) // exactly at limit is allowed
    expect(result.remaining).toBe(0) // max(0, 30 - 30)
  })

  it("sets TTL on first request in the window", async () => {
    const client = mockRedisClient({ incr: vi.fn().mockResolvedValue(1) })
    mockGetClient.mockReturnValue(client)

    await checkRateLimit(mockRequest(), {
      prefix: "test",
      max: 30,
      windowMs: 60_000,
    })

    expect(client.pexpire).toHaveBeenCalledTimes(1)
  })

  it("falls back to in-memory on Redis error", async () => {
    const client = mockRedisClient({
      incr: vi.fn().mockRejectedValue(new Error("Redis connection failed")),
    })
    mockGetClient.mockReturnValue(client)

    const result = await checkRateLimit(mockRequest(), {
      prefix: "test-fallback-redis-error",
      max: 30,
      windowMs: 60_000,
    })

    // Remaining = 29 because prefix is unique (no existing memoryStore entry)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(29)
  })

  it("uses custom identifier when provided", async () => {
    const client = mockRedisClient()
    mockGetClient.mockReturnValue(client)

    await checkRateLimit(mockRequest(), {
      prefix: "test",
      max: 30,
      windowMs: 60_000,
      identifier: "custom-user-123",
    })

    expect(client.incr).toHaveBeenCalledWith(expect.stringContaining("custom-user-123"))
  })

  it("uses different keys for different prefixes", async () => {
    const keys: string[] = []
    const client = mockRedisClient({
      incr: vi.fn().mockImplementation((key: string) => {
        keys.push(key)
        return Promise.resolve(1)
      }),
    })
    mockGetClient.mockReturnValue(client)

    const req = mockRequest()
    await checkRateLimit(req, { prefix: "login", max: 10, windowMs: 60_000 })
    await checkRateLimit(req, { prefix: "search", max: 100, windowMs: 60_000 })

    expect(keys).toHaveLength(2)
    expect(keys[0]).toContain("login")
    expect(keys[1]).toContain("search")
    expect(keys[0]).not.toBe(keys[1])
  })
})

// ---------------------------------------------------------------------------
// rateLimitHeaders
// ---------------------------------------------------------------------------

describe("rateLimitHeaders", () => {
  it("returns all standard rate limit headers", () => {
    const now = Date.now()
    const result = {
      allowed: false,
      remaining: 0,
      reset: now + 60_000,
      limit: 30,
    }

    const headers = rateLimitHeaders(result)

    expect(headers["X-RateLimit-Limit"]).toBe("30")
    expect(headers["X-RateLimit-Remaining"]).toBe("0")
    expect(headers["X-RateLimit-Reset"]).toBeDefined()
    expect(headers["Retry-After"]).toBeDefined()
  })

  it("handles zero remaining correctly", () => {
    const result = {
      allowed: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      limit: 30,
    }

    const headers = rateLimitHeaders(result)
    expect(headers["X-RateLimit-Remaining"]).toBe("0")
  })

  it("calculates Retry-After correctly", () => {
    const reset = Date.now() + 30_000
    const result = {
      allowed: true,
      remaining: 1,
      reset,
      limit: 30,
    }

    const headers = rateLimitHeaders(result)
    const retryAfter = Number(headers["Retry-After"])

    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(31)
  })
})
