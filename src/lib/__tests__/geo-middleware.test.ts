import { describe, it, expect, vi, beforeEach } from "vitest"
import { ZodError, z } from "zod"

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((data: unknown, init?: ResponseInit) => {
      const response = new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: init?.headers as HeadersInit,
      })
      return response
    }),
  },
}))

vi.mock("@/lib/geo-rate-limit", () => ({
  assertGeoRateLimit: vi.fn(),
  isGeoRateLimitError: vi.fn(),
  geoRateLimitHeaders: vi.fn(),
}))

vi.mock("@/lib/sentry", () => ({
  captureError: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  default: { error: vi.fn() },
}))

import { withGeoMiddleware, parseGeoParams, type GeoContext } from "../geo-middleware"
import { assertGeoRateLimit, isGeoRateLimitError } from "../geo-rate-limit"
import { captureError } from "../sentry"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(pathname = "/api/geo/search", query = ""): Request {
  const url = query ? `${pathname}?${query}` : pathname
  return new Request(`http://localhost${url}`, { method: "GET" })
}

function makeHandler(data: unknown = "ok", opts = {}) {
  return vi.fn(async (_ctx: GeoContext) => ({
    data,
    ...opts,
  }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withGeoMiddleware", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(isGeoRateLimitError).mockReturnValue(false)
  })

  it("returns 200 with data on success", async () => {
    const handler = makeHandler({ results: [1, 2] })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest("/api/geo/search"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ results: [1, 2] })
    expect(handler).toHaveBeenCalledOnce()
  })

  it("sets Cache-Control headers correctly", async () => {
    const handler = makeHandler("data", { cacheSeconds: 120 })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())

    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=120, stale-while-revalidate=600",
    )
    expect(response.headers.get("Vary")).toBe("Accept-Encoding")
    expect(response.headers.get("Content-Type")).toBe("application/json")
  })

  it("uses defaultCacheSeconds from options when handler omits cacheSeconds", async () => {
    const handler = makeHandler("data")
    const wrapped = withGeoMiddleware(handler, { defaultCacheSeconds: 30 })
    const response = await wrapped(makeRequest())

    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=30, stale-while-revalidate=150",
    )
  })

  it("falls back to 60 when neither handler nor options specify cache", async () => {
    const handler = makeHandler("data")
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())

    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    )
  })

  it("merges custom headers from handler result", async () => {
    const handler = makeHandler("data", { headers: { "X-Custom": "yes" } })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())

    expect(response.headers.get("X-Custom")).toBe("yes")
  })

  it("returns 429 when rate limited", async () => {
    const rlError = Object.assign(new Error("rate limited"), {
      headers: { "Retry-After": "5" },
    })
    vi.mocked(isGeoRateLimitError).mockReturnValue(true)
    vi.mocked(assertGeoRateLimit).mockRejectedValue(rlError)

    const handler = makeHandler()
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body.error).toBe("Muitas requisições. Tente novamente em alguns segundos.")
    expect(handler).not.toHaveBeenCalled()
  })

  it("re-throws non-rate-limit errors from assertGeoRateLimit", async () => {
    const otherError = new Error("redis down")
    vi.mocked(assertGeoRateLimit).mockRejectedValue(otherError)

    const handler = makeHandler()
    const wrapped = withGeoMiddleware(handler)

    await expect(wrapped(makeRequest())).rejects.toThrow("redis down")
  })

  it("returns 400 on ZodError", async () => {
    const handler = vi.fn(async () => {
      throw new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          path: ["q"],
          message: "Required",
        },
      ] as never)
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe("Parâmetros inválidos")
    expect(body.details).toEqual([{ path: "q", message: "Required" }])
  })

  it("returns 400 on error containing 'inválido'", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Endereço inválido")
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe("Endereço inválido")
  })

  it("returns 400 on error containing 'invalid'", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Invalid coordinates")
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe("Invalid coordinates")
  })

  it("returns 404 on error containing 'não encontrado'", async () => {
    const handler = vi.fn(async () => {
      throw new Error("CEP não encontrado")
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe("CEP não encontrado")
  })

  it("returns 404 on error containing 'not found'", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Location not found")
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe("Location not found")
  })

  it("returns 401 on error containing 'não autorizado'", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Acesso não autorizado")
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe("Acesso não autorizado")
  })

  it("returns 401 on error containing 'unauthorized'", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Unauthorized")
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 500 with error details in development", async () => {
    const handler = vi.fn(async () => {
      throw new Error("Something broke")
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())

    expect(response.status).toBe(500)
    expect(captureError).toHaveBeenCalledOnce()
  })

  it("returns 500 for unknown (non-Error) throws", async () => {
    const handler = vi.fn(async () => {
      throw "raw string error"
    })
    const wrapped = withGeoMiddleware(handler)
    const response = await wrapped(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe("Erro interno do servidor")
  })

  it("passes searchParams and pathname to handler", async () => {
    const handler = makeHandler()
    const wrapped = withGeoMiddleware(handler)
    await wrapped(makeRequest("/api/geo/search", "q=salvador&limit=5"))

    const ctx = handler.mock.calls[0][0] as GeoContext
    expect(ctx.pathname).toBe("/api/geo/search")
    expect(ctx.searchParams.get("q")).toBe("salvador")
    expect(ctx.searchParams.get("limit")).toBe("5")
  })

  it("passes the original Request object to handler", async () => {
    const handler = makeHandler()
    const wrapped = withGeoMiddleware(handler)
    const req = makeRequest()
    await wrapped(req)

    const ctx = handler.mock.calls[0][0] as GeoContext
    expect(ctx.request).toBe(req)
  })

  it("uses custom rateLimitType when provided", async () => {
    const handler = makeHandler()
    const wrapped = withGeoMiddleware(handler, { rateLimitType: "cep" })
    await wrapped(makeRequest("/api/geo/something"))

    expect(assertGeoRateLimit).toHaveBeenCalledWith(expect.anything(), "cep")
  })

  it("auto-detects rate limit type from pathname", async () => {
    const handler = makeHandler()

    const wrappedReverse = withGeoMiddleware(handler)
    await wrappedReverse(makeRequest("/api/geo/reverse"))
    expect(assertGeoRateLimit).toHaveBeenCalledWith(expect.anything(), "reverse")

    const wrappedCep = withGeoMiddleware(handler)
    await wrappedCep(makeRequest("/api/geo/cep/01000-000"))
    expect(assertGeoRateLimit).toHaveBeenCalledWith(expect.anything(), "cep")

    const wrappedSearch = withGeoMiddleware(handler)
    await wrappedSearch(makeRequest("/api/geo/search"))
    expect(assertGeoRateLimit).toHaveBeenCalledWith(expect.anything(), "search")

    const wrappedDefault = withGeoMiddleware(handler)
    await wrappedDefault(makeRequest("/api/geo/other"))
    expect(assertGeoRateLimit).toHaveBeenCalledWith(expect.anything(), "search")
  })
})

