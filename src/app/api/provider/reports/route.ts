/**
 * Provider Exportable Reports API
 *
 * GET /api/provider/reports?type=bookings|quotes|financial&period=30d|90d|all&format=csv|json
 * Exports provider business data into formatted CSV or JSON.
 */

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSession } from "@/lib/auth"
import logger from "@/lib/logger"

const log = logger.child({ module: "provider-reports-api" })

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { role: true, name: true },
  })

  if (user?.role !== "PROVIDER" && user?.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Apenas prestadores podem exportar relatórios de atendimento." },
      { status: 403 },
    )
  }

  const { searchParams } = request.nextUrl
  const reportType = searchParams.get("type") || "bookings"
  const period = searchParams.get("period") || "30d"
  const format = searchParams.get("format") || "csv"

  const now = new Date()
  let sinceDate = new Date(0) // all time
  if (period === "7d") sinceDate = new Date(now.getTime() - 7 * 24 * 3600 * 1000)
  if (period === "30d") sinceDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000)
  if (period === "90d") sinceDate = new Date(now.getTime() - 90 * 24 * 3600 * 1000)

  try {
    if (reportType === "bookings") {
      const bookings = await db.booking.findMany({
        where: {
          providerId: session.userId,
          createdAt: { gte: sinceDate },
        },
        include: {
          client: { select: { name: true, phone: true, email: true } },
          service: { select: { title: true } },
        },
        orderBy: { scheduledAt: "desc" },
      })

      if (format === "json") {
        return NextResponse.json({ bookings, count: bookings.length })
      }

      // Generate CSV
      const headers = [
        "ID",
        "Data Agendada",
        "Serviço",
        "Cliente",
        "Contato",
        "Valor (R$)",
        "Status",
        "Forma Pagamento",
        "Status Pagamento",
      ]

      const rows = bookings.map((b) => [
        b.id,
        b.scheduledAt ? new Date(b.scheduledAt).toISOString().split("T")[0] : "",
        `"${(b.service?.title || "").replace(/"/g, '""')}"`,
        `"${(b.client?.name || "").replace(/"/g, '""')}"`,
        b.client?.phone || "",
        b.amount.toFixed(2),
        b.status,
        b.paymentMethod,
        b.paymentStatus,
      ])

      const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n")

      return new NextResponse("\uFEFF" + csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="relatorio-agendamentos-${period}.csv"`,
        },
      })
    }

    if (reportType === "quotes") {
      const quoteItems = await db.quoteItem.findMany({
        where: {
          providerId: session.userId,
          createdAt: { gte: sinceDate },
        },
        include: {
          service: { select: { title: true } },
          request: {
            include: {
              client: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      })

      if (format === "json") {
        return NextResponse.json({ quotes: quoteItems, count: quoteItems.length })
      }

      const headers = [
        "ID",
        "Data Solicitação",
        "Serviço",
        "Cliente",
        "Valor Ofertado (R$)",
        "Status",
      ]
      const rows = quoteItems.map((q) => [
        q.id,
        new Date(q.createdAt).toISOString().split("T")[0],
        `"${(q.service?.title || "").replace(/"/g, '""')}"`,
        `"${(q.request?.client?.name || "").replace(/"/g, '""')}"`,
        q.price ? q.price.toFixed(2) : "Pendente",
        q.status,
      ])

      const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n")

      return new NextResponse("\uFEFF" + csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="relatorio-orcamentos-${period}.csv"`,
        },
      })
    }

    // Default financial settlement summary
    const bookingsPaid = await db.booking.findMany({
      where: {
        providerId: session.userId,
        paymentStatus: "PAID",
        createdAt: { gte: sinceDate },
      },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        updatedAt: true,
      },
    })

    const totalGross = bookingsPaid.reduce((acc, b) => acc + b.amount, 0)
    const platformFee = totalGross * 0.12 // 12% fee
    const netReceived = totalGross - platformFee

    if (format === "json") {
      return NextResponse.json({
        totalGross,
        platformFee,
        netReceived,
        totalBookings: bookingsPaid.length,
      })
    }

    const headers = [
      "ID Agendamento",
      "Data Pagamento",
      "Forma",
      "Valor Bruto (R$)",
      "Taxa Plataforma (R$)",
      "Valor Líquido (R$)",
    ]
    const rows = bookingsPaid.map((b) => {
      const fee = b.amount * 0.12
      const net = b.amount - fee
      return [
        b.id,
        new Date(b.updatedAt).toISOString().split("T")[0],
        b.paymentMethod,
        b.amount.toFixed(2),
        fee.toFixed(2),
        net.toFixed(2),
      ]
    })

    const csvContent = [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\n")

    return new NextResponse("\uFEFF" + csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="relatorio-financeiro-${period}.csv"`,
      },
    })
  } catch (err) {
    log.error({ err, userId: session.userId }, "Error generating provider report")
    return NextResponse.json({ error: "Erro ao gerar relatório" }, { status: 500 })
  }
}
