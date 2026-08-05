import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCacheStats, getClient } from "@/lib/redis"
import logger from "@/lib/logger"
import pkg from "../../../../package.json"

// Sentry is optional — only imported and used when SENTRY_DSN is configured
// Dynamic import avoids ESM `require()` restriction; value is cached after first call.
let _sentry: typeof import("@sentry/nextjs") | null | undefined = undefined
async function getSentry(): Promise<typeof import("@sentry/nextjs") | null> {
  if (_sentry !== undefined) return _sentry
  try {
    _sentry = await import("@sentry/nextjs")
    return _sentry
  } catch {
    _sentry = null
    return null
  }
}

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
 *   4. **Nominatim API** (OpenStreetMap geocoding)
 *   5. **ViaCEP API** (Brazilian postal code service)
 *   6. **PostGIS extension** availability
 *
 * Response shape:
 *   {
 *     status: "ok" | "degraded",
 *     timestamp: ISO string,
 *     uptime: seconds,
 *     checks: {
 *       database: "ok"|"error",
 *       redis: "ok"|"error",
 *       nominatim: "ok"|"error",
 *       viacep: "ok"|"error",
 *       postgis: "ok"|"error",
 *     },
 *     version: string (from package.json)
 *   }
 *
 * Degraded states (any geo service down) are reported to Sentry automatically
 * so the single-person team is alerted without manual monitoring.
 *
 * The middleware (src/middleware.ts) explicitly allows this route — no auth.
 */

// Cache the health result for 15s so we don't hammer external APIs on every check
const HEALTH_CACHE_TTL = 15

// In-memory cache (Redis-independent so it works even when Redis is down)
let inMemoryCache: { timestamp: number; result: HealthResponse } | null = null

type ServiceStatus = "ok" | "error"

type HealthResponse = {
  status: "ok" | "degraded"
  timestamp: string
  uptime: number
  checks: {
    database: ServiceStatus
    redis: ServiceStatus
    nominatim: ServiceStatus
    viacep: ServiceStatus
    postgis: ServiceStatus
  }
  cache: {
    hits: number
    misses: number
    total: number
    hitRatio: number | null
  }
  geo: {
    nominatim: string
    viacep: string
    postgis: string
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
  const results = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    checkNominatim(),
    checkViaCEP(),
    checkPostGIS(),
  ])

  const database = results[0].status === "fulfilled" ? results[0].value : ("error" as const)
  const redis = results[1].status === "fulfilled" ? results[1].value : ("error" as const)
  const nominatimStatus =
    results[2].status === "fulfilled" ? results[2].value.status : ("error" as const)
  const viacepStatus =
    results[3].status === "fulfilled" ? results[3].value.status : ("error" as const)
  const postgisStatus =
    results[4].status === "fulfilled" ? results[4].value.status : ("error" as const)

  const nominatimDetail =
    results[2].status === "fulfilled" ? results[2].value.detail : "unreachable"
  const viacepDetail = results[3].status === "fulfilled" ? results[3].value.detail : "unreachable"
  const postgisDetail = results[4].status === "fulfilled" ? results[4].value.detail : "unreachable"

  const allOk =
    database === "ok" &&
    redis === "ok" &&
    nominatimStatus === "ok" &&
    viacepStatus === "ok" &&
    postgisStatus === "ok"

  const response: HealthResponse = {
    status: allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks: {
      database,
      redis,
      nominatim: nominatimStatus,
      viacep: viacepStatus,
      postgis: postgisStatus,
    },
    cache: getCacheStats(),
    geo: {
      nominatim: nominatimDetail,
      viacep: viacepDetail,
      postgis: postgisDetail,
    },
    version: pkg.version,
  }

  // Report degraded state to Sentry automatically
  if (!allOk) {
    const failedChecks = Object.entries(response.checks)
      .filter(([, status]) => status === "error")
      .map(([name]) => name)

    logger.error(
      {
        failedChecks,
        nominatim: nominatimDetail,
        viacep: viacepDetail,
        postgis: postgisDetail,
      },
      "health check: geo services degraded",
    )

    const sentry = await getSentry()
    if (sentry?.captureMessage) {
      sentry.captureMessage(`Geo service(s) degraded: ${failedChecks.join(", ")}`, {
        level: "warning",
        extra: {
          failedChecks,
          nominatim: nominatimDetail,
          viacep: viacepDetail,
          postgis: postgisDetail,
          uptime: process.uptime(),
        },
        tags: {
          source: "health-check",
          type: "geo-degraded",
        },
      })
    }
  }

  // Cache the result (best-effort, in-memory only).
  // Only cache healthy responses — degraded states should be visible immediately.
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

async function checkDatabase(): Promise<ServiceStatus> {
  try {
    await db.$queryRaw`SELECT 1`
    return "ok"
  } catch (err) {
    logger.error({ err }, "health: database check failed")
    return "error"
  }
}

async function checkRedis(): Promise<ServiceStatus> {
  try {
    const client = getClient()
    if (!client) return "error"
    await client.ping()
    return "ok"
  } catch {
    return "error"
  }
}

/** Check Nominatim API availability. */
async function checkNominatim(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const res = await fetch("https://nominatim.openstreetmap.org/status.php?format=json", {
      headers: {
        "User-Agent": "SeverinnoMarketplace/1.0 (admin@severinno.com)",
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return { status: "error", detail: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as { status?: number; message?: string }
    // Nominatim status: 0=OK, 1=degraded, 2=down
    if (data.status === 0) {
      return { status: "ok", detail: "online" }
    }
    return { status: "error", detail: data.message || `status ${data.status}` }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "timeout" }
  }
}

/** Check ViaCEP API availability. */
async function checkViaCEP(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    // Use a well-known CEP (CEP da Rua Augusta, SP)
    const res = await fetch("https://viacep.com.br/ws/01310100/json/", {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      return { status: "error", detail: `HTTP ${res.status}` }
    }
    const data = (await res.json()) as { erro?: boolean }
    if (data.erro) {
      return { status: "error", detail: "unexpected error response" }
    }
    return { status: "ok", detail: "online" }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "timeout" }
  }
}

/** Check PostGIS extension availability in the database. */
async function checkPostGIS(): Promise<{ status: ServiceStatus; detail: string }> {
  try {
    const rows = await db.$queryRaw<Array<{ available: boolean }>>`
      SELECT true AS available
      FROM pg_extension
      WHERE extname = 'postgis'
    `
    if (rows.length > 0 && rows[0]?.available === true) {
      return { status: "ok", detail: "available" }
    }
    return { status: "error", detail: "extension not found" }
  } catch (e) {
    return { status: "error", detail: e instanceof Error ? e.message : "query failed" }
  }
}
