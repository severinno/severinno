export const dynamic = "force-dynamic"

import { captureErrorEnhanced } from "@/lib/sentry-enhanced"
import logger from "@/lib/logger"
/**
 * Webhook Lytex Pagamentos
 *
 * Recebe notificações em tempo real da Lytex quando um pagamento é
 * confirmado (PIX ou Cartão de Crédito).
 *
 * Configuração no painel Lytex:
 *   pay.lytex.com.br > Configurações > Integrações > Gateway
 *   → Ativar "Notificação de pagamentos em tempo real"
 *   → URL: https://seudominio.com.br/api/webhooks/lytex
 *
 * A Lytex envia um POST com o payload assinado via HMAC-SHA256.
 * A verificação usa o client_secret como chave.
 */

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  verifyWebhookSignature,
  parseExternalReference,
  lytexLogger,
  type LytexWebhookPayload,
} from "@/lib/lytex"
import { notifyPaymentConfirmed, notifyPaymentConfirmedToClient } from "@/lib/notifications"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  deriveIdempotencyKey,
  acquireIdempotency,
  completeIdempotency,
  failIdempotency,
  idempotencyErrorResponse,
} from "@/lib/idempotency"
import { toMoneyNumber } from "@/lib/money"

// ---------------------------------------------------------------------------
// Helper: confirmar pagamento do booking
// ---------------------------------------------------------------------------

async function confirmBookingPayment(
  bookingId: string,
  paymentData: {
    lytexId: string
    lytexStatus: string
    qrCode?: string
    qrCodeImage?: string
    cardLastDigits?: string
    cardBrand?: string
    installments?: number
    paidAt?: string
    transactionId?: string
  },
) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      paymentStatus: true,
      status: true,
      clientId: true,
      providerId: true,
      amount: true,
      service: { select: { title: true } },
      provider: { select: { name: true } },
      payment: { select: { id: true, status: true } },
    },
  })
  if (!booking || !booking.payment) {
    lytexLogger.warn({ bookingId }, "Webhook: booking ou payment não encontrado ")
    return
  }

  // Se já está pago, só atualiza metadados (não duplica confirmação)
  if (booking.paymentStatus === "PAID") {
    await db.payment.update({
      where: { bookingId },
      data: {
        lytexId: paymentData.lytexId,
        lytexStatus: paymentData.lytexStatus,
        qrCode: paymentData.qrCode,
        qrCodeImage: paymentData.qrCodeImage,
        cardLastDigits: paymentData.cardLastDigits,
        cardBrand: paymentData.cardBrand,
        installments: paymentData.installments,
        ...(paymentData.paidAt ? { paidAt: new Date(paymentData.paidAt) } : {}),
        transactionId: paymentData.transactionId ?? undefined,
      },
    })
    lytexLogger.info({ bookingId }, "Webhook: pagamento já confirmado (metadados atualizados)")
    return
  }

  // Atualizar payment + booking
  const now = paymentData.paidAt ? new Date(paymentData.paidAt) : new Date()

  await db.$transaction([
    db.payment.update({
      where: { bookingId },
      data: {
        status: "PAID",
        lytexId: paymentData.lytexId,
        lytexStatus: paymentData.lytexStatus,
        qrCode: paymentData.qrCode,
        qrCodeImage: paymentData.qrCodeImage,
        cardLastDigits: paymentData.cardLastDigits,
        cardBrand: paymentData.cardBrand,
        installments: paymentData.installments,
        paidAt: now,
        transactionId: paymentData.transactionId ?? undefined,
      },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: "PAID" },
    }),
  ])

  lytexLogger.info(
    { bookingId, amount: toMoneyNumber(booking.amount) },
    "Webhook: pagamento confirmado com sucesso",
  )

  // Notificar provider via WhatsApp (best-effort)
  notifyPaymentConfirmed(booking.providerId, bookingId, toMoneyNumber(booking.amount)).catch(
    (err) => logger.warn({ err }, "lytex payment notification failed"),
  )

  // Notificar cliente com recibo via WhatsApp (best-effort)
  notifyPaymentConfirmedToClient(
    booking.clientId,
    bookingId,
    toMoneyNumber(booking.amount),
    booking.service?.title ?? "Serviço",
    booking.provider?.name ?? "Prestador",
  ).catch((err) => logger.warn({ err }, "lytex client payment confirmation failed"))
}

// ---------------------------------------------------------------------------
// Helper: reembolso no Lytex
// ---------------------------------------------------------------------------

async function refundBookingPayment(bookingId: string) {
  const payment = await db.payment.findUnique({
    where: { bookingId },
    select: { id: true, status: true, lytexId: true },
  })

  if (!payment || !payment.lytexId) {
    lytexLogger.warn({ bookingId }, "Webhook: payment sem lytexId para reembolso")
    return
  }

  // Só atualiza status — o reembolso já foi processado pela Lytex
  await db.$transaction([
    db.payment.update({
      where: { bookingId },
      data: { status: "REFUNDED", lytexStatus: "refunded" },
    }),
    db.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: "REFUNDED" },
    }),
  ])

  lytexLogger.info({ bookingId }, "Webhook: reembolso processado")
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * POST /api/webhooks/lytex
 *
 * Recebe notificações de pagamento da Lytex.
 * A Lytex espera um 200 OK rápido — processamento é assíncrono.
 */
