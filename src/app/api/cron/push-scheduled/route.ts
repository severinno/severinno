export const dynamic = "force-dynamic"

/**
 * GET /api/cron/push-scheduled
 *
 * Cron job que dispara notificações push agendadas (ScheduledPushNotification).
 *
 * Fluxo:
 *   1. Busca registros com status="PENDING" e scheduledAt <= now()
 *   2. Para cada registro, envia push para todos os userIds
 *   3. Atualiza status para "SENT" com sentCount/errorCount/sentAt
 *   4. Se todos falharem, marca como "FAILED"
 *
 * Proteção: Authorization: Bearer ${CRON_SECRET}
 *
 * Agendamento recomendado no servidor (crontab):
 *   * * * * * (a cada minuto) — a query é leve (índices em status + scheduledAt)
 */

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { sendPushToMany } from "@/lib/push"
import { handleError } from "@/lib/api-server"
import { type Role } from "@prisma/client"

/** Valid UserRole values for filtering. */
const VALID_ROLES = new Set<string>(["CLIENT", "PROVIDER", "ADMIN"])

export async function GET(request: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const now = new Date()
    const results: Array<{
      id: string
      title: string
      totalUsers: number
      sentCount: number
      errorCount: number
      status: string
    }> = []

    // ═══════════════════════════════════════════════════════════════════════
    // PARTE 1: NOTIFICAÇÕES AGENDADAS AVULSAS (ScheduledPushNotification)
    // ═══════════════════════════════════════════════════════════════════════
    const scheduled = await db.scheduledPushNotification.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: "asc" },
      take: 50,
    })

    for (const item of scheduled) {
      const userIds = Array.isArray(item.userIds) ? (item.userIds as string[]) : []

      if (userIds.length === 0) {
        await db.scheduledPushNotification.update({
          where: { id: item.id },
          data: { status: "FAILED", errorCount: 0, sentCount: 0, sentAt: now },
        })
        results.push({
          id: item.id,
          title: item.title,
          totalUsers: 0,
          sentCount: 0,
          errorCount: 0,
          status: "FAILED",
        })
        continue
      }

      logger.info(
        { scheduledId: item.id, title: item.title, users: userIds.length },
        "cron: dispatching scheduled push",
      )

      let sentCount = 0
      let errorCount = 0
      try {
        await sendPushToMany(userIds, item.title, item.body ?? "", item.pushUrl, {
          notificationType: item.type,
          source: "scheduled",
        })
        sentCount = userIds.length
      } catch (err) {
        errorCount = userIds.length
        logger.error(
          { err: (err as Error).message, scheduledId: item.id },
          "cron: scheduled push send failed",
        )
      }

      const finalStatus = sentCount > 0 ? "SENT" : "FAILED"
      await db.scheduledPushNotification.update({
        where: { id: item.id },
        data: { status: finalStatus, sentCount, errorCount, sentAt: now },
      })

      results.push({
        id: item.id,
        title: item.title,
        totalUsers: userIds.length,
        sentCount,
        errorCount,
        status: finalStatus,
      })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PARTE 2: NOTIFICAÇÕES RECORRENTES (RecurringPushSchedule)
    // ═══════════════════════════════════════════════════════════════════════
    const recurring = await db.recurringPushSchedule.findMany({
      where: { status: "ACTIVE" },
    })

    const nowBrazil = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
    const currentHour = nowBrazil.getHours()
    const currentMinute = nowBrazil.getMinutes()
    const currentDayOfWeek = nowBrazil.getDay() // 0=Sun .. 6=Sat
    const currentDayOfMonth = nowBrazil.getDate() // 1..31

    for (const rule of recurring) {
      // ── Parse time ───────────────────────────────────────────────────
      const [hourStr, minStr] = rule.time.split(":")
      const ruleHour = parseInt(hourStr, 10)
      const ruleMinute = parseInt(minStr, 10)

      // Only fire at the exact minute
      if (currentHour !== ruleHour || currentMinute !== ruleMinute) continue

      // ── Check frequency ──────────────────────────────────────────────
      let shouldFire = false
      switch (rule.frequency) {
        case "daily":
          shouldFire = true
          break
        case "weekly":
          shouldFire = rule.dayOfWeek === currentDayOfWeek
          break
        case "monthly":
          shouldFire = rule.dayOfMonth === currentDayOfMonth
          break
      }

      if (!shouldFire) continue

      // Avoid double-fire: check if we already sent within the last 5 minutes
      if (rule.lastSentAt && now.getTime() - rule.lastSentAt.getTime() < 5 * 60 * 1000) {
        continue
      }

      logger.info(
        { recurringId: rule.id, title: rule.title, freq: rule.frequency },
        "cron: firing recurring push",
      )

      // ── Resolve target users ─────────────────────────────────────────
      const targetRoles = Array.isArray(rule.targetRoles)
        ? (rule.targetRoles as string[]).filter((r) => VALID_ROLES.has(r))
        : []
      const whereClause: Record<string, unknown> = {
        active: true,
        role: targetRoles.length > 0 ? { in: targetRoles as Role[] } : undefined,
      }
      if (rule.filterCity) {
        whereClause.city = rule.filterCity
      }

      // Clean undefined keys
      Object.keys(whereClause).forEach((k) => {
        if (whereClause[k] === undefined) delete whereClause[k]
      })

      // Get users that have at least one push subscription
      const usersWithPush = await db.pushSubscription.findMany({
        select: { userId: true },
        distinct: ["userId"],
      })
      const userIdsWithPush = usersWithPush.map((u) => u.userId)

      if (userIdsWithPush.length > 0) {
        // Filter by role and active
        const eligibleUsers = await db.user.findMany({
          where: {
            id: { in: userIdsWithPush },
            active: true,
            ...(targetRoles.length > 0 ? { role: { in: targetRoles as Role[] } } : {}),
            ...(rule.filterCity ? { city: rule.filterCity } : {}),
          },
          select: { id: true },
        })

        const targetUserIds = eligibleUsers.map((u) => u.id)

        if (targetUserIds.length > 0) {
          let sent = 0
          try {
            await sendPushToMany(targetUserIds, rule.title, rule.body ?? "", rule.pushUrl, {
              notificationType: rule.type,
              source: "scheduled",
            })
            sent = targetUserIds.length
          } catch (err) {
            logger.error(
              { err: (err as Error).message, recurringId: rule.id },
              "cron: recurring push send failed",
            )
          }

          // Update the recurring rule
          await db.recurringPushSchedule.update({
            where: { id: rule.id },
            data: {
              lastSentAt: now,
              totalSent: { increment: sent },
            },
          })

          results.push({
            id: `recurring:${rule.id}`,
            title: rule.title,
            totalUsers: targetUserIds.length,
            sentCount: sent,
            errorCount: targetUserIds.length - sent,
            status: sent > 0 ? "SENT" : "FAILED",
          })
        }
      }
    }

    logger.info(
      {
        processedScheduled: scheduled.length,
        processedRecurring: results.filter((r) => r.id.startsWith("recurring:")).length,
      },
      "cron push-scheduled: done",
    )

    return NextResponse.json({
      ok: true,
      processed: results.length,
      scheduled: scheduled.length,
      recurring: results.filter((r) => r.id.startsWith("recurring:")).length,
      results,
    })
  } catch (e) {
    return handleError(e)
  }
}
