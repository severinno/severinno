export const dynamic = "force-dynamic"

import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import {
  generateFinancialCSV,
  computeFinancialSummary,
  TransactionRecord,
} from "@/lib/streaming-exporter"
import { toMoneyNumber } from "@/lib/money"

export async function GET(req: NextRequest) {
  await requireRole("ADMIN")
  await assertRateLimit(req, RATE_LIMITS.admin)
  try {
    const { searchParams } = new URL(req.url)
    const format = searchParams.get("format") || "csv"

    // Fetch bookings from database
    const bookings = await db.booking.findMany({
      take: 200,
      orderBy: { createdAt: "desc" },
      include: {
        client: { select: { name: true } },
        provider: { select: { name: true } },
        service: { select: { title: true } },
      },
    })

    const transactions: TransactionRecord[] = bookings.map((b) => {
      const gross = toMoneyNumber(b.amount)
      const feeRate = 0.12
      const feeAmount = gross * feeRate
      const payout = gross - feeAmount

      return {
        id: b.id,
        date: new Date(b.createdAt).toLocaleDateString("pt-BR"),
        clientName: b.client?.name || "Cliente",
        providerName: b.provider?.name || "Prestador",
        serviceTitle: b.service?.title || "Serviço Residencial",
        grossAmount: gross,
        platformFeeRate: feeRate,
        platformFeeAmount: feeAmount,
        providerPayoutAmount: payout,
        paymentMethod: b.paymentMethod || "PIX",
        paymentStatus: b.paymentStatus || "PAID",
        bookingStatus: b.status,
      }
    })

    if (format === "json") {
      const summary = computeFinancialSummary(transactions)
      return NextResponse.json({
        success: true,
        summary,
        count: transactions.length,
        transactions,
      })
    }

    const csvContent = generateFinancialCSV(transactions)
    const filename = `relatorio-financeiro-severinno-${new Date().toISOString().slice(0, 10)}.csv`

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Export failed" },
      { status: 500 },
    )
  }
}
