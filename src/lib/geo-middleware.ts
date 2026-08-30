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
        return NextResponse.json(
          { error: "Muitas requisições. Tente novamente em alguns segundos." },
          {
            status: 429,
            headers: {
              ...err.headers,
              "Content-Type": "application/json",
            },
          },
        )
      }
      throw err
    }

    // 2. Execute handler
    try {
      const result = await handler({ request, searchParams, pathname })

      // 3. Build response with cache headers
      const cacheSeconds = result.cacheSeconds ?? options.defaultCacheSeconds ?? 60
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Cache-Control": `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`,
        "Vary": "Accept-Encoding",
        ...result.headers,
      }

      return NextResponse.json(result.data, {
        status: result.status ?? 200,
        headers,
      })
    } catch (err) {
      return handleGeoError(err, pathname)
    }
  }
}

// ── Error handling ────────────────────────────────────────────────────────

function handleGeoError(err: unknown, pathname: string): NextResponse {
  // Zod validation errors → 400
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Parâmetros inválidos",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    )
  }

  // Known application errors → 400 with message
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()

    if (msg.includes("inválido") || msg.includes("invalid")) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (msg.includes("não encontrado") || msg.includes("not found")) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (msg.includes("não autorizado") || msg.includes("unauthorized")) {
      return NextResponse.json({ error: err.message }, { status: 401 })
    }

    // Generic error — don't leak internals in production
    logger.error({ err, pathname }, "geo middleware: unhandled error")
    captureError(err, { extra: { pathname } })

    const message = process.env.NODE_ENV === "production"
      ? "Erro interno do servidor"
      : err.message

    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Unknown error
  logger.error({ err, pathname }, "geo middleware: unknown error")
  return NextResponse.json({ error: "Erro interno do servidor" }, { status: 500 })
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
