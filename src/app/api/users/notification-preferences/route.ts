/**
 * Notification Preferences API
 *
 * GET  — Retrieve user's notification channel preferences & quiet hours
 * PUT  — Upsert user's notification channel preferences (atomic batch)
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { getClient } from "@/lib/redis"
import { withRoute } from "@/lib/api-route"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

const log = logger.child({ module: "api-notification-preferences" })

export const NOTIFICATION_CATEGORIES = [
  {
    type: "QUOTE",
    label: "Orçamentos e Pedidos",
    description: "Novas solicitações e respostas de orçamentos",
  },
  {
    type: "BOOKING",
    label: "Agendamentos",
    description: "Confirmações, alterações de horário e lembretes",
  },
  {
    type: "MESSAGE",
    label: "Mensagens no Chat",
    description: "Novas mensagens diretas de clientes ou prestadores",
  },
  {
    type: "PAYMENT",
    label: "Pagamentos e Finanças",
    description: "Confirmações de PIX, recebimentos e saques",
  },
  {
    type: "REVIEW",
    label: "Avaliações e Reputação",
    description: "Novas notas, comentários e respostas",
  },
]

const preferenceItemSchema = z.object({
  type: z.string().min(1).max(50),
  pushEnabled: z.boolean(),
  emailEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  soundEnabled: z.boolean(),
})

const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:mm inválido"),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:mm inválido"),
})

const updatePreferencesSchema = z.object({
  preferences: z.array(preferenceItemSchema).max(20).optional(),
  quietHours: quietHoursSchema.optional(),
})

export const GET = withRoute("api.users.notification-preferences.GET", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  const preferences = await db.notificationPreference.findMany({
    where: { userId: session.userId },
  })

  // Fetch quiet hours from Redis
  let quietHours = { enabled: false, start: "22:00", end: "08:00" }
  const redis = getClient()
  if (redis) {
    try {
      const qh = await redis.get(`user:${session.userId}:quiet-hours`)
      if (qh) {
        quietHours = JSON.parse(qh)
      }
    } catch {
      // ignore parse error, fallback to defaults
    }
  }

  // Merge with defaults
  const categoryMap = new Map(preferences.map((p) => [p.type, p]))

  const result = NOTIFICATION_CATEGORIES.map((cat) => {
    const existing = categoryMap.get(cat.type)
    return {
      type: cat.type,
      label: cat.label,
      description: cat.description,
      pushEnabled: existing?.pushEnabled ?? true,
      emailEnabled: existing?.emailEnabled ?? true,
      whatsappEnabled: existing?.whatsappEnabled ?? true,
      soundEnabled: existing?.soundEnabled ?? true,
    }
  })

  return NextResponse.json({ preferences: result, quietHours })
})

export const PUT = withRoute("api.users.notification-preferences.PUT", async (request) => {
  await assertRateLimit(request, RATE_LIMITS.general)
  const session = await requireUser()

  const raw = await request.json().catch(() => ({}))
  const parsed = updatePreferencesSchema.safeParse(raw)

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { preferences, quietHours } = parsed.data

  // Batch atomic upsert via Prisma transaction
  if (preferences && preferences.length > 0) {
    await db.$transaction(
      preferences.map((pref) =>
        db.notificationPreference.upsert({
          where: {
            userId_type: {
              userId: session.userId,
              type: pref.type,
            },
          },
          create: {
            userId: session.userId,
            type: pref.type,
            pushEnabled: pref.pushEnabled,
            emailEnabled: pref.emailEnabled,
            whatsappEnabled: pref.whatsappEnabled,
            soundEnabled: pref.soundEnabled,
          },
          update: {
            pushEnabled: pref.pushEnabled,
            emailEnabled: pref.emailEnabled,
            whatsappEnabled: pref.whatsappEnabled,
            soundEnabled: pref.soundEnabled,
          },
        }),
      ),
    )
  }

  if (quietHours) {
    const redis = getClient()
    if (redis) {
      try {
        await redis.set(`user:${session.userId}:quiet-hours`, JSON.stringify(quietHours))
      } catch (err) {
        log.warn({ err, userId: session.userId }, "Failed to persist quiet-hours in Redis")
      }
    }
  }

  return NextResponse.json({ success: true })
})
