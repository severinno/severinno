export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { withRoute } from "@/lib/api-route"
import {
  generateFinancialCSV,
  computeFinancialSummary,
  TransactionRecord,
} from "@/lib/streaming-exporter"
import { toDecimal, feeOf, netOf } from "@/lib/money"
import { FEE_RATE } from "@/lib/constants"

export const GET = withRoute("api.admin.financial.export-csv.GET", async (req: Request) => {
  await requireRole("ADMIN")
  await assertRateLimit(req, RATE_LIMITS.admin)

  const { searchParams } = new URL(req.url)
  const format = searchParams.get("format") || "csv"

  // Fetch bookings from database
  const bookings = await db.booking.findMany({
    take: 500,
    orderBy: { createdAt: "desc" },
    include: {
      client: { select: { name: true } },
      provider: { select: { name: true } },
      service: { select: { title: true } },
    },
  })

  const transactions: TransactionRecord[] = bookings.map((b) => {
    const amountD = toDecimal(b.amount)
    const feeD = feeOf(amountD)
    const netD = netOf(amountD)

    return {
      id: b.id,
      date: new Date(b.createdAt).toLocaleDateString("pt-BR"),
      clientName: b.client?.name || "Cliente",
      providerName: b.provider?.name || "Prestador",
      serviceTitle: b.service?.title || "Serviço Residencial",
      grossAmount: amountD.toNumber(),
      platformFeeRate: FEE_RATE,
      platformFeeAmount: feeD.toNumber(),
      providerPayoutAmount: netD.toNumber(),
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
})
