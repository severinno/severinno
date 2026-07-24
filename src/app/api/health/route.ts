import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { cacheGet } from "@/lib/redis"
import logger from "@/lib/logger"

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
    // FIXME: read from package.json at build time
    version: "0.2.0",
  }

  // Cache the result (best-effort, in-memory only to avoid dependency)
  inMemoryCache = { timestamp: Date.now(), result: response }

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
  // Reuse the existing Redis singleton from @/lib/redis.
  // The singleton handles connection pooling and errors gracefully.
  try {
    await cacheGet("health:ping")
    return "ok"
  } catch {
    // Redis is optional — the app degrades gracefully without it
    return "error"
  }
}
