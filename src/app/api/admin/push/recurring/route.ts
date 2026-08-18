/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CRUD /api/admin/push/recurring
 *
 * Gerencia agendamentos recorrentes de push notifications.
 *
 * GET    → lista todos os schedules (opcional: ?status=ACTIVE&page=1&limit=20)
 * POST   → cria um novo agendamento recorrente
 * PATCH  → atualiza campos ou altera status (pause/resume)
 * DELETE → arquiva (soft-delete via status=ARCHIVED)
 */

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, badRequest, notFound } from "@/lib/api-server"
import logger from "@/lib/logger"

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")

    const { searchParams } = new URL(request.url)
    const statusFilter = searchParams.get("status") ?? ""
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20))

    const where: Prisma.RecurringPushScheduleWhereInput = {}
    if (statusFilter && statusFilter !== "all") {
      where.status = statusFilter as Prisma.RecurringPushScheduleWhereInput["status"]
    }

    const [records, total] = await Promise.all([
      db.recurringPushSchedule.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.recurringPushSchedule.count({ where }),
    ])

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      ok: true,
      items: records.map((r) => ({
        id: r.id,
        frequency: r.frequency,
        time: r.time,
        dayOfWeek: r.dayOfWeek,
        dayOfMonth: r.dayOfMonth,
        timezone: r.timezone,
        title: r.title,
        body: r.body,
        pushUrl: r.pushUrl,
        type: r.type,
        targetRoles: r.targetRoles,
        filterCity: r.filterCity,
        status: r.status,
        lastSentAt: r.lastSentAt?.toISOString() ?? null,
        totalSent: r.totalSent,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      pagination: { page, limit, total, totalPages },
      filters: { status: statusFilter || "all" },
    })
  } catch (e) {
    return handleError(e)
  }
}

