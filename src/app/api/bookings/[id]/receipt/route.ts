export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden, notFound } from "@/lib/api-server"
import { formatBRL, formatDateTime } from "@/lib/format"
import { toMoneyNumber } from "@/lib/money"
import crypto from "crypto"

import { withParams } from "@/lib/api-route"

/**
 * GET /api/bookings/[id]/receipt
 * Generates a formal digital receipt for completed services.
 */
export const GET = withParams<{ id: string }>(
  "api.bookings.:id.receipt.GET",
  async (_request, { params }) => {
    const session = await requireUser()
    const { id: bookingId } = await params

    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        amount: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        address: true,
        scheduledAt: true,
        createdAt: true,
        updatedAt: true,
        clientId: true,
        providerId: true,
        service: { select: { title: true, description: true } },
        client: { select: { name: true, email: true, phone: true } },
        provider: { select: { name: true, email: true, phone: true, cpfCnpj: true } },
      },
    })

    if (!booking) {
      throw notFound("Agendamento não encontrado")
    }

    // Access control: client, provider, or admin
    if (
      session.userId !== booking.clientId &&
      session.userId !== booking.providerId &&
      session.role !== "ADMIN"
    ) {
      throw forbidden("Acesso restrito aos envolvidos no agendamento")
    }

    const receiptDate = booking.updatedAt || booking.createdAt
    const dateFormatted = receiptDate.toISOString().slice(0, 10).replace(/-/g, "")
    const serialNumber = `REC-${dateFormatted}-${booking.id.slice(-6).toUpperCase()}`

    // Cryptographic validation hash
    const hashData = `${serialNumber}:${booking.id}:${booking.amount}:${booking.providerId}:${booking.clientId}`
    const authCode = crypto
      .createHash("sha256")
      .update(hashData)
      .digest("hex")
      .slice(0, 16)
      .toUpperCase()

    return NextResponse.json({
      ok: true,
      receipt: {
        serialNumber,
        authCode,
        issueDate: formatDateTime(new Date()),
        serviceDate: formatDateTime(booking.scheduledAt),
        status: booking.status,
        service: {
          title: booking.service.title,
          description: booking.service.description,
          location: booking.address,
        },
        financials: {
          totalAmount: toMoneyNumber(booking.amount),
          formattedTotal: formatBRL(toMoneyNumber(booking.amount)),
          paymentMethod: booking.paymentMethod,
          paymentStatus: booking.paymentStatus,
        },
        provider: {
          name: booking.provider.name,
          document: booking.provider.cpfCnpj
            ? `${booking.provider.cpfCnpj.slice(0, 3)}***`
            : "Cadastrado",
          email: booking.provider.email,
        },
        client: {
          name: booking.client.name,
          email: booking.client.email,
        },
        platform: {
          name: "Severinno Marketplace SaaS",
          authenticityUrl: `https://severinno.app/verify-receipt/${authCode}`,
        },
      },
    })
  },
)
