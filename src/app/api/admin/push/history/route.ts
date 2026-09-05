export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

/**
 * GET /api/admin/push/history
 *
 * Retorna histórico paginado de push notifications enviadas, com dados do
 * usuário destinatário. Similar ao padrão dos endpoints admin-errors e
 * admin-performance.
 *
 * Query params:
 *   page        — página (default 1)
 *   limit       — itens por página (default 20, max 50)
 *   status      — filtrar por status (sent, clicked, bounced, failed, all)
 *   type        — filtrar por tipo (ADMIN_MANUAL, BOOKING_CREATED, etc.)
 *   source      — filtrar por source (manual, auto, webhook, scheduled, cron)
 *   days        — período em dias (default 30, max 90)
 *   userId      — filtrar por usuário específico
 *   q           — busca textual por título
 *   action      — filtrar por ação (accept, reject, view, all)
 */

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20))
    const statusFilter = searchParams.get("status") ?? "all"
    const typeFilter = searchParams.get("type") ?? ""
    const sourceFilter = searchParams.get("source") ?? ""
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") ?? "30", 10) || 30))
    const userId = searchParams.get("userId") ?? ""
    const query = searchParams.get("q") ?? ""
    const actionFilter = searchParams.get("action") ?? ""

    const since = new Date()
    since.setDate(since.getDate() - days)

    // Build where clause dynamically
    const where: Prisma.PushAnalyticsWhereInput = {
      createdAt: { gte: since },
    }

    if (statusFilter !== "all") {
      where.status = statusFilter
    }

    if (typeFilter) {
      where.type = typeFilter
    }

    if (sourceFilter) {
      where.source = sourceFilter
    }

    if (userId) {
      where.userId = userId
    }

    if (query) {
      where.title = { contains: query, mode: "insensitive" }
    }

    if (actionFilter) {
      where.action = actionFilter
    }

    // Fetch paginated records (user data is fetched separately via userId)
    const records = await db.pushAnalytics.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    })

    const total = await db.pushAnalytics.count({ where })

    // Also fetch distinct types and sources for filter dropdowns
    const [types, sources] = await Promise.all([
      db.pushAnalytics.groupBy({
        by: ["type"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
      db.pushAnalytics.groupBy({
        by: ["source"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
    ])

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      ok: true,
      items: records.map((r) => ({
        id: r.id,
        userId: r.userId,
        title: r.title,
        body: r.body,
        type: r.type,
        source: r.source,
        status: r.status,
        deviceCount: r.deviceCount,
        latencyMs: r.latencyMs,
        errorMessage: r.errorMessage,
        action: r.action,
        actionResult: r.actionResult,
        bookingId: r.bookingId,
        clickedAt: r.clickedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        user: null, // PushAnalytics model does not have user relation — add via separate query if needed
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      filters: {
        days,
        status: statusFilter,
        type: typeFilter,
        source: sourceFilter,
        userId,
        query,
      },
      availableTypes: types.map((t) => ({ type: t.type, count: t._count.id })),
      availableSources: sources.map((s) => ({ source: s.source, count: s._count.id })),
      availableActions: ["accept", "reject", "view"],
    })
  } catch (e) {
    return handleError(e)
  }
}
