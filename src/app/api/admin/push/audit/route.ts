import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/admin/push/audit
 *
 * Retorna o log de auditoria de push notifications — quem enviou, quando,
 * para quantos, com resultados completos.
 *
 * Query params:
 *   page        — página (default 1)
 *   limit       — itens por página (default 20, max 50)
 *   action      — filtrar por ação (manual_send, manual_schedule, scheduled_send, recurring_send, all)
 *   type        — filtrar por notificationType (ADMIN_MANUAL, BOOKING_CREATED, etc.)
 *   adminId     — filtrar por admin específico
 *   days        — período em dias (default 30, max 90)
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20))
    const actionFilter = searchParams.get("action") ?? "all"
    const typeFilter = searchParams.get("type") ?? ""
    const adminIdFilter = searchParams.get("adminId") ?? ""
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") ?? "30", 10) || 30))

    const since = new Date()
    since.setDate(since.getDate() - days)

    // Build where clause
    const where: Record<string, unknown> = {
      createdAt: { gte: since },
    }

    if (actionFilter !== "all") {
      where.action = actionFilter
    }

    if (typeFilter) {
      where.notificationType = typeFilter
    }

    if (adminIdFilter) {
      where.adminId = adminIdFilter
    }

    // Fetch paginated records with admin info
    const [records, total] = await Promise.all([
      db.pushSendLog.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
              avatarUrl: true,
            },
          },
        },
      }),
      db.pushSendLog.count({ where: where as any }),
    ])

    // Fetch available actions and types for filter dropdowns
    const [actionGroups, typeGroups] = await Promise.all([
      db.pushSendLog.groupBy({
        by: ["action"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
      db.pushSendLog.groupBy({
        by: ["notificationType"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
    ])

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      ok: true,
      items: records.map((r) => ({
        id: r.id,
        adminId: r.adminId,
        action: r.action,
        title: r.title,
        body: r.body,
        pushUrl: r.pushUrl,
        notificationType: r.notificationType,
        recipientCount: r.recipientCount,
        sentCount: r.sentCount,
        errorCount: r.errorCount,
        directPushCount: r.directPushCount,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
        admin: r.admin
          ? {
              id: r.admin.id,
              name: r.admin.name,
              email: r.admin.email,
              avatarUrl: r.admin.avatarUrl,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      filters: {
        days,
        action: actionFilter,
        type: typeFilter,
        adminId: adminIdFilter,
      },
      availableActions: actionGroups.map((a) => ({ action: a.action, count: a._count.id })),
      availableTypes: typeGroups.map((t) => ({ type: t.notificationType, count: t._count.id })),
    })
  } catch (e) {
    return handleError(e)
  }
}
