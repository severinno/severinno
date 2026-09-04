export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { badRequest, forbidden, handleError, notFound } from "@/lib/api-server"
import {
  createPixCharge,
  createCardCharge,
  pollChargeStatus,
  lytexLogger,
  LytexError,
} from "@/lib/lytex"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Params = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// POST /api/bookings/[id]/pay
// Inicia o pagamento via Lytex (PIX → gera QR code; Cartão → processa)
// ---------------------------------------------------------------------------
export async function POST(_request: Request, { params }: Params) {
  try {
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

    // Rate limit específico por booking (evita múltiplas tentativas)
    await assertRateLimit(_request, {
      ...RATE_LIMITS.bookings,
      prefix: `pay:${id}`,
    })

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
          return NextResponse.json({
            paymentMethod: "PIX",
            status: existing.status,
            lytexStatus: existing.lytexStatus,
            qrCode: existing.qrCode,
            qrCodeImage: existing.qrCodeImage,
            lytexId: existing.lytexId,
          })
        }
      }

      try {
        const pix = await createPixCharge({
          externalReference,
          amount: booking.amount,
          customer,
          description: `Agendamento #${id.slice(0, 8)} - Severinno`,
          additionalInfo: [
            { key: "booking_id", value: id },
            { key: "client_id", value: booking.clientId },
          ],
        })

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

        return NextResponse.json({
          paymentMethod: "PIX",
          status: "PENDING",
          lytexStatus: pix.status,
          qrCode: pix.qrCode,
          qrCodeImage: pix.qrCodeImage,
          lytexId: pix.id,
          expiresAt: pix.expiresAt,
        })
      } catch (e) {
        lytexLogger.error({ err: e, bookingId: id }, "Pay: erro ao gerar PIX")
        if (e instanceof LytexError) {
          throw badRequest(`Lytex: ${e.message}`)
        }
        throw e
      }
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
        amount: booking.amount,
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

        return NextResponse.json({
          paymentMethod: "CARD",
          status: "PAID",
          lytexStatus: cardCharge.status,
          cardLastDigits: cardCharge.cardLastDigits,
          cardBrand: cardCharge.cardBrand,
          installments: cardCharge.installments,
          transactionId: cardCharge.transactionId,
        })
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

        return NextResponse.json({
          paymentMethod: "CARD",
          status: "waitingPayment",
          lytexStatus: cardCharge.status,
          cardLastDigits: cardCharge.cardLastDigits,
          cardBrand: cardCharge.cardBrand,
          installments: cardCharge.installments,
          transactionId: cardCharge.transactionId,
          message: "Pagamento em processamento. A confirmação pode levar alguns instantes.",
        })
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
    return handleError(e)
  }
}
