export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"

/**
 * GET /api/admin/push/webhooks/audit
 *
 * Retorna o histórico de execuções de regras de webhook de eventos.
 * Cada vez que um evento do sistema dispara notificações push via
 * event-hub fireEvent(), um WebhookExecutionLog é criado.
 *
 * Query params:
 *   page      — página (default 1)
 *   limit     — itens por página (default 25, max 50)
 *   event     — filtrar por tipo de evento (booking.created, etc.)
 *   status    — filtrar por status (success, partial, failed)
 *   webhookId — filtrar por regra específica
 *   days      — período em dias (default 30, max 90)
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "25", 10) || 25))
    const eventFilter = searchParams.get("event") ?? ""
    const statusFilter = searchParams.get("status") ?? ""
    const webhookIdFilter = searchParams.get("webhookId") ?? ""
    const days = Math.min(90, Math.max(1, parseInt(searchParams.get("days") ?? "30", 10) || 30))

    const since = new Date()
    since.setDate(since.getDate() - days)

    // Build where clause
    const where: Prisma.WebhookExecutionLogWhereInput = {
      createdAt: { gte: since },
    }

    if (eventFilter) {
      where.event = eventFilter
    }

    if (statusFilter) {
      where.status = statusFilter
    }

    if (webhookIdFilter) {
      where.webhookId = webhookIdFilter
    }

    // Fetch paginated records
    const [records, total] = await Promise.all([
      db.webhookExecutionLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.webhookExecutionLog.count({ where }),
    ])

    // Fetch available events, statuses, and webhook rules for filter dropdowns
    const [eventGroups, statusGroups, webhookRules] = await Promise.all([
      db.webhookExecutionLog.groupBy({
        by: ["event"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 20,
      }),
      db.webhookExecutionLog.groupBy({
        by: ["status"],
        where: { createdAt: { gte: since } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),
      db.eventWebhook.findMany({
        select: { id: true, title: true, event: true },
        orderBy: { createdAt: "desc" },
      }),
    ])

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      ok: true,
      items: records.map((r) => ({
        id: r.id,
        webhookId: r.webhookId,
        event: r.event,
        title: r.title,
        body: r.body,
        pushUrl: r.pushUrl,
        targetRoles: r.targetRoles,
        usersFound: r.usersFound,
        usersSent: r.usersSent,
        usersFailed: r.usersFailed,
        errorMessage: r.errorMessage,
        status: r.status,
        context: r.context,
        executionMs: r.executionMs,
        createdAt: r.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      filters: {
        days,
        event: eventFilter,
        status: statusFilter,
        webhookId: webhookIdFilter,
      },
      availableEvents: eventGroups.map((e) => ({ event: e.event, count: e._count.id })),
      availableStatuses: statusGroups.map((s) => ({ status: s.status, count: s._count.id })),
      webhookRules: webhookRules.map((w) => ({ id: w.id, title: w.title, event: w.event })),
    })
  } catch (e) {
    return handleError(e)
  }
}
