/**
 * Notification Preferences API
 *
 * GET  — Retrieve user's notification channel preferences & quiet hours
 * PUT  — Upsert user's notification channel preferences
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import { getClient } from "@/lib/redis"
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

export async function GET() {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    const preferences = await db.notificationPreference.findMany({
      where: { userId: session.userId },
    })

    // Fetch quiet hours from Redis
    let quietHours = { enabled: false, start: "22:00", end: "08:00" }
    const redis = getClient()
    if (redis) {
      const qh = await redis.get(`user:${session.userId}:quiet-hours`)
      if (qh) {
        try {
          quietHours = JSON.parse(qh)
        } catch {
          // ignore
        }
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
  } catch (err) {
    log.error({ err, userId: session.userId }, "Error loading notification preferences")
    return NextResponse.json({ error: "Erro ao carregar preferências" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { preferences, quietHours } = body as {
      preferences?: Array<{
        type: string
        pushEnabled: boolean
        emailEnabled: boolean
        whatsappEnabled: boolean
        soundEnabled: boolean
      }>
      quietHours?: { enabled: boolean; start: string; end: string }
    }

    if (preferences && Array.isArray(preferences)) {
      for (const pref of preferences) {
        await db.notificationPreference.upsert({
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
        })
      }
    }

    if (quietHours) {
      const redis = getClient()
      if (redis) {
        await redis.set(`user:${session.userId}:quiet-hours`, JSON.stringify(quietHours))
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    log.error({ err, userId: session.userId }, "Error updating notification preferences")
    return NextResponse.json({ error: "Erro ao salvar preferências" }, { status: 500 })
  }
}
