export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Period = "7d" | "30d" | "90d" | "12m" | "all"

/**
 * CSV export of all transactions for the given period.
 *
 * GET /api/admin/finance/export?period=30d
 *
 * Returns a CSV file attachment with columns:
 *   ID, Data, Cliente, Prestador, Serviço, Valor, Método, Status, ID Transação
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const period = (searchParams.get("period") ?? "30d") as Period

    // Compute date filter (same logic as main finance route)
    const now = new Date()
    let dateFilter: Date | null = null
    switch (period) {
      case "7d":
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case "30d":
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case "90d":
        dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      case "12m":
        dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1)
        break
    }

    const paymentWhere = dateFilter ? { createdAt: { gte: dateFilter } } : {}

    // Fetch ALL transactions for the period (no pagination)
    const transactions = await db.payment.findMany({
      where: paymentWhere,
      orderBy: { createdAt: "desc" },
      include: {
        booking: {
          select: {
            id: true,
            scheduledAt: true,
            client: { select: { id: true, name: true, email: true } },
            provider: { select: { id: true, name: true } },
            service: { select: { id: true, title: true } },
          },
        },
      },
    })

    // CSV helpers
    const statusLabels: Record<string, string> = {
      PAID: "Pago",
      PENDING: "Pendente",
      REFUNDED: "Estornado",
      WAITING_PAYMENT: "Aguardando",
      CANCELED: "Cancelado",
      EXPIRED: "Expirado",
      FAILED: "Falhou",
    }

    const methodLabels: Record<string, string> = {
      PIX: "PIX",
      CARD: "Cartão de Crédito",
    }

    function escapeCsv(val: string | number | null | undefined): string {
      if (val == null) return ""
      const s = String(val)
      // Wrap in quotes if contains comma, quote, or newline
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    function formatDate(iso: Date): string {
      const d = new Date(iso)
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    }

    function formatDateTime(iso: Date): string {
      const d = new Date(iso)
      return d.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    }

    // Build CSV rows
    const header = [
      "ID",
      "Data",
      "Cliente",
      "E-mail do Cliente",
      "Prestador",
      "Serviço",
      "Valor (R$)",
      "Método",
      "Status",
      "ID Transação Lytex",
      "Data de Pagamento",
      "Data de Criação",
    ]

    const rows = transactions.map((tx) => [
      tx.id,
      formatDate(tx.createdAt),
      tx.booking?.client?.name ?? "",
      tx.booking?.client?.email ?? "",
      tx.booking?.provider?.name ?? "",
      tx.booking?.service?.title ?? "",
      (tx.amount / 100).toFixed(2).replace(".", ","), // BRL format
      methodLabels[tx.method] ?? tx.method,
      statusLabels[tx.status] ?? tx.status,
      tx.lytexId ?? "",
      tx.paidAt ? formatDateTime(tx.paidAt) : "",
      formatDateTime(tx.createdAt),
    ])

    // Build CSV string with BOM for Excel compatibility
    const bom = "\uFEFF"
    const csvString =
      bom +
      header.map(escapeCsv).join(";") +
      "\n" +
      rows.map((row) => row.map(escapeCsv).join(";")).join("\n")

    return new NextResponse(csvString, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="transacoes-${period}-${formatDateRange(dateFilter, now)}.csv"`,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}

function formatDateRange(from: Date | null, to: Date): string {
  const d = new Date(to)
  const day = String(d.getDate()).padStart(2, "0")
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const year = d.getFullYear()
  if (!from) return `ate-${day}${month}${year}`
  const f = new Date(from)
  return `${String(f.getDate()).padStart(2, "0")}${String(f.getMonth() + 1).padStart(2, "0")}${f.getFullYear()}-${day}${month}${year}`
}
