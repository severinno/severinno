export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { FEE_RATE } from "@/lib/constants"

type Period = "7d" | "30d" | "90d" | "12m" | "all"

/**
 * CSV export of the per-provider aggregated statement.
 *
 * GET /api/admin/finance/export-providers?period=30d
 *
 * Returns a CSV file attachment with columns:
 *   Prestador, E-mail, Transações, Total Recebido (R$), Comissão (R$), Repasse Líquido (R$)
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

    const payments = await db.payment.findMany({
      where: { ...paymentWhere, status: "PAID" },
      select: {
        amount: true,
        booking: {
          select: {
            provider: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    })

    const ROUND2 = (v: number) => Math.round(v * 100) / 100

    // Aggregate by provider
    const providerMap = new Map<
      string,
      { name: string; email: string; total: number; count: number; commission: number; net: number }
    >()
    for (const p of payments) {
      const prov = p.booking?.provider
      if (!prov) continue
      const existing = providerMap.get(prov.id) ?? {
        name: prov.name,
        email: prov.email,
        total: 0,
        count: 0,
        commission: 0,
        net: 0,
      }
      existing.total += p.amount
      existing.count += 1
      const fee = Math.round(p.amount * FEE_RATE * 100) / 100
      existing.commission += fee
      existing.net += p.amount - fee
      providerMap.set(prov.id, existing)
    }

    // Sort by total descending
    const sorted = Array.from(providerMap.entries()).sort((a, b) => b[1].total - a[1].total)

    // CSV helpers
    function escapeCsv(val: string | number | null | undefined): string {
      if (val == null) return ""
      const s = String(val)
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    }

    // Build CSV rows
    const header = [
      "Prestador",
      "E-mail",
      "Transações",
      "Total Recebido (R$)",
      "Comissão (R$)",
      "Repasse Líquido (R$)",
    ]

    const rows = sorted.map(([, ps]) => [
      ps.name,
      ps.email,
      String(ps.count),
      (ROUND2(ps.total) / 100).toFixed(2).replace(".", ","),
      (ROUND2(ps.commission) / 100).toFixed(2).replace(".", ","),
      (ROUND2(ps.net) / 100).toFixed(2).replace(".", ","),
    ])

    // Totals row
    const grandTotal = ROUND2(sorted.reduce((s, [, p]) => s + p.total, 0))
    const grandCommission = ROUND2(sorted.reduce((s, [, p]) => s + p.commission, 0))
    const grandNet = ROUND2(sorted.reduce((s, [, p]) => s + p.net, 0))
    rows.push([
      "TOTAL",
      "",
      String(sorted.reduce((s, [, p]) => s + p.count, 0)),
      (grandTotal / 100).toFixed(2).replace(".", ","),
      (grandCommission / 100).toFixed(2).replace(".", ","),
      (grandNet / 100).toFixed(2).replace(".", ","),
    ])

    // Build CSV string with BOM for Excel compatibility
    const bom = "\uFEFF"
    const csvString =
      bom +
      header.map(escapeCsv).join(";") +
      "\n" +
      rows.map((row) => row.map(escapeCsv).join(";")).join("\n")

    // Date range for filename
    const day = String(now.getDate()).padStart(2, "0")
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const year = now.getFullYear()
    const dateStr = dateFilter
      ? `${String(dateFilter.getDate()).padStart(2, "0")}${String(dateFilter.getMonth() + 1).padStart(2, "0")}${dateFilter.getFullYear()}-${day}${month}${year}`
      : `ate-${day}${month}${year}`

    return new NextResponse(csvString, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="extrato-prestadores-${period}-${dateStr}.csv"`,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
