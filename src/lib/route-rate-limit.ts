/**
 * route-rate-limit.ts
 *
 * Per-route rate limiting for sensitive endpoints (login, register, etc.).
 *
 * This is a SECOND layer of defense on top of the global rate limiter.
 * While the global limiter (global-rate-limit.ts) provides a uniform cap
 * for all /api/* routes, this module applies stricter, route-specific limits:
 *
 *   - /api/auth/login        →  5 req/min per IP
 *   - /api/auth/register     →  3 req/min per IP
 *   - /api/auth/forgot-password → 3 req/min per IP
 *   - /api/auth/reset-password  → 5 req/min per IP
 *   - /api/push/subscribe    → 10 req/min per IP
 *   - /api/push/click        → 30 req/min per IP
 *   - /api/quotes/[id]/book  → 10 req/min per IP
 *
 * Uses the same Upstash + in-memory fallback pattern as the global limiter,
 * but with its own key namespace so the two layers don't interfere.
 *
 * Configuration via env vars:
 *   ROUTE_RATE_LIMIT_ENABLED  — Set to "false" to disable (default "true")
 *
 * Each route also has an env override:
 *   ROUTE_RATE_LIMIT_LOGIN_MAX  — Override login limit
 *   ROUTE_RATE_LIMIT_REGISTER_MAX — Override register limit
 *   etc.
 */

import type { NextRequest } from "next/server"
import { Redis } from "@upstash/redis/cloudflare"

// ---------------------------------------------------------------------------
// Route-specific limits
// ---------------------------------------------------------------------------

type RouteLimit = {
  /** Route pattern as a regex source string. */
  pattern: string
  /** Compiled regex (cached after first use). */
  regex?: RegExp
  /** Max requests per window. */
  max: number
  /** Window in milliseconds. */
  windowMs: number
}

const DEFAULT_WINDOW = 60_000 // 1 minute

const ROUTE_LIMITS: RouteLimit[] = [
  // Auth — brute force protection
  {
    pattern: "^/api/auth/login$",
    max: 5,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/auth/register$",
    max: 3,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/auth/forgot-password$",
    max: 3,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/auth/reset-password$",
    max: 5,
    windowMs: DEFAULT_WINDOW,
  },
  // Push — prevent abuse
  {
    pattern: "^/api/push/subscribe$",
    max: 10,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/push/click$",
    max: 30,
    windowMs: DEFAULT_WINDOW,
  },
  // Booking — rate-limit creation
  {
    pattern: "^/api/quotes/[^/]+/book$",
    max: 10,
    windowMs: DEFAULT_WINDOW,
  },
  // Contact / newsletter
  {
    pattern: "^/api/newsletter$",
    max: 5,
    windowMs: DEFAULT_WINDOW,
  },
  // Public search — prevent scraping / DoS (30 req/min per fingerprint)
  {
    pattern: "^/api/search$",
    max: 30,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/search/providers$",
    max: 30,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/providers$",
    max: 30,
    windowMs: DEFAULT_WINDOW,
  },
  // Geo endpoints — prevent geocoding abuse (20 req/min)
  {
    pattern: "^/api/geo/search$",
    max: 20,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/geo/reverse$",
    max: 20,
    windowMs: DEFAULT_WINDOW,
  },
  {
    pattern: "^/api/geo/cep$",
    max: 20,
    windowMs: DEFAULT_WINDOW,
  },
]

