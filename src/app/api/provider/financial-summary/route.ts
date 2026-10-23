export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { forbidden } from "@/lib/api-server"
import { feeOf, netOf, toDecimal, toMoneyNumber } from "@/lib/money"

import { withRoute } from "@/lib/api-route"

/**
 * GET /api/provider/financial-summary
 * Returns comprehensive financial analytics for the authenticated provider:
 * - Gross and Net Revenue
 * - In-Custody Escrow Balance
 * - Available Balance
 * - Transaction history with receipt links
 */
export const GET = withRoute("api.provider.financial-summary.GET", async (_request) => {
  const session = await requireUser()
  if (session.role !== "PROVIDER" && session.role !== "ADMIN") {
    throw forbidden("Acesso restrito a prestadores")
  }

  const providerId = session.userId

  // 1. Aggregated totals via SQL (no full table load)
  const [completedAgg, custodyAgg, escrowAgg] = await Promise.all([
    db.booking.aggregate({
      where: { providerId, status: "COMPLETED" },
      _sum: { amount: true },
      _count: true,
    }),
    db.booking.aggregate({
      where: {
        providerId,
        status: { in: ["CONFIRMED", "IN_PROGRESS"] },
        paymentStatus: { in: ["PAID", "HELD"] },
      },
      _sum: { amount: true },
      _count: true,
    }),
    db.booking.aggregate({
      where: {
        providerId,
        status: "COMPLETED",
        paymentStatus: "PAID",
        escrowReleasedAt: { not: null },
      },
      _sum: { amount: true },
    }),
  ])

  // Comissão SEMPRE de FEE_RATE (15%), nunca de um literal local: esta rota
  // chegou a usar 10% fixo enquanto o extrato, o saque e o e-mail usavam 15%.
  const totalGrossD = toDecimal(completedAgg._sum.amount)
  const totalGross = toMoneyNumber(totalGrossD)
  const totalPlatformFee = toMoneyNumber(feeOf(totalGrossD))
  const totalNet = toMoneyNumber(netOf(totalGrossD))
  const custodyBalance = Number(custodyAgg._sum.amount ?? 0)
  // Available = released escrow (90% of PAID with escrowReleasedAt)
  const availableBalance = toMoneyNumber(netOf(escrowAgg._sum.amount))

  // 2. Recent transactions (paginated, not all 500)
  const recentBookings = await db.booking.findMany({
    where: { providerId, status: "COMPLETED" },
    select: {
      id: true,
      amount: true,
      updatedAt: true,
      service: { select: { title: true } },
      client: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 15,
  })

  const recentTransactions = recentBookings.map((b) => ({
    id: b.id,
    date: b.updatedAt,
    serviceTitle: b.service.title,
    clientName: b.client.name,
    grossAmount: toMoneyNumber(b.amount),
    netAmount: toMoneyNumber(netOf(b.amount)),
    receiptUrl: `/api/bookings/${b.id}/receipt`,
  }))

  return NextResponse.json({
    ok: true,
    summary: {
      totalGross,
      totalNet,
      totalPlatformFee,
      custodyBalance: Math.round(custodyBalance * 100) / 100,
      availableBalance,
      completedCount: completedAgg._count,
      inProgressCount: custodyAgg._count,
    },
    transactions: recentTransactions,
  })
})
