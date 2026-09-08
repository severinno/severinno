/**
 * Audit Log / User Activity API
 *
 * GET  — Retrieves recent security and account activities for the authenticated user
 * POST — Records a custom activity item (or internal helper)
 */

import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getClient } from "@/lib/redis"
import logger from "@/lib/logger"

const log = logger.child({ module: "api-activity-log" })

export type ActivityItem = {
  id: string
  type:
    | "login"
    | "password_change"
    | "2fa_enable"
    | "2fa_disable"
    | "identity_upload"
    | "profile_update"
    | "booking_status"
  title: string
  description?: string
  ip?: string
  userAgent?: string
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * Helper to record activity to Redis
 */
export async function recordUserActivity(
  userId: string,
  activity: Omit<ActivityItem, "id" | "timestamp">,
) {
  try {
    const redis = getClient()
    if (!redis) return

    const item: ActivityItem = {
      ...activity,
      id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
    }

    const key = `activity:${userId}`
    await redis.lpush(key, JSON.stringify(item))
    await redis.ltrim(key, 0, 99) // keep last 100
    await redis.expire(key, 90 * 24 * 3600) // 90 days TTL
  } catch (err) {
    log.warn({ err, userId }, "Failed to record user activity log")
  }
}

export async function GET() {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  try {
    const redis = getClient()
    if (!redis) {
      return NextResponse.json({ activities: [] })
    }

    const key = `activity:${session.userId}`
    const rawItems = await redis.lrange(key, 0, 49)

    const activities: ActivityItem[] = rawItems
      .map((str) => {
        try {
          const parsed = JSON.parse(str)
          // Normalization in case raw payload was pushed earlier
          return {
            id: parsed.id || `act_${parsed.timestamp}`,
            type: parsed.type || "general",
            title: parsed.title || getTitleForType(parsed.type),
            description: parsed.description,
            timestamp: parsed.timestamp || Date.now(),
            metadata: parsed.metadata || parsed,
          }
        } catch {
          return null
        }
      })
      .filter(Boolean) as ActivityItem[]

    return NextResponse.json({ activities })
  } catch (err) {
    log.error({ err, userId: session.userId }, "Error fetching user activity")
    return NextResponse.json({ error: "Erro ao buscar histórico" }, { status: 500 })
  }
}

function getTitleForType(type: string): string {
  switch (type) {
    case "login":
      return "Login realizado"
    case "password_change":
      return "Senha alterada"
    case "2fa_enable":
      return "Autenticação em duas etapas ativada"
    case "2fa_disable":
      return "Autenticação em duas etapas desativada"
    case "identity_upload":
      return "Documentos de identidade enviados para verificação"
    case "profile_update":
      return "Perfil atualizado"
    default:
      return "Ação na conta"
  }
}
