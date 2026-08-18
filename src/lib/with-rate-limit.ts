/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only"
import { checkRateLimit, rateLimitHeaders } from "./rate-limit"

type Handler<Args extends unknown[] = []> = (request: Request, ...args: Args) => Promise<Response>

/**
 * Higher-order function that wraps a route handler with server-side rate
 * limiting. Uses the shared Redis-backed rate limiter from rate-limit.ts.
 *
 * @example
 *   export const GET = withRateLimit(async (req) => { ... }, 30, 60_000)
 */
export function withRateLimit<Args extends unknown[] = []>(
  handler: Handler<Args>,
  max = 30,
  windowMs = 60_000,
): Handler<Args> {
  return async (request: Request, ...args: Args) => {
    const url = new URL(request.url)
    // Use a sanitised pathname as the rate-limit prefix so each endpoint
    // has its own counter. The client IP is extracted automatically by
    // checkRateLimit from the Request headers (x-forwarded-for / x-real-ip).
    const prefix = url.pathname.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "")

    const result = await checkRateLimit(request, { prefix, max, windowMs })

    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          error: "Muitas requisições. Tente novamente em alguns segundos.",
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            ...rateLimitHeaders(result),
          },
        },
      )
    }

    const response = await handler(request, ...args)

    // Attach rate-limit metadata on every response
    const headers = new Headers(response.headers)
    headers.set("X-RateLimit-Remaining", String(result.remaining))
    headers.set("X-RateLimit-Reset", String(Math.ceil(result.reset / 1000)))
    headers.set("X-RateLimit-Limit", String(result.limit))

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}
