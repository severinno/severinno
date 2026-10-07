export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, badRequest, notFound } from "@/lib/api-server"
import logger from "@/lib/logger"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

import { withParams } from "@/lib/api-route"

const VALID_ROLES = ["CLIENT", "PROVIDER", "ADMIN"]

/**
 * PATCH /api/admin/push/webhooks/[id]
 *
 * Atualiza uma regra de webhook de evento.
 *
 * Body (todos opcionais — only provided fields are updated):
 *   title       — template do titulo
 *   body        — template do corpo
 *   pushUrl     — URL de destino
 *   targetRoles — array de roles alvo
 *   active      — booleano
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)
    const { id } = await params

    const existing = await db.eventWebhook.findUnique({ where: { id } })
    if (!existing) throw notFound("Webhook nao encontrado.")

    const body = await request.json()
    const { title, body: messageBody, pushUrl, targetRoles, active } = body

    const data: Record<string, unknown> = {}

    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length === 0) {
        throw badRequest("title nao pode ser vazio.")
      }
      if (title.length > 200) throw badRequest("title max 200 caracteres.")
      data.title = title.trim()
    }
    if (messageBody !== undefined) {
      if (messageBody.length > 500) throw badRequest("body max 500 caracteres.")
      data.body = messageBody.trim() || null
    }
    if (pushUrl !== undefined) {
      if (!/^\/(?!\/)|^https?:\/\//.test(pushUrl)) {
        throw badRequest("pushUrl deve comecar com /, http:// ou https://.")
      }
      data.pushUrl = pushUrl
    }
    if (targetRoles !== undefined) {
      if (!Array.isArray(targetRoles) || targetRoles.length === 0) {
        throw badRequest("targetRoles deve ser um array nao vazio.")
      }
      for (const role of targetRoles) {
        if (!VALID_ROLES.includes(role)) {
          throw badRequest(`Role invalida: ${role}`)
        }
      }
      data.targetRoles = targetRoles
    }
    if (active !== undefined) {
      data.active = Boolean(active)
    }

    const updated = await db.eventWebhook.update({
      where: { id },
      data,
    })

    logger.info({ webhookId: id }, "event webhook updated")

    return NextResponse.json({
      ok: true,
      webhook: {
        ...updated,
        targetRoles: updated.targetRoles as string[],
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

/**
 * DELETE /api/admin/push/webhooks/[id]
 *
 * Exclui uma regra de webhook de evento.
 */
export const DELETE = withParams<{ id: string }>(
  "api.admin.push.webhooks.:id.DELETE",
  async (_request, { params }) => {
    await requireRole("ADMIN")
    await assertRateLimit(_request, RATE_LIMITS.admin)
    const { id } = await params

    const existing = await db.eventWebhook.findUnique({ where: { id } })
    if (!existing) throw notFound("Webhook nao encontrado.")

    await db.eventWebhook.delete({ where: { id } })

    logger.info({ webhookId: id }, "event webhook deleted")

    return NextResponse.json({ ok: true, message: "Webhook excluido." })
  },
)
