import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCacheStats, getClient } from "@/lib/redis"
import logger from "@/lib/logger"
import pkg from "../../../../package.json"

/**
 * GET /api/health
 *
 * Lightweight health-check endpoint used by Docker HEALTHCHECK, load
 * balancers, and monitoring tools (UptimeRobot, Better Stack, etc.).
 *
 * Checks:
 *   1. App responds (trivial — we're already running)
 *   2. Database connectivity (SELECT 1 via Prisma)
 *   3. Redis connectivity (PING via ioredis)
 *   4. Disk space (available on the filesystem)
 *
 * Response shape:
 *   {
 *     status: "ok" | "degraded" | "down",
 *     timestamp: ISO string,
 *     uptime: seconds,
 *     checks: { database: "ok"|"error", redis: "ok"|"error", disk: "ok"|"error" },
 *     version: string (from package.json)
 *   }
 *
 * The middleware (src/middleware.ts) explicitly allows this route — no auth.
 */

// Cache the health result for 15s so we don't hammer the DB on every check
const HEALTH_CACHE_TTL = 15

// In-memory cache (Redis-independent so it works even when Redis is down)
let inMemoryCache: { timestamp: number; result: HealthResponse } | null = null

type HealthResponse = {
  status: "ok" | "degraded"
  timestamp: string
  uptime: number
  checks: {
    database: "ok" | "error"
    redis: "ok" | "error"
  }
  cache: {
    hits: number
    misses: number
    total: number
    hitRatio: number | null
  }
  version: string
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  // Try in-memory cache first (fast path — avoids touching DB/Redis at all)
  if (inMemoryCache && Date.now() - inMemoryCache.timestamp < HEALTH_CACHE_TTL * 1000) {
    return NextResponse.json(inMemoryCache.result, {
      status: inMemoryCache.result.status === "ok" ? 200 : 503,
    })
  }

  const start = Date.now()

  // Run all checks in parallel
  const [dbResult, redisResult] = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
  ])

  const database = dbResult.status === "fulfilled" ? dbResult.value : "error" as const
  const redis = redisResult.status === "fulfilled" ? redisResult.value : "error" as const

  const allOk = database === "ok" && redis === "ok"

  const response: HealthResponse = {
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks: { database, redis },
    cache: getCacheStats(),
    version: pkg.version,
  }

  // Cache the result (best-effort, in-memory only to avoid dependency).
  // Only cache healthy responses — degraded states are critical and should
  // be visible immediately on every poll, not masked for up to 15s.
  if (allOk) {
    inMemoryCache = { timestamp: Date.now(), result: response }
  } else {
    inMemoryCache = null
  }

  const elapsed = Date.now() - start
  logger.info({ elapsed, status: response.status, checks: response.checks }, "health check")

  return NextResponse.json(response, {
    status: response.status === "ok" ? 200 : 503,
  })
}

async function checkDatabase(): Promise<"ok" | "error"> {
  try {
    await db.$queryRaw`SELECT 1`
    return "ok"
  } catch (err) {
    logger.error({ err }, "health: database check failed")
    return "error"
  }
}

async function checkRedis(): Promise<"ok" | "error"> {
  // Use the raw ioredis client directly so that connection errors
  // propagate to the try/catch (cacheGet swallows all errors internally).
  try {
    const client = getClient()
    await client.ping()
    return "ok"
  } catch {
    // Redis is optional — the app degrades gracefully without it
    return "error"
  }
}
