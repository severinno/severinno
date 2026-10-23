export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, notFound } from "@/lib/api-server"
import {
  createPixCharge,
  createCardCharge,
  pollChargeStatus,
  lytexLogger,
  LytexError,
  type PixChargeResponse,
} from "@/lib/lytex"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { notifyPixCreated } from "@/lib/notifications"
import { toMoneyNumber } from "@/lib/money"
import {
  getIdempotencyKey,
  deriveIdempotencyKey,
  acquireIdempotency,
  completeIdempotency,
  failIdempotency,
  idempotencyErrorResponse,
  IdempotencyError,
} from "@/lib/idempotency"

import { withParams } from "@/lib/api-route"

// ---------------------------------------------------------------------------
// POST /api/bookings/[id]/pay
// Inicia o pagamento via Lytex (PIX → gera QR code; Cartão → processa)
// ---------------------------------------------------------------------------
export const POST = withParams<{ id: string }>(
  "api.bookings.:id.pay.POST",
  async (_request, { params }) => {
    const session = await requireUser()
    const { id } = await params

    const booking = await db.booking.findUnique({
      where: { id },
      select: {
        id: true,
        clientId: true,
        status: true,
        paymentStatus: true,
        amount: true,
        paymentMethod: true,
        client: {
          select: {
            id: true,
            email: true,
            name: true,
            cpfCnpj: true,
            whatsapp: true,
          },
        },
        payment: { select: { id: true, status: true, lytexId: true } },
      },
    })
    if (!booking) throw notFound("Agendamento não encontrado")
    if (booking.clientId !== session.userId && session.role !== "ADMIN") {
      throw forbidden("Apenas o cliente pode pagar este agendamento")
    }
    if (booking.status === "CANCELLED") {
      throw badRequest("Agendamento cancelado")
    }
    if (booking.paymentStatus === "PAID") {
      throw badRequest("Pagamento já realizado")
    }

    // Rate limit específico por booking (evita múltiplas tentativas).
    // ANTES do acquire: um 429 não pode marcar a chave como "failed".
    await assertRateLimit(_request, {
      ...RATE_LIMITS.bookings,
      prefix: `pay:${id}`,
    })

    // ── Idempotência (proteção contra cobrança duplicada no Lytex) ──
    // Chave explícita do cliente no header Idempotency-Key; sem header, deriva
    // server-side por booking (a mesma intenção = a mesma chave: o retry do
    // duplo-clique/timeout NÃO cria uma segunda cobrança).
    let idempotencyKey: string
    try {
      idempotencyKey = getIdempotencyKey(_request) ?? deriveIdempotencyKey(id)
    } catch (e) {
      if (e instanceof IdempotencyError) {
        return NextResponse.json({ error: e.message }, { status: e.status })
      }
      throw e
    }

    const idemContext = {
      bookingId: id,
      method: booking.paymentMethod,
      amount: toMoneyNumber(booking.amount),
    }
    const acquired = await acquireIdempotency(idempotencyKey, idemContext)

    if (acquired.kind === "replay") {
      lytexLogger.info({ bookingId: id, idempotencyKey }, "Pay: replay de resposta idempotente")
      return NextResponse.json(acquired.response as Record<string, unknown>)
    }
    const idemError = idempotencyErrorResponse(acquired)
    if (idemError) {
      return NextResponse.json(idemError.body, { status: idemError.status })
    }
    // kind === "fresh" — reserva concedida. Os 4 pontos de sucesso passam por
    // `finish` (grava a resposta para replay) e o catch do try abaixo marca
    // "failed" (retry devolve 409 em vez de criar segunda cobrança).
    const finish = async (response: NextResponse): Promise<NextResponse> => {
      try {
        await completeIdempotency(idempotencyKey, await response.clone().json())
      } catch {
        // Sem replay (body não-JSON) — a resposta original segue intacta.
      }
      return response
    }

    try {
      const customer = {
        name: booking.client.name,
        email: booking.client.email,
        cpfCnpj: booking.client.cpfCnpj ?? "000.000.000-00",
        phone: booking.client.whatsapp ?? undefined,
      }

      const externalReference = `booking:${id}`

      // ── PIX ──
      if (booking.paymentMethod === "PIX") {
        // Se já existe uma cobrança PIX ativa, retorna ela (idempotência)
        if (booking.payment?.lytexId) {
          lytexLogger.info({ bookingId: id }, "Pay: cobrança PIX já existe, reusando")

          const existing = await db.payment.findUnique({
            where: { bookingId: id },
            select: {
              lytexId: true,
              qrCode: true,
              qrCodeImage: true,
              status: true,
              lytexStatus: true,
            },
          })

          if (existing?.qrCode) {
            return finish(
              NextResponse.json({
                paymentMethod: "PIX",
                status: existing.status,
                lytexStatus: existing.lytexStatus,
                qrCode: existing.qrCode,
                qrCodeImage: existing.qrCodeImage,
                lytexId: existing.lytexId,
              }),
            )
          }
        }

        let pix: PixChargeResponse
        const amount = toMoneyNumber(booking.amount)
        try {
          pix = await createPixCharge({
            externalReference,
            amount,
            customer,
            description: `Agendamento #${id.slice(0, 8)} - Severinno`,
            additionalInfo: [
              { key: "booking_id", value: id },
              { key: "client_id", value: booking.clientId },
            ],
          })
        } catch (e) {
          if (e instanceof LytexError) {
            lytexLogger.error({ err: e, bookingId: id }, "Pay: erro Lytex no PIX")
            throw badRequest(`Lytex: ${e.message}`)
          }
          if (process.env.NODE_ENV === "development" && !process.env.LYTEX_CLIENT_ID) {
            lytexLogger.warn(
              { bookingId: id },
              "Pay: usando mock dev de PIX (Lytex não configurado)",
            )
            const mockTx = `tx_${Date.now()}`
            const mockCode = `00020126580014br.gov.bcb.pix0136${id}520400005303986540${amount.toFixed(2)}5802BR5913Severinno%20Plat6009Sao%20Paulo62070503***6304ABCD`
            pix = {
              id: `lytex_mock_${id}`,
              status: "pending",
              transactionId: mockTx,
              qrCode: mockCode,
              qrCodeImage: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(mockCode)}`,
              pixKey: "financeiro@severinno.com",
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              amount,
              lytexStatus: "pending",
              createdAt: new Date().toISOString(),
            }
          } else {
            lytexLogger.error({ err: e, bookingId: id }, "Pay: erro ao gerar PIX")
            throw e
          }
        }

        // Salvar dados PIX no payment
        await db.payment.upsert({
          where: { bookingId: id },
          create: {
            bookingId: id,
            amount: booking.amount,
            method: "PIX",
            status: "PENDING",
            transactionId: pix.transactionId,
            lytexId: pix.id,
            lytexStatus: pix.status,
            qrCode: pix.qrCode,
            qrCodeImage: pix.qrCodeImage,
            lytexRawResponse: JSON.parse(JSON.stringify(pix)),
          },
          update: {
            transactionId: pix.transactionId,
            lytexId: pix.id,
            lytexStatus: pix.status,
            qrCode: pix.qrCode,
            qrCodeImage: pix.qrCodeImage,
            lytexRawResponse: JSON.parse(JSON.stringify(pix)),
          },
        })

        lytexLogger.info({ bookingId: id, lytexId: pix.id }, "Pay: PIX gerado com sucesso")

        // Notificar cliente via WhatsApp com o código PIX Copia e Cola (fire-and-forget)
        notifyPixCreated(booking.clientId, id, amount, pix.qrCode).catch((err) =>
          lytexLogger.warn({ err, bookingId: id }, "Pay: falha ao enviar notificação PIX"),
        )

        return finish(
          NextResponse.json({
            paymentMethod: "PIX",
            status: "PENDING",
            lytexStatus: pix.status,
            qrCode: pix.qrCode,
            qrCodeImage: pix.qrCodeImage,
            lytexId: pix.id,
            expiresAt: pix.expiresAt,
          }),
        )
      }

      // ── Cartão de Crédito ──
      // Os dados do cartão vêm do frontend (tokenizado ou direto)
      try {
        const body = await _request.json().catch(() => ({}))
        const card = body.card

        if (
          !card?.number ||
          !card?.holderName ||
          !card?.expiryMonth ||
          !card?.expiryYear ||
          !card?.cvv
        ) {
          throw badRequest("Dados do cartão incompletos")
        }

        const cardCharge = await createCardCharge({
          externalReference,
          amount: toMoneyNumber(booking.amount),
          customer,
          card: {
            number: String(card.number).replace(/\s/g, ""),
            holderName: String(card.holderName),
            expiryMonth: String(card.expiryMonth).padStart(2, "0"),
            expiryYear: String(card.expiryYear),
            cvv: String(card.cvv),
          },
          installments: Number(card.installments) || 1,
          description: `Agendamento #${id.slice(0, 8)} - Severinno`,
        })

        // Se o pagamento foi síncrono (aprovado imediatamente)
        if (cardCharge.status === "paid") {
          await db.$transaction([
            db.payment.upsert({
              where: { bookingId: id },
              create: {
                bookingId: id,
                amount: booking.amount,
                method: "CARD",
                status: "PAID",
                transactionId: cardCharge.transactionId,
                lytexId: cardCharge.id,
                lytexStatus: cardCharge.status,
                cardLastDigits: cardCharge.cardLastDigits,
                cardBrand: cardCharge.cardBrand,
                installments: cardCharge.installments,
                paidAt: new Date(),
                lytexRawResponse: JSON.parse(JSON.stringify(cardCharge)),
              },
              update: {
                transactionId: cardCharge.transactionId,
                lytexId: cardCharge.id,
                lytexStatus: cardCharge.status,
                cardLastDigits: cardCharge.cardLastDigits,
                cardBrand: cardCharge.cardBrand,
                installments: cardCharge.installments,
                status: "PAID",
                paidAt: new Date(),
                lytexRawResponse: JSON.parse(JSON.stringify(cardCharge)),
              },
            }),
            db.booking.update({
              where: { id },
              data: { paymentStatus: "PAID" },
            }),
          ])

          lytexLogger.info(
            { bookingId: id, lytexId: cardCharge.id },
            "Pay: cartão aprovado imediatamente",
          )

          return finish(
            NextResponse.json({
              paymentMethod: "CARD",
              status: "PAID",
              lytexStatus: cardCharge.status,
              cardLastDigits: cardCharge.cardLastDigits,
              cardBrand: cardCharge.cardBrand,
              installments: cardCharge.installments,
              transactionId: cardCharge.transactionId,
            }),
          )
        }

        // Se está em processamento (waitingPayment)
        if (cardCharge.status === "waitingPayment") {
          // Salvar como PENDING
          await db.payment.upsert({
            where: { bookingId: id },
            create: {
              bookingId: id,
              amount: booking.amount,
              method: "CARD",
              status: "PENDING",
              transactionId: cardCharge.transactionId,
              lytexId: cardCharge.id,
              lytexStatus: cardCharge.status,
              cardLastDigits: cardCharge.cardLastDigits,
              cardBrand: cardCharge.cardBrand,
              installments: cardCharge.installments,
              lytexRawResponse: JSON.parse(JSON.stringify(cardCharge)),
            },
            update: {
              transactionId: cardCharge.transactionId,
              lytexId: cardCharge.id,
              lytexStatus: cardCharge.status,
              cardLastDigits: cardCharge.cardLastDigits,
              cardBrand: cardCharge.cardBrand,
              installments: cardCharge.installments,
              lytexRawResponse: JSON.parse(JSON.stringify(cardCharge)),
            },
          })

          // Iniciar polling assíncrono (não bloqueia a resposta)
          pollChargeStatus(cardCharge.id)
            .then(async (result) => {
              if (result.status === "paid") {
                await db.$transaction([
                  db.payment.update({
                    where: { bookingId: id },
                    data: {
                      status: "PAID",
                      lytexStatus: result.status,
                      paidAt: result.paidAt ? new Date(result.paidAt) : new Date(),
                    },
                  }),
                  db.booking.update({
                    where: { id },
                    data: { paymentStatus: "PAID" },
                  }),
                ])
                lytexLogger.info({ bookingId: id }, "Pay: polling confirmou pagamento")
              }
            })
            .catch((e) => {
              lytexLogger.error({ err: e, bookingId: id }, "Pay: polling falhou")
            })

          return finish(
            NextResponse.json({
              paymentMethod: "CARD",
              status: "waitingPayment",
              lytexStatus: cardCharge.status,
              cardLastDigits: cardCharge.cardLastDigits,
              cardBrand: cardCharge.cardBrand,
              installments: cardCharge.installments,
              transactionId: cardCharge.transactionId,
              message: "Pagamento em processamento. A confirmação pode levar alguns instantes.",
            }),
          )
        }

        // Outros status (falha, etc.)
        throw badRequest(`Pagamento não aprovado: ${cardCharge.status}`)
      } catch (e) {
        lytexLogger.error({ err: e, bookingId: id }, "Pay: erro no cartão")
        if (e instanceof LytexError) {
          throw badRequest(`Lytex: ${e.message}`)
        }
        throw e
      }
    } catch (e) {
      await failIdempotency(
        idempotencyKey,
        e instanceof Error ? e.message : "Erro desconhecido no pagamento",
      )
      throw e
    }
  },
)
