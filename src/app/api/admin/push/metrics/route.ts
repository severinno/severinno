export const dynamic = "force-dynamic"

/**
 * GET /api/admin/push/metrics
 *
 * Retorna métricas agregadas de push notifications para o dashboard admin:
 *   - Delivery rate, click rate, bounce rate, failure rate
 *   - Ações por tipo (accept/reject/view)
 *   - Timeline de envios (últimos N dias)
 *   - Top tipos de notificação
 *   - Média de dispositivos e latência
 *
 * Query params:
 *   days — período em dias (default 30, max 90)
 */

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") ?? "30", 10) || 30))

    const since = new Date()
    since.setDate(since.getDate() - days)

    // ── Total counts ─────────────────────────────────────────────────────
    const total = await db.pushAnalytics.count({ where: { createdAt: { gte: since } } })

    const [sent, clicked, bounced, failed] = await Promise.all([
      db.pushAnalytics.count({ where: { createdAt: { gte: since }, status: "sent" } }),
      db.pushAnalytics.count({ where: { createdAt: { gte: since }, status: "clicked" } }),
      db.pushAnalytics.count({ where: { createdAt: { gte: since }, status: "bounced" } }),
      db.pushAnalytics.count({ where: { createdAt: { gte: since }, status: "failed" } }),
    ])

    // ── Action breakdown ─────────────────────────────────────────────────
    const actionGroups = await db.pushAnalytics.groupBy({
      by: ["action", "actionResult"],
      where: {
        createdAt: { gte: since },
        action: { not: null },
        status: "clicked",
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    })

    // ── Timeline — envios por dia ────────────────────────────────────────
    const timeline = await db.$queryRawUnsafe<
      Array<{ date: string; total: bigint; clicked: bigint; bounced: bigint; failed: bigint }>
    >(
      `SELECT
         DATE(pa."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo') AS date,
         COUNT(*)::bigint AS total,
         COUNT(*) FILTER (WHERE pa.status = 'clicked')::bigint AS clicked,
         COUNT(*) FILTER (WHERE pa.status = 'bounced')::bigint AS bounced,
         COUNT(*) FILTER (WHERE pa.status = 'failed')::bigint AS failed
       FROM "PushAnalytics" pa
       WHERE pa."createdAt" >= $1
       GROUP BY DATE(pa."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')
       ORDER BY date ASC`,
      [since],
    )

    // ── Top types ────────────────────────────────────────────────────────
    const topTypes = await db.pushAnalytics.groupBy({
      by: ["type"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    })

    // ── Top sources ──────────────────────────────────────────────────────
    const topSources = await db.pushAnalytics.groupBy({
      by: ["source"],
      where: { createdAt: { gte: since } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    })

    // ── Unique reachable users ───────────────────────────────────────────
    const [uniqueUsers, uniqueWithPush] = await Promise.all([
      db.pushAnalytics.groupBy({
        by: ["userId"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),
      db.pushSubscription.groupBy({
        by: ["userId"],
        _count: { id: true },
      }),
    ])

    // ── Average latency and devices ──────────────────────────────────────
    const latencyAgg = await db.pushAnalytics.aggregate({
      _avg: { latencyMs: true, deviceCount: true },
      where: { createdAt: { gte: since }, latencyMs: { not: null } },
    })

    const deliveryRate = total > 0 ? ((sent + clicked) / total) * 100 : 0
    const clickRate = total > 0 ? (clicked / total) * 100 : 0
    const bounceRate = total > 0 ? (bounced / total) * 100 : 0
    const failureRate = total > 0 ? (failed / total) * 100 : 0
    const actionRate = total > 0 ? (clicked / total) * 100 : 0

    return NextResponse.json({
      ok: true,
      period: { days, since: since.toISOString() },
      overview: {
        total,
        sent,
        clicked,
        bounced,
        failed,
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        clickRate: Math.round(clickRate * 100) / 100,
        bounceRate: Math.round(bounceRate * 100) / 100,
        failureRate: Math.round(failureRate * 100) / 100,
        actionRate: Math.round(actionRate * 100) / 100,
      },
      actions: actionGroups.map((g) => ({
        action: g.action,
        actionResult: g.actionResult,
        count: g._count.id,
      })),
      timeline: timeline.map((t) => ({
        date: t.date,
        total: Number(t.total),
        clicked: Number(t.clicked),
        bounced: Number(t.bounced),
        failed: Number(t.failed),
      })),
      topTypes: topTypes.map((t) => ({
        type: t.type,
        count: t._count.id,
      })),
      topSources: topSources.map((s) => ({
        source: s.source,
        count: s._count.id,
      })),
      users: {
        reachable: uniqueUsers.length,
        subscribed: uniqueWithPush.length,
      },
      averages: {
        latencyMs: latencyAgg._avg.latencyMs
          ? Math.round(latencyAgg._avg.latencyMs * 10) / 10
          : null,
        deviceCount: latencyAgg._avg.deviceCount
          ? Math.round(latencyAgg._avg.deviceCount * 10) / 10
          : null,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