// Compile patterns and apply env overrides
for (const rl of ROUTE_LIMITS) {
  rl.regex = new RegExp(rl.pattern)
  // Map e.g. "login" → "ROUTE_RATE_LIMIT_LOGIN_MAX"
  const match = rl.pattern.match(/\/([a-z-]+)\/$/)
  if (match) {
    const envKey = `ROUTE_RATE_LIMIT_${match[1].toUpperCase().replace(/-/g, "_")}_MAX`
    const envVal = process.env[envKey]
    if (envVal) {
      const parsed = Number.parseInt(envVal, 10)
      if (!Number.isNaN(parsed) && parsed > 0) {
        rl.max = parsed
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis client (lazy, REST-based, Edge-compatible)
// ---------------------------------------------------------------------------

let upstashClient: Redis | null = null
let upstashConfigured = false

function getUpstashClient(): Redis | null {
  if (upstashClient !== null) return upstashClient
  if (upstashConfigured) return null

  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    upstashConfigured = true
    return null
  }

  try {
    upstashClient = new Redis({ url, token })
    return upstashClient
  } catch {
    upstashConfigured = true
    return null
  }
}

// ---------------------------------------------------------------------------
// In-memory fallback store
// ---------------------------------------------------------------------------

interface SlidingEntry {
  timestamps: number[]
}

const memoryStore = new Map<string, SlidingEntry>()

// Periodic cleanup (every 60s)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of memoryStore) {
      entry.timestamps = entry.timestamps.filter((t) => now - t < 120_000) // 2x max window
      if (entry.timestamps.length === 0) {
        memoryStore.delete(key)
      }
    }
  }, 60_000).unref?.()
}

// ---------------------------------------------------------------------------
// Client IP extraction — delegated to shared module
// ---------------------------------------------------------------------------

import { getClientIp, simpleHash, getCompositeFingerprint } from "@/lib/rate-limit-shared"

// ---------------------------------------------------------------------------
// Rate limit check
// ---------------------------------------------------------------------------

export type RouteRateLimitResult = {
  allowed: boolean
  remaining: number
  reset: number
  limit: number
}

/**
 * Find the matching route limit for a given pathname.
 * Returns null if no route-specific limit applies.
 */
function findMatchingLimit(pathname: string): RouteLimit | null {
  for (const rl of ROUTE_LIMITS) {
    if (rl.regex?.test(pathname)) {
      return rl
    }
  }
  return null
}

/**
 * Check route-specific rate limit for the given request.
 *
 * Returns:
 *   - `{ allowed: true, ... }` — request is within limits
 *   - `{ allowed: false, ... }` — request is blocked (return 429)
 *   - `null` — no route-specific limit applies to this path
 */
export async function checkRouteRateLimit(
  request: NextRequest,
): Promise<RouteRateLimitResult | null> {
  if (process.env.ROUTE_RATE_LIMIT_ENABLED === "false") return null

  const pathname = request.nextUrl.pathname
  const routeLimit = findMatchingLimit(pathname)
  if (!routeLimit) return null

  const fingerprint = getCompositeFingerprint(request)
  const now = Date.now()

  // Namespace per route to avoid collisions between different endpoints
  const windowKey = Math.floor(now / routeLimit.windowMs) * routeLimit.windowMs
  const storageKey = `route-ratelimit:${pathname}:${fingerprint}:${windowKey}`

  // Try Upstash first
  const client = getUpstashClient()
  if (client) {
    try {
      const count = await client.incr(storageKey)
      await client.expire(storageKey, Math.ceil((routeLimit.windowMs * 2) / 1000))

      const remaining = Math.max(0, routeLimit.max - count)
      return {
        allowed: count <= routeLimit.max,
        remaining,
        reset: windowKey + routeLimit.windowMs,
        limit: routeLimit.max,
      }
    } catch {
      // Upstash failed — fall through to in-memory
    }
  }

  // In-memory fallback
  let entry = memoryStore.get(storageKey)
  if (!entry) {
    entry = { timestamps: [] }
    memoryStore.set(storageKey, entry)
  }

  const windowStart = now - routeLimit.windowMs
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)
  const count = entry.timestamps.length
  const allowed = count < routeLimit.max

  if (allowed) {
    entry.timestamps.push(now)
  }

  return {
    allowed,
    remaining: Math.max(0, routeLimit.max - count - (allowed ? 1 : 0)),
    reset: windowStart + routeLimit.windowMs,
    limit: routeLimit.max,
  }
}

/**
 * Generate standard rate limit headers for route-level limits.
 */
export function routeRateLimitHeaders(result: RouteRateLimitResult): Record<string, string> {
  return {
    "X-Route-RateLimit-Limit": String(result.limit),
    "X-Route-RateLimit-Remaining": String(result.remaining),
    "X-Route-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
    "Retry-After": String(Math.ceil((result.reset - Date.now()) / 1000)),
  }
}