export async function POST(request: Request) {
  // Preenchido após a validação da assinatura — o catch usa para marcar a
  // tentativa como "failed" SOMENTE quando a chave já foi reservada.
  let webhookKey: string | undefined
  try {
    // Rate limit para webhooks de pagamento (20/min — vem de IP fixo do Lytex)
    await assertRateLimit(request, RATE_LIMITS.webhookLytex)

    const body = (await request.json()) as LytexWebhookPayload

    lytexLogger.info(
      { status: body.status, externalRef: body.externalReference },
      "Webhook recebido da Lytex",
    )

    // Validar assinatura
    const isValid = verifyWebhookSignature(body)
    if (!isValid) {
      lytexLogger.warn({}, "Webhook: assinatura inválida")
      return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 })
    }

    // Extrair booking ID do externalReference (formato: "booking:{bookingId}")
    const ref = parseExternalReference(body.externalReference)
    if (!ref || ref.type !== "booking" || !ref.id) {
      lytexLogger.warn(
        { externalRef: body.externalReference },
        "Webhook: externalReference inválido",
      )
      return NextResponse.json({ error: "externalReference inválido" }, { status: 400 })
    }

    const bookingId = ref.id

    // ── Idempotência em BANCO (tabela IdempotencyRecord, escopo webhook:lytex) ──
    // Substitui a trava Redis (GET-then-SET), que não era atômica: dois
    // reenvios simultâneos liam "não processado" ao mesmo tempo e processavam
    // duas vezes. Aqui a corrida é resolvida pelo @unique: o perdedor recebe
    // P2002 → in_flight, sem segundo processamento.
    // A MESMA cobrança Lytex (body.id) emite VÁRIOS eventos (paid, refunded…):
    // a chave inclui o status, então eventos DIFERENTES processam e o REENVIO
    // do mesmo evento replaya.
    const eventId = `${body.id || body.transactionId || `${bookingId}:${body.status}`}:${body.status}`
    webhookKey = deriveIdempotencyKey(eventId, "webhook:lytex")
    const webhookCtx = { bookingId, status: body.status, lytexId: body.id }
    const acquired = await acquireIdempotency(webhookKey, webhookCtx, "webhook:lytex")

    if (acquired.kind === "replay") {
      lytexLogger.info(
        { bookingId, status: body.status, lytexId: body.id },
        "Webhook: evento já processado (replay idempotente)",
      )
      return NextResponse.json({ received: true, deduplicated: true })
    }
    const idemError = idempotencyErrorResponse(acquired)
    if (idemError) {
      // in_flight = reenvio simultâneo: o vencedor processa este mesmo evento;
      // responder 200 evita backoff de retry na Lytex. failed/conflict são
      // registrados para investigação (ver IdempotencyRecord.error).
      lytexLogger.warn(
        { bookingId, status: body.status, kind: acquired.kind },
        "Webhook: evento não processado pela idempotência",
      )
      return NextResponse.json({ received: true, deduplicated: true })
    }
    // kind === "fresh": chave reservada. Sucesso grava replay; falha cai no
    // catch abaixo e marca "failed" (com o erro visível no registro).

    // Processar conforme o status
    switch (body.status) {
      case "paid":
        await confirmBookingPayment(bookingId, {
          lytexId: body.id,
          lytexStatus: body.status,
          qrCode: body.qrCode,
          qrCodeImage: body.qrCodeImage,
          cardLastDigits: body.cardLastDigits,
          cardBrand: body.cardBrand,
          installments: body.installments,
          paidAt: body.paidAt,
          transactionId: body.transactionId,
        })
        break

      case "refunded":
        await refundBookingPayment(bookingId)
        break

      case "canceled":
      case "expired":
        lytexLogger.info({ bookingId, status: body.status }, "Webhook: cobrança cancelada/expirada")
        break

      case "waitingPayment":
        lytexLogger.info({ bookingId }, "Webhook: pagamento em processamento (waitingPayment)")
        break

      default:
        lytexLogger.info({ bookingId, status: body.status }, "Webhook: status não mapeado")
    }

    // Sucesso: grava a resposta para replays futuros deste evento.
    await completeIdempotency(webhookKey, { received: true })

    // Sempre retornar 200 para a Lytex (evita reenvios desnecessários)
    return NextResponse.json({ received: true })
  } catch (e) {
    // Marca a tentativa como failed (o erro fica visível no registro; um
    // eventual reenvio da Lytex não reprocessa às cegas).
    if (webhookKey) {
      await failIdempotency(
        webhookKey,
        e instanceof Error ? e.message : "Erro desconhecido no webhook",
      )
    }
    // Log do erro mas retorna 200 para a Lytex não reenviar
    lytexLogger.error({ err: e }, "Webhook: erro no processamento")
    captureErrorEnhanced(e, {
      url: "/api/webhooks/lytex",
      method: "POST",
      tags: { source: "lytex-webhook" },
    })
    return NextResponse.json({ received: true })
  }
}