describe("parseGeoParams", () => {
  it("parses valid search params against a Zod schema", () => {
    const schema = z.object({ q: z.string(), limit: z.string().optional() })
    const params = new URLSearchParams("q=salvador&limit=10")

    const result = parseGeoParams(params, schema)
    expect(result).toEqual({ q: "salvador", limit: "10" })
  })

  it("omits unspecified optional fields", () => {
    const schema = z.object({ q: z.string(), lang: z.string().optional() })
    const params = new URLSearchParams("q=test")

    const result = parseGeoParams(params, schema)
    expect(result).toEqual({ q: "test" })
  })

  it("throws ZodError on invalid params", () => {
    const schema = z.object({ q: z.string().min(1) })
    const params = new URLSearchParams("q=")

    expect(() => parseGeoParams(params, schema)).toThrow(ZodError)
  })

  it("throws ZodError when required field is missing", () => {
    const schema = z.object({ q: z.string() })
    const params = new URLSearchParams("other=foo")

    expect(() => parseGeoParams(params, schema)).toThrow(ZodError)
  })

  it("returns empty object shape when schema allows it", () => {
    const schema = z.object({})
    const params = new URLSearchParams("a=1&b=2")

    const result = parseGeoParams(params, schema)
    expect(result).toEqual({})
  })
})
