/**
 * Geo Middleware — unified HOF for all geo route handlers.
 *
 * Eliminates repetitive try/catch + rate limit + cache headers + error handling
 * from individual route handlers. Each geo route becomes a pure function that
 * only handles its business logic.
 *
 * Usage:
 *   export const GET = withGeoMiddleware(async (params) => {
 *     const { searchParams } = params
 *     const q = searchParams.get("q")
 *     const results = await geocodeSearch(q)
 *     return { data: results, cacheSeconds: 60 }
 *   })
 */
import { NextResponse } from "next/server"
import { ZodError, type ZodSchema } from "zod"
import { assertGeoRateLimit, isGeoRateLimitError, type GeoEndpoint } from "./geo-rate-limit"
import { cacheControlPublic } from "./api-server"
import { captureError } from "./sentry"
import logger from "./logger"

export type GeoContext = {
  request: Request
  searchParams: URLSearchParams
  pathname: string
}

export type GeoResponse<T> = {
  /** Response data */
  data: T
  /** HTTP status (default: 200) */
  status?: number
  /** Cache-Control max-age in seconds (default: 60) */
  cacheSeconds?: number
  /** Additional headers */
  headers?: Record<string, string>
}

type GeoHandler<T> = (ctx: GeoContext) => Promise<GeoResponse<T>>

/**
 * Higher-order function that wraps a geo route handler with:
 *   1. Rate limiting (assertGeoRateLimit)
 *   2. Error handling (ZodError → 400, GeoRateLimitError → 429, etc.)
 *   3. Cache-Control headers
 *   4. Structured error logging + Sentry
 *   5. CORS-safe response
 *
 * @param handler - Pure business logic function
 * @param options - Optional config (rateLimitType, defaultCacheSeconds)
 */
export function withGeoMiddleware<T>(
  handler: GeoHandler<T>,
  options: {
    /** Rate limit type (default: auto-detected from pathname) */
    rateLimitType?: GeoEndpoint
    /** Default cache seconds if handler doesn't specify */
    defaultCacheSeconds?: number
  } = {},
) {
  return async function GET(request: Request): Promise<NextResponse> {
    const { pathname } = new URL(request.url)
    const searchParams = new URL(request.url).searchParams

    // 1. Rate limiting
    const rateLimitType = options.rateLimitType ?? detectRateLimitType(pathname)
    try {
      await assertGeoRateLimit(request, rateLimitType)
    } catch (err) {
      if (isGeoRateLimitError(err)) {
        return noStoreJson(
          { error: "Muitas requisições. Tente novamente em alguns segundos." },
          429,
          {
            ...err.headers,
            "Content-Type": "application/json",
          },
        )
      }
      throw err
    }

    // 2. Execute handler
    try {
      const result = await handler({ request, searchParams, pathname })

      // 3. Build response with cache headers
      const status = result.status ?? 200
      const cacheSeconds = result.cacheSeconds ?? options.defaultCacheSeconds ?? 60
      const response = NextResponse.json(result.data, { status })
      // NextResponse.json does not reliably set Content-Type across runtimes —
      // the previous implementation always sent application/json explicitly.
      response.headers.set("Content-Type", "application/json")

      // Cache ONLY successful responses (house rule: never cache errors).
      // Use the house cache helper so middleware routes emit the SAME
      // Cache-Control/Vary contract as every other cached route
      // (`public, max-age=N, s-maxage=N` + `Vary: Accept-Encoding, Accept,
      // Origin`) — previously this emitted a divergent format that the
      // cache manifest, the all-cache-routes E2E and docs/CACHE_STRATEGY.md
      // did not describe. Extra handler headers are merged on top.
      if (status === 200) {
        cacheControlPublic(response, cacheSeconds)
      } else {
        response.headers.set("Cache-Control", "no-store")
      }
      for (const [key, value] of Object.entries(result.headers ?? {})) {
        response.headers.set(key, value)
      }

      return response
    } catch (err) {
      return handleGeoError(err, pathname)
    }
  }
}

// ── Error handling ────────────────────────────────────────────────────────

/**
 * JSON error response that must NEVER be cached (house rule: errors carry
 * `Cache-Control: no-store`). Used by every error exit of the middleware,
 * including the Zod 400 path — a cached 400 would pin an invalid request
 * result for the cache TTL.
 */
function noStoreJson(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  const response = NextResponse.json(body, { status, headers })
  response.headers.set("Cache-Control", "no-store")
  return response
}

function handleGeoError(err: unknown, pathname: string): NextResponse {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    return noStoreJson(
      {
        error: "Parâmetros inválidos",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      400,
    )
  }

  // Known application errors → 400 with message
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()

    if (msg.includes("inválido") || msg.includes("invalid")) {
      return noStoreJson({ error: err.message }, 400)
    }
    if (msg.includes("não encontrado") || msg.includes("not found")) {
      return noStoreJson({ error: err.message }, 404)
    }
    if (msg.includes("não autorizado") || msg.includes("unauthorized")) {
      return noStoreJson({ error: err.message }, 401)
    }

    // Generic error — don't leak internals in production
    logger.error({ err, pathname }, "geo middleware: unhandled error")
    captureError(err, { extra: { pathname } })

    const message = process.env.NODE_ENV === "production" ? "Erro interno do servidor" : err.message

    return noStoreJson({ error: message }, 500)
  }

  // Unknown error
  logger.error({ err, pathname }, "geo middleware: unknown error")
  return noStoreJson({ error: "Erro interno do servidor" }, 500)
}

// ── Helpers ───────────────────────────────────────────────────────────────

function detectRateLimitType(pathname: string): GeoEndpoint {
  if (pathname.includes("/search")) return "search"
  if (pathname.includes("/reverse")) return "reverse"
  if (pathname.includes("/cep")) return "cep"
  return "search"
}

/**
 * Zod validator helper — parses search params against a schema.
 * Returns parsed data or throws ZodError (caught by withGeoMiddleware).
 */
export function parseGeoParams<T>(searchParams: URLSearchParams, schema: ZodSchema<T>): T {
  const raw: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    raw[key] = value
  }
  return schema.parse(raw)
}
