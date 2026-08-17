import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { computeBaseBalance, getWithdrawals, FEE_RATE } from "@/lib/wallet"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(val: unknown): string {
  const s = String(val ?? "")
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00A0/g, " ")
}

function fmtDate(d: string): string {
  const date = new Date(d)
  return date.toLocaleDateString("pt-BR")
}

function statusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "Recebido"
    case "pending":
      return "Pendente"
    case "withdrawn":
      return "Sacado"
    case "refunded":
      return "Reembolsado"
    default:
      return status
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.wallet)
    const { searchParams } = new URL(request.url)
    const typeFilter = searchParams.get("type")
    const dateStart = searchParams.get("dateStart")
    const dateEnd = searchParams.get("dateEnd")

    // Validate type filter
    const validTypes = ["paid", "pending", "refunded", "withdrawn"] as const
    const filterType =
      typeFilter && validTypes.includes(typeFilter as (typeof validTypes)[number])
        ? (typeFilter as (typeof validTypes)[number])
        : null

    // Parse date range
    const startDate = dateStart ? new Date(dateStart) : null
    const endDate = dateEnd ? new Date(dateEnd) : null

    const [base, withdrawals] = await Promise.all([
      computeBaseBalance(session.userId),
      getWithdrawals(session.userId),
    ])

    // Merge and sort by date descending
    const all = [...withdrawals.withdrawalTxns, ...base.transactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )

    // Apply type filter
    let filtered = filterType ? all.filter((t) => t.status === filterType) : all

    // Apply date range filter if specified (inclusive)
    if (startDate) {
      const start = startDate.getTime()
      filtered = filtered.filter((t) => new Date(t.date).getTime() >= start)
    }
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      filtered = filtered.filter((t) => new Date(t.date).getTime() <= end.getTime())
    }

    // ── Build CSV ────────────────────────────────────────────────────────
    const rows: string[] = []

    // BOM for Excel compatibility
    rows.push("\uFEFF")

    // Summary
    const totalReceived = filtered
      .filter((t) => t.status === "paid")
      .reduce((acc, t) => acc + t.netAmount, 0)
    const totalPending = filtered
      .filter((t) => t.status === "pending")
      .reduce((acc, t) => acc + t.netAmount, 0)
    const totalWithdrawn = filtered
      .filter((t) => t.status === "withdrawn")
      .reduce((acc, t) => acc + t.netAmount, 0)

    rows.push("=== RESUMO ===")
    rows.push(["Total de transações", esc(filtered.length)].join(","))
    rows.push(["Total recebido", esc(fmtBRL(totalReceived))].join(","))
    rows.push(["Total pendente", esc(fmtBRL(totalPending))].join(","))
    rows.push(["Total sacado", esc(fmtBRL(totalWithdrawn))].join(","))
    rows.push("")

    // Transaction list
    rows.push("=== TRANSAÇÕES ===")
    rows.push(
      [
        "Data",
        "Descrição",
        "Cliente",
        "Valor Bruto",
        `Taxa (${FEE_RATE * 100}%)`,
        "Valor Líquido",
        "Status",
      ].join(","),
    )

    for (const t of filtered) {
      rows.push(
        [
          esc(fmtDate(t.date)),
          esc(t.description),
          esc(t.clientName),
          esc(fmtBRL(t.amount)),
          esc(fmtBRL(t.fee)),
          esc(fmtBRL(t.netAmount)),
          esc(statusLabel(t.status)),
        ].join(","),
      )
    }

    const csv = rows.join("\r\n")

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="extrato-carteira.csv"`,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
