export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { badRequest, notFound } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withParams } from "@/lib/api-route"
import { z } from "zod"
import { sanitizeText } from "@/lib/sanitize"
import { enqueueWhatsApp } from "@/lib/whatsapp-queue"
import { toMoneyNumber } from "@/lib/money"

const resolveDisputeSchema = z.object({
  decision: z.enum(["FULL_REFUND", "RELEASE_TO_PROVIDER", "SPLIT"]),
  refundPercentage: z.number().min(0).max(100).optional(),
  resolutionNotes: z.string().min(5, "Informe o parecer ou justificativa da resolução"),
})

export const POST = withParams<{ id: string }>(
  "api.admin.disputes.:id.resolve.POST",
  async (request, { params }) => {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { id: disputeId } = await params
    const body = await request.json().catch(() => ({}))
    const { decision, refundPercentage, resolutionNotes } = resolveDisputeSchema.parse(body)

    const dispute = await db.dispute.findUnique({
      where: { id: disputeId },
      include: {
        booking: {
          include: {
            client: { select: { id: true, name: true, phone: true, whatsapp: true } },
            provider: { select: { id: true, name: true, phone: true, whatsapp: true } },
            service: { select: { title: true } },
          },
        },
      },
    })

    if (!dispute) throw notFound("Disputa não encontrada")
    if (dispute.status === "RESOLVED") {
      throw badRequest("Esta disputa já foi resolvida anteriormente")
    }

    const booking = dispute.booking
    const bookingAmount = toMoneyNumber(booking.amount)
    const sanitizedNotes = sanitizeText(resolutionNotes)

    let clientRefund = 0
    let providerPayout = 0
    let resolutionSummary = ""

    if (decision === "FULL_REFUND") {
      clientRefund = bookingAmount
      providerPayout = 0
      resolutionSummary = `Decisão: Estorno Integral ao Cliente (100% - R$ ${clientRefund.toFixed(2)}). Motivo: ${sanitizedNotes}`
    } else if (decision === "RELEASE_TO_PROVIDER") {
      clientRefund = 0
      providerPayout = bookingAmount
      resolutionSummary = `Decisão: Liberação Integral ao Prestador (100% - R$ ${providerPayout.toFixed(2)}). Motivo: ${sanitizedNotes}`
    } else {
      // SPLIT
      const pct = refundPercentage ?? 50
      clientRefund = Number(((bookingAmount * pct) / 100).toFixed(2))
      providerPayout = Number((bookingAmount - clientRefund).toFixed(2))
      resolutionSummary = `Decisão: Acordo Parcial / Split (Cliente: ${pct}% - R$ ${clientRefund.toFixed(2)} | Prestador: ${100 - pct}% - R$ ${providerPayout.toFixed(2)}). Motivo: ${sanitizedNotes}`
    }

    const now = new Date()

    // Atualização atômica
    await db.$transaction(async (tx) => {
      // 1. Atualiza disputa
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          status: "RESOLVED",
          resolution: resolutionSummary,
          resolvedAt: now,
        },
      })

      // 2. Atualiza booking
      if (decision === "FULL_REFUND") {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: "REFUNDED",
            status: "CANCELLED",
          },
        })
      } else {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: "PAID",
            escrowReleasedAt: now,
          },
        })
      }

      // 3. Notificações in-app
      await tx.notification.createMany({
        data: [
          {
            userId: booking.clientId,
            type: "DISPUTE_RESOLVED",
            title: "Disputa Resolvida — Mediação Severinno",
            body:
              clientRefund > 0
                ? `A mediação do serviço "${booking.service.title}" foi concluída. Reembolso aprovado de R$ ${clientRefund.toFixed(2)}.`
                : `A mediação do serviço "${booking.service.title}" foi concluída. Os valores foram liberados ao prestador conforme parecer.`,
            read: false,
          },
          {
            userId: booking.providerId,
            type: "DISPUTE_RESOLVED",
            title: "Disputa Resolvida — Mediação Severinno",
            body:
              providerPayout > 0
                ? `A mediação do serviço "${booking.service.title}" foi concluída. Liberação de custódia de R$ ${providerPayout.toFixed(2)} aprovada.`
                : `A mediação do serviço "${booking.service.title}" foi concluída com estorno ao cliente.`,
            read: false,
          },
        ],
      })
    })

    // Disparo assíncrono de WhatsApp para as partes (best-effort)
    const clientPhone = booking.client.whatsapp || booking.client.phone
    if (clientPhone) {
      const clientMsg =
        clientRefund > 0
          ? `⚖️ *Severinno Mediação*: A disputa do seu agendamento de "${booking.service.title}" foi concluída.\n\n` +
            `💰 *Reembolso aprovado*: R$ ${clientRefund.toFixed(2)}\n` +
            `📝 *Parecer*: ${sanitizedNotes}\n\n` +
            `O estorno será processado automaticamente na sua conta PIX.`
          : `⚖️ *Severinno Mediação*: A disputa do seu agendamento de "${booking.service.title}" foi concluída.\n\n` +
            `📝 *Parecer*: ${sanitizedNotes}\n\n` +
            `Dúvidas? Entre em contato com nosso suporte.`

      enqueueWhatsApp({
        to: clientPhone,
        text: clientMsg,
        userId: booking.clientId,
        context: "dispute:resolved:client",
      }).catch(() => {})
    }

    const providerPhone = booking.provider.whatsapp || booking.provider.phone
    if (providerPhone) {
      const providerMsg =
        providerPayout > 0
          ? `⚖️ *Severinno Mediação*: A disputa do serviço "${booking.service.title}" foi concluída.\n\n` +
            `💰 *Valor liberado*: R$ ${providerPayout.toFixed(2)}\n` +
            `📝 *Parecer*: ${sanitizedNotes}\n\n` +
            `O saldo foi liberado da custódia para seu repasse.`
          : `⚖️ *Severinno Mediação*: A disputa do serviço "${booking.service.title}" foi concluída.\n\n` +
            `📝 *Parecer*: ${sanitizedNotes}\n\n` +
            `Foi determinado o estorno ao cliente conforme diretrizes de garantia.`

      enqueueWhatsApp({
        to: providerPhone,
        text: providerMsg,
        userId: booking.providerId,
        context: "dispute:resolved:provider",
      }).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      decision,
      clientRefund,
      providerPayout,
      resolutionSummary,
    })
  },
)
