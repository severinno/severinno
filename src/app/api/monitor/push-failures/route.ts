export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { handleError } from "@/lib/api-server"
import { requireRole } from "@/lib/auth"
import { getPushFailureStats } from "@/lib/push-monitor"
import logger from "@/lib/logger"

/**
 * GET /api/monitor/push-failures
 *
 * Diagnostic endpoint for web-push health. Returns:
 *   - In-memory sliding window stats (from PushMonitor)
 *   - DB-based recent failure rate (PushAnalytics with status "failed" or "bounced")
 *   - Overall push health verdict
 *
 * Admin-only. Useful for dashboards, cron health checks, and manual debugging.
 */
export async function GET() {
  try {
    await requireRole("ADMIN")

    const memoryStats = getPushFailureStats()

    // ── DB query: count failures in the last 5 minutes ──────────────────
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)

    const [dbFailedCount, dbBouncedCount, lastFailures] = await Promise.all([
      db.pushAnalytics.count({
        where: { status: "failed", createdAt: { gte: fiveMinutesAgo } },
      }),
      db.pushAnalytics.count({
        where: { status: "bounced", createdAt: { gte: fiveMinutesAgo } },
      }),
      db.pushAnalytics.findMany({
        where: {
          status: { in: ["failed", "bounced"] },
          createdAt: { gte: fiveMinutesAgo },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          userId: true,
          title: true,
          status: true,
          errorMessage: true,
          deviceCount: true,
          createdAt: true,
        },
      }),
    ])

    const dbTotalFailures = dbFailedCount + dbBouncedCount
    const isUnhealthy = memoryStats.isAlerting || dbTotalFailures > 10

    const response = {
      healthy: !isUnhealthy,
      verdict: isUnhealthy
        ? "UNHEALTHY — more than 10 push failures in the last 5 minutes"
        : "HEALTHY — push failure rate within normal range",
      timestamp: new Date().toISOString(),
      memory: memoryStats,
      database: {
        failuresLast5Min: dbTotalFailures,
        failed: dbFailedCount,
        bounced: dbBouncedCount,
        threshold: 10,
        recentFailures: lastFailures.map((f) => ({
          id: f.id.slice(0, 8),
          userId: f.userId.slice(0, 12) + "…",
          title: f.title.slice(0, 60),
          status: f.status,
          error: f.errorMessage,
          devices: f.deviceCount,
          ago: Math.round((Date.now() - f.createdAt.getTime()) / 1000) + "s",
        })),
      },
    }

    if (!response.healthy) {
      logger.warn(
        { memoryFailures: memoryStats.currentWindowFailures, dbFailures: dbTotalFailures },
        "push-failures endpoint: unhealthy state detected",
      )
    }

    return NextResponse.json(response)
  } catch (e) {
    return handleError(e)
  }
}
