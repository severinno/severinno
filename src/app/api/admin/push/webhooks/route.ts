import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError, badRequest, notFound } from "@/lib/api-server"
import logger from "@/lib/logger"

/**
 * Known system events that can trigger automatic push notifications.
 */
const VALID_EVENTS = [
  "booking.created",
  "booking.confirmed",
  "booking.cancelled",
  "booking.completed",
  "review.created",
  "quote.received",
  "quote.responded",
  "payment.confirmed",
  "message.sent",
  "provider.registered",
] as const

const VALID_ROLES = ["CLIENT", "PROVIDER", "ADMIN"]

/**
 * GET /api/admin/push/webhooks
 *
 * Lista todas as regras de webhook de eventos configuradas.
 */
export async function GET() {
  try {
    await requireRole("ADMIN")

    const webhooks = await db.eventWebhook.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        event: true,
        title: true,
        body: true,
        pushUrl: true,
        targetRoles: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const mapped = webhooks.map((w) => ({
      ...w,
      targetRoles: w.targetRoles as string[],
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    }))

    return NextResponse.json({ ok: true, webhooks: mapped })
  } catch (e) {
    return handleError(e)
  }
}

/**
 * POST /api/admin/push/webhooks
 *
 * Cria uma nova regra de webhook de evento.
 *
 * Body:
 *   event       — tipo do evento (obrigatorio)
 *   title       — template do titulo com {{variaveis}} (obrigatorio)
 *   body        — template do corpo com {{variaveis}} (opcional)
 *   pushUrl     — URL de destino (opcional, default "/")
 *   targetRoles — array de roles alvo (obrigatorio, ex: ["PROVIDER"])
 *   active      — booleano (opcional, default true)
 */
export async function POST(request: Request) {
  try {
    const session = await requireRole("ADMIN")

    const body = await request.json()
    const { event, title, body: messageBody, pushUrl, targetRoles, active } = body

    // Validacoes
    if (!event || !VALID_EVENTS.includes(event)) {
      throw badRequest(`event invalido. Valores aceitos: ${VALID_EVENTS.join(", ")}`)
    }
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      throw badRequest("title e obrigatorio.")
    }
    if (title.length > 200) {
      throw badRequest("title deve ter no maximo 200 caracteres.")
    }
    if (messageBody && messageBody.length > 500) {
      throw badRequest("body deve ter no maximo 500 caracteres.")
    }
    if (!targetRoles || !Array.isArray(targetRoles) || targetRoles.length === 0) {
      throw badRequest("targetRoles deve ser um array nao vazio.")
    }
    for (const role of targetRoles) {
      if (!VALID_ROLES.includes(role)) {
        throw badRequest(`Role invalida: ${role}. Valores aceitos: ${VALID_ROLES.join(", ")}`)
      }
    }
    if (pushUrl && !/^\/(?!\/)|^https?:\/\//.test(pushUrl)) {
      throw badRequest("pushUrl deve comecar com /, http:// ou https://.")
    }

    // Verifica unicidade (event + title)
    const existing = await db.eventWebhook.findUnique({
      where: { event_title: { event, title: title.trim() } },
    })
    if (existing) {
      throw badRequest("Ja existe uma regra com este titulo para este evento.")
    }

    const webhook = await db.eventWebhook.create({
      data: {
        event,
        title: title.trim(),
        body: messageBody?.trim() || null,
        pushUrl: pushUrl || "/",
        targetRoles,
        active: active !== false,
        createdBy: session.userId,
      },
    })

    logger.info({ adminId: session.userId, event, title: webhook.title }, "event webhook created")

    return NextResponse.json({
      ok: true,
      webhook: {
        ...webhook,
        targetRoles: webhook.targetRoles as string[],
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
      },
    }, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
