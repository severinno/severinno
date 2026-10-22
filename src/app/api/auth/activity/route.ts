/**
 * Audit Log / User Activity API
 *
 * GET  — Retrieves recent security and account activities for the authenticated user
 * POST — Records a custom activity item (or internal helper)
 */

import { NextResponse } from "next/server"
import { withRoute } from "@/lib/api-route"
import { getSession } from "@/lib/auth"
import { unauthorized } from "@/lib/api-server"
import { getClient } from "@/lib/redis"

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

export const GET = withRoute("api.auth.activity.GET", async () => {
  const session = await getSession()
  if (!session?.userId) {
    throw unauthorized("Não autorizado")
  }

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
})

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
