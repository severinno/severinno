import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { FEE_RATE } from "@/lib/wallet"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a CSV cell — wrap in quotes if contains comma, quote, or newline. */
function esc(val: unknown): string {
  const s = String(val ?? "")
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Format a number as Brazilian currency string (e.g. "R$ 1.234,56"). */
function fmtBRL(n: number): string {
  return n
    .toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    })
    .replace(/\u00A0/g, " ")
}

/** Month name in Portuguese. */
function monthName(key: string): string {
  const m = parseInt(key.split("-")[1], 10)
  const months = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ]
  return months[m - 1] ?? key
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get("year")
    const selectedYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()

    const yearStart = new Date(selectedYear, 0, 1)
    const yearEnd = new Date(selectedYear + 1, 0, 1)

    const bookings = await db.booking.findMany({
      where: {
        paymentStatus: "PAID",
        createdAt: { gte: yearStart, lt: yearEnd },
      },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        provider: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    // ── Aggregate totals ─────────────────────────────────────────────────
    let grossRevenue = 0
    let completedCount = 0
    const providerMap = new Map<
      string,
      {
        name: string
        bookingCount: number
        grossRevenue: number
        completedCount: number
      }
    >()
    const monthlyMap = new Map<string, { gross: number; count: number }>()

    for (const b of bookings) {
      grossRevenue += b.amount
      if (b.status === "COMPLETED") completedCount++

      // Per-provider
      const pid = b.provider.id
      const existing = providerMap.get(pid) ?? {
        name: b.provider.name,
        bookingCount: 0,
        grossRevenue: 0,
        completedCount: 0,
      }
      existing.bookingCount++
      existing.grossRevenue += b.amount
      if (b.status === "COMPLETED") existing.completedCount++
      providerMap.set(pid, existing)

      // Monthly — use UTC methods to avoid timezone shifts (DB stores UTC)
      const d = new Date(b.createdAt)
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      const mEntry = monthlyMap.get(key) ?? { gross: 0, count: 0 }
      mEntry.gross += b.amount
      mEntry.count++
      monthlyMap.set(key, mEntry)
    }

    const platformCommission = Math.round(grossRevenue * FEE_RATE * 100) / 100
    const providerEarnings = Math.round(grossRevenue * (1 - FEE_RATE) * 100) / 100

    // Sort providers by gross descending
    const sortedProviders = Array.from(providerMap.entries())
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => b.grossRevenue - a.grossRevenue)

    // Sort monthly chronologically
    const sortedMonthly = Array.from(monthlyMap.entries()).sort(([a], [b]) => a.localeCompare(b))

    // ── Build CSV ────────────────────────────────────────────────────────
    const rows: string[] = []

    // BOM for Excel compatibility with Brazilian Portuguese
    rows.push("\uFEFF")

    // ── Summary ──────────────────────────────────────────────────────────
    rows.push("=== RESUMO ===")
    rows.push(["Ano", esc(selectedYear)].join(","))
    rows.push(["Receita Bruta", esc(fmtBRL(grossRevenue))].join(","))
    rows.push(["Comissão da Plataforma (15%)", esc(fmtBRL(platformCommission))].join(","))
    rows.push(["Repassado aos Prestadores (85%)", esc(fmtBRL(providerEarnings))].join(","))
    rows.push(["Bookings PAID", esc(bookings.length)].join(","))
    rows.push(["Bookings Completos", esc(completedCount)].join(","))
    rows.push("")

    // ── Monthly breakdown ───────────────────────────────────────────────
    rows.push("=== RECEITA MENSAL ===")
    rows.push(["Mês", "Bruto", "Comissão", "Repassado", "Agendamentos"].join(","))
    for (const [key, data] of sortedMonthly) {
      const gross = Math.round(data.gross * 100) / 100
      const comm = Math.round(data.gross * FEE_RATE * 100) / 100
      const net = Math.round(data.gross * (1 - FEE_RATE) * 100) / 100
      rows.push(
        [
          esc(monthName(key)),
          esc(fmtBRL(gross)),
          esc(fmtBRL(comm)),
          esc(fmtBRL(net)),
          esc(data.count),
        ].join(","),
      )
    }
    rows.push("")

    // ── Per-provider breakdown ──────────────────────────────────────────
    rows.push("=== REPASSES POR PRESTADOR ===")
    rows.push(
      ["Prestador", "Agendamentos", "Completos", "Bruto", "Comissão (15%)", "Líquido (85%)"].join(
        ",",
      ),
    )
    for (const p of sortedProviders) {
      const gross = Math.round(p.grossRevenue * 100) / 100
      const comm = Math.round(p.grossRevenue * FEE_RATE * 100) / 100
      const net = Math.round(p.grossRevenue * (1 - FEE_RATE) * 100) / 100
      rows.push(
        [
          esc(p.name),
          esc(p.bookingCount),
          esc(p.completedCount),
          esc(fmtBRL(gross)),
          esc(fmtBRL(comm)),
          esc(fmtBRL(net)),
        ].join(","),
      )
    }

    const csv = rows.join("\r\n")

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="comissoes-${selectedYear}.csv"`,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
