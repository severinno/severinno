import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/admin/push/analytics
 *
 * Retorna métricas agregadas de entrega de push notifications.
 * Requer role ADMIN.
 *
 * Query params:
 *   days  — período em dias (default 30, max 90)
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") || "30", 10) || 30))

    const since = new Date()
    since.setDate(since.getDate() - days)

    // ── Aggregate queries ──────────────────────────────────────────────
    const [
      totalSent,
      totalClicked,
      totalBounced,
      totalFailed,
      bySource,
      byType,
      dailyStats,
      topNotifications,
      activeSubscriptions,
    ] = await Promise.all([
      // Total sent in period
      db.pushAnalytics.count({ where: { createdAt: { gte: since } } }),

      // Total clicked
      db.pushAnalytics.count({ where: { createdAt: { gte: since }, status: "clicked" } }),

      // Total bounced (410/404 — expired subs)
      db.pushAnalytics.count({ where: { createdAt: { gte: since }, status: "bounced" } }),

      // Total failed
      db.pushAnalytics.count({ where: { createdAt: { gte: since }, status: "failed" } }),

      // By source (manual, auto, webhook, scheduled, cron)
      db.pushAnalytics.groupBy({
        by: ["source"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),

      // By type (ADMIN_MANUAL, BOOKING_CREATED, etc.)
      db.pushAnalytics.groupBy({
        by: ["type"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),

      // Daily aggregated stats
      db.$queryRawUnsafe<Array<{ date: string; sent: bigint; clicked: bigint; bounced: bigint; failed: bigint }>>(
        `SELECT
           DATE("createdAt") AS date,
           COUNT(*) AS sent,
           COUNT(*) FILTER (WHERE "status" = 'clicked') AS clicked,
           COUNT(*) FILTER (WHERE "status" = 'bounced') AS bounced,
           COUNT(*) FILTER (WHERE "status" = 'failed') AS failed
         FROM "PushAnalytics"
         WHERE "createdAt" >= $1
         GROUP BY DATE("createdAt")
         ORDER BY date ASC
         LIMIT 30`,
        [since],
      ),

      // Top 10 notifications by delivery
      db.pushAnalytics.groupBy({
        by: ["title"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        _sum: { deviceCount: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),

      // Active subscriptions count
      db.pushSubscription.count(),
    ])

    // Delivered = total sent minus bounced/failed (records with "sent" or "clicked" status)
    const delivered = totalSent - totalBounced - totalFailed
    const sentMinusBounced = totalSent - totalBounced

    return NextResponse.json({
      ok: true,
      period: { days, since: since.toISOString() },
      summary: {
        totalSent,
        delivered,
        clicked: totalClicked,
        bounced: totalBounced,
        failed: totalFailed,
      },
      rates: {
        deliveryRate: sentMinusBounced > 0 ? Math.round((delivered / sentMinusBounced) * 10000) / 100 : 0,
        clickRate: delivered > 0 ? Math.round((totalClicked / delivered) * 10000) / 100 : 0,
        bounceRate: totalSent > 0 ? Math.round((totalBounced / totalSent) * 10000) / 100 : 0,
        failureRate: totalSent > 0 ? Math.round((totalFailed / totalSent) * 10000) / 100 : 0,
      },
      activeSubscriptions,
      bySource: bySource.map((s) => ({ source: s.source, count: s._count.id })),
      byType: byType.map((t) => ({ type: t.type, count: t._count.id })),
      daily: dailyStats.map((d) => ({
        date: d.date,
        sent: Number(d.sent),
        clicked: Number(d.clicked),
        bounced: Number(d.bounced),
        failed: Number(d.failed),
      })),
      topNotifications: topNotifications.map((n) => ({
        title: n.title,
        sent: n._count.id,
        devices: n._sum.deviceCount ?? 0,
      })),
    })
  } catch (e) {
    return handleError(e)
  }
}