// ── POST ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await requireRole("ADMIN")

    const body = await request.json()
    const {
      frequency,
      time,
      dayOfWeek,
      dayOfMonth,
      title,
      body: pushBody,
      pushUrl,
      type,
      targetRoles,
      filterCity,
      timezone,
    } = body

    // ── Validation ──────────────────────────────────────────────────────
    if (!frequency || !["daily", "weekly", "monthly"].includes(frequency)) {
      throw badRequest("frequency must be daily, weekly, or monthly")
    }
    if (!time || !/^\d{2}:\d{2}$/.test(time)) {
      throw badRequest("time must be in HH:mm format")
    }
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      throw badRequest("title is required")
    }
    if (frequency === "weekly" && (dayOfWeek === undefined || dayOfWeek === null)) {
      throw badRequest("dayOfWeek is required for weekly frequency (0=Sun..6=Sat)")
    }
    if (frequency === "monthly" && (dayOfMonth === undefined || dayOfMonth === null)) {
      throw badRequest("dayOfMonth is required for monthly frequency (1..31)")
    }
    if (dayOfWeek !== undefined && (dayOfWeek < 0 || dayOfWeek > 6)) {
      throw badRequest("dayOfWeek must be between 0 (Sun) and 6 (Sat)")
    }
    if (dayOfMonth !== undefined && (dayOfMonth < 1 || dayOfMonth > 31)) {
      throw badRequest("dayOfMonth must be between 1 and 31")
    }

    const record = await db.recurringPushSchedule.create({
      data: {
        frequency,
        time,
        dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
        dayOfMonth: frequency === "monthly" ? dayOfMonth : null,
        timezone: timezone || "America/Sao_Paulo",
        title: title.trim(),
        body: pushBody?.trim() ?? null,
        pushUrl: pushUrl || "/",
        type: type || "RECURRING",
        targetRoles: targetRoles ?? ["CLIENT", "PROVIDER"],
        filterCity: filterCity?.trim() ?? null,
        status: "ACTIVE",
        createdBy: session.userId,
      },
    })

    logger.info(
      { recurringId: record.id, frequency, time, title: record.title },
      "recurring push schedule created",
    )

    return NextResponse.json({
      ok: true,
      item: {
        id: record.id,
        frequency: record.frequency,
        time: record.time,
        dayOfWeek: record.dayOfWeek,
        dayOfMonth: record.dayOfMonth,
        timezone: record.timezone,
        title: record.title,
        body: record.body,
        pushUrl: record.pushUrl,
        type: record.type,
        targetRoles: record.targetRoles,
        filterCity: record.filterCity,
        status: record.status,
        lastSentAt: null,
        totalSent: 0,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

// ── PATCH ───────────────────────────────────────────────────────────────────

export async function PATCH(request: Request) {
  try {
    await requireRole("ADMIN")

    const body = await request.json()
    const {
      id,
      status,
      frequency,
      time,
      dayOfWeek,
      dayOfMonth,
      title,
      body: pushBody,
      pushUrl,
      type,
      targetRoles,
      filterCity,
    } = body

    if (!id) throw badRequest("id is required")

    const existing = await db.recurringPushSchedule.findUnique({ where: { id } })
    if (!existing) throw notFound("Schedule not found")

    // Build update payload (only provided fields)
    const updateData: Prisma.RecurringPushScheduleUpdateInput = {}

    if (status) {
      if (!["ACTIVE", "PAUSED", "ARCHIVED"].includes(status)) {
        throw badRequest("status must be ACTIVE, PAUSED, or ARCHIVED")
      }
      updateData.status = status
    }
    if (frequency) {
      if (!["daily", "weekly", "monthly"].includes(frequency)) {
        throw badRequest("frequency must be daily, weekly, or monthly")
      }
      updateData.frequency = frequency
    }
    if (time) {
      if (!/^\d{2}:\d{2}$/.test(time)) throw badRequest("time must be HH:mm")
      updateData.time = time
    }
    if (dayOfWeek !== undefined) updateData.dayOfWeek = dayOfWeek
    if (dayOfMonth !== undefined) updateData.dayOfMonth = dayOfMonth
    if (title !== undefined) {
      if (title.trim().length === 0) throw badRequest("title cannot be empty")
      updateData.title = title.trim()
    }
    if (pushBody !== undefined) updateData.body = pushBody?.trim() ?? null
    if (pushUrl !== undefined) updateData.pushUrl = pushUrl
    if (type !== undefined) updateData.type = type
    if (targetRoles !== undefined) updateData.targetRoles = targetRoles
    if (filterCity !== undefined) updateData.filterCity = filterCity?.trim() ?? null

    const updated = await db.recurringPushSchedule.update({
      where: { id },
      data: updateData,
    })

    logger.info(
      { recurringId: updated.id, status: updated.status },
      "recurring push schedule updated",
    )

    return NextResponse.json({
      ok: true,
      item: {
        id: updated.id,
        frequency: updated.frequency,
        time: updated.time,
        dayOfWeek: updated.dayOfWeek,
        dayOfMonth: updated.dayOfMonth,
        timezone: updated.timezone,
        title: updated.title,
        body: updated.body,
        pushUrl: updated.pushUrl,
        type: updated.type,
        targetRoles: updated.targetRoles,
        filterCity: updated.filterCity,
        status: updated.status,
        lastSentAt: updated.lastSentAt?.toISOString() ?? null,
        totalSent: updated.totalSent,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

// ── DELETE ──────────────────────────────────────────────────────────────────

export async function DELETE(request: Request) {
  try {
    await requireRole("ADMIN")

    const body = await request.json()
    const { id } = body

    if (!id) throw badRequest("id is required")

    const existing = await db.recurringPushSchedule.findUnique({ where: { id } })
    if (!existing) throw notFound("Schedule not found")

    // Soft-delete by archiving
    await db.recurringPushSchedule.update({
      where: { id },
      data: { status: "ARCHIVED" },
    })

    logger.info({ recurringId: id }, "recurring push schedule archived")

    return NextResponse.json({ ok: true })
  } catch (e) {
    return handleError(e)
  }
}
