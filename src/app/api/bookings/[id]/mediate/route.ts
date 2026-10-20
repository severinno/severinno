export const dynamic = "force-dynamic"

import logger from "@/lib/logger"
import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withParams } from "@/lib/api-route"
import { formatBRL, formatDateTime } from "@/lib/format"

const mediationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("notify_delay"),
    delayMinutes: z.number().int().min(5).max(180),
    reason: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal("request_reschedule"),
    proposedDate: z.string(),
    reason: z.string().max(300).optional(),
  }),
  z.object({
    action: z.literal("scope_adjustment"),
    additionalAmount: z.number().positive().max(5000),
    description: z.string().min(3).max(300),
  }),
])

export const POST = withParams<{ id: string }>(
  "api.bookings.:id.mediate.POST",
  async (request, { params }) => {
    await assertRateLimit(request, RATE_LIMITS.bookings)
    const session = await requireUser()
    const { id } = await params

    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        service: { select: { title: true } },
        client: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true } },
      },
    })

    if (!booking) throw notFound("Agendamento não encontrado")

    const isClient = booking.clientId === session.userId
    const isProvider = booking.providerId === session.userId
    const isAdmin = session.role === "ADMIN"

    if (!isClient && !isProvider && !isAdmin) {
      throw forbidden("Apenas as partes do agendamento podem acionar a mediação")
    }

    const body = await request.json().catch(() => null)
    const parsed = mediationSchema.safeParse(body)
    if (!parsed.success) {
      throw badRequest("Dados de mediação inválidos")
    }

    const peerId = isClient ? booking.providerId : booking.clientId
    const senderName = isClient ? booking.client.name : booking.provider.name
    let chatContent = ""
    let notifTitle = ""
    let notifBody = ""

    switch (parsed.data.action) {
      case "notify_delay": {
        const { delayMinutes, reason } = parsed.data
        chatContent = `⏱️ [AVISO DE IMPREVISTO]: ${senderName} informou um atraso estimado de +${delayMinutes} min devido a ${reason || "trânsito/imprevisto"}. Agradecemos a compreensão!`
        notifTitle = `⏱️ Aviso de Atraso (+${delayMinutes} min)`
        notifBody = `${senderName} informou que chegará com cerca de ${delayMinutes} minutos de atraso.`
        break
      }

      case "request_reschedule": {
        const { proposedDate, reason } = parsed.data
        const formattedDate = formatDateTime(proposedDate)
        chatContent = `📅 [PROPOSTA DE REAGENDAMENTO]: ${senderName} sugeriu reagendar o atendimento para ${formattedDate}.${reason ? ` Motivo: "${reason}".` : ""} Por favor, responda aqui para confirmar!`
        notifTitle = "📅 Proposta de Reagendamento Amigável"
        notifBody = `${senderName} sugeriu reagendar o atendimento para ${formattedDate}.`
        break
      }

      case "scope_adjustment": {
        const { additionalAmount, description } = parsed.data
        const proposalData = {
          title: `Aditivo: ${description}`,
          amount: additionalAmount,
          description,
          estimatedTime: "Conforme combinado",
        }
        chatContent = `[SEVERINNO_PROPOSAL:${JSON.stringify(proposalData)}]`
        notifTitle = "🛠️ Proposta de Ajuste de Escopo / Peça"
        notifBody = `${senderName} enviou uma proposta de aditivo no valor de ${formatBRL(additionalAmount)}.`
        break
      }
    }

    // Criar mensagem no chat compartilhado
    const message = await db.message.create({
      data: {
        fromId: session.userId,
        toId: peerId,
        content: chatContent,
      },
    })

    // Criar notificação para o destinatário
    await db.notification
      .create({
        data: {
          userId: peerId,
          type: "MESSAGE_RECEIVED",
          title: notifTitle,
          body: notifBody,
        },
      })
      .catch((err) => logger.warn({ err }, "mediation notification failed"))

    return NextResponse.json({
      ok: true,
      message: "Mediação enviada com sucesso!",
      chatMessage: message,
    })
  },
)
