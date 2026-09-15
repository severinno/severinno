/**
 * Database Query Monitor — tracks slow queries via $extends query interceptors
 *
 * Logs queries exceeding a configurable threshold (default 200ms).
 * Tracks metrics for the health dashboard.
 *
 * Note: Prisma v6 uses $extends instead of $use for middleware.
 * This module exports a query extension to be used with $extends.
 */
import logger from "./logger"

const SLOW_QUERY_THRESHOLD_MS = Number(process.env.SLOW_QUERY_THRESHOLD_MS || "200")

interface QueryMetric {
  model: string
  operation: string
  durationMs: number
  query: string
  timestamp: string
}

// In-memory ring buffer for recent slow queries (last 100)
const recentSlowQueries: QueryMetric[] = []
const MAX_SLOW_QUERIES = 100

type QueryArgs = {
  args: Record<string, unknown>
  query: (args: Record<string, unknown>) => Promise<unknown>
}

/**
 * Build per-model query extensions for slow query monitoring.
 * Usage with $extends:
 *   prisma.$extends({ name: "query-monitor", query: buildQueryMonitorExtensions() })
 */
export function buildQueryMonitorExtensions(): Record<
  string,
  Record<string, (opts: QueryArgs) => Promise<unknown>>
> {
  const models = [
    "user",
    "service",
    "booking",
    "review",
    "category",
    "message",
    "notification",
    "walletTransaction",
    "quoteRequest",
  ]
  const extensions: Record<string, Record<string, (opts: QueryArgs) => Promise<unknown>>> = {}

  for (const model of models) {
    extensions[model] = {
      findMany: monitorQuery(model, "findMany"),
      findFirst: monitorQuery(model, "findFirst"),
      create: monitorQuery(model, "create"),
      update: monitorQuery(model, "update"),
      upsert: monitorQuery(model, "upsert"),
    }
  }

  return extensions
}

function monitorQuery(model: string, operation: string) {
  return async ({ args, query }: QueryArgs) => {
    const start = Date.now()
    const result = await query(args)
    const durationMs = Date.now() - start

    if (durationMs >= SLOW_QUERY_THRESHOLD_MS) {
      const metric: QueryMetric = {
        model,
        operation,
        durationMs,
        query: `${model}.${operation}(${JSON.stringify(args).slice(0, 200)})`,
        timestamp: new Date().toISOString(),
      }

      logger.warn(
        {
          model: metric.model,
          operation: metric.operation,
          durationMs,
          threshold: SLOW_QUERY_THRESHOLD_MS,
        },
        `Slow DB query: ${model}.${operation} took ${durationMs}ms`,
      )

      recentSlowQueries.push(metric)
      if (recentSlowQueries.length > MAX_SLOW_QUERIES) {
        recentSlowQueries.shift()
      }
    }

    return result
  }
}

/**
 * Get recent slow queries for health dashboard.
 */
export function getSlowQueryMetrics(): {
  total: number
  thresholdMs: number
  queries: QueryMetric[]
} {
  return {
    total: recentSlowQueries.length,
    thresholdMs: SLOW_QUERY_THRESHOLD_MS,
    queries: [...recentSlowQueries].slice(-20),
  }
}

/**
 * Reset metrics (useful for testing).
 */
export function resetQueryMetrics(): void {
  recentSlowQueries.length = 0
}
