export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"

import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { MoneySettlement } from "@/lib/money"

import { withRoute } from "@/lib/api-route"

type PeriodType = "WEEKLY" | "MONTHLY"

/**
 * GET /api/admin/settlements — list all settlement periods with pagination
 */
export const GET = withRoute("api.admin.settlements.GET", async (request) => {
  await requireRole("ADMIN")
  await assertRateLimit(request, RATE_LIMITS.admin)

  const { searchParams } = new URL(request.url)
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10))
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)))
  const skip = (page - 1) * limit

  const [periods, total] = await Promise.all([
    db.settlementPeriod.findMany({
      orderBy: { startDate: "desc" },
      skip,
      take: limit,
      include: {
        providers: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            commission: true,
            netAmount: true,
            transactionCount: true,
            paidAt: true,
            provider: { select: { id: true, name: true, email: true } },
          },
          orderBy: { totalAmount: "desc" },
        },
        _count: { select: { providers: true } },
      },
    }),
    db.settlementPeriod.count(),
  ])

  return NextResponse.json({
    items: periods,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
})

/**
 * POST /api/admin/settlements/generate — create a new settlement period
 *
 * Body: { type: "WEEKLY" | "MONTHLY" }  (default: MONTHLY)
 *
 * Scans all PAID payments not yet assigned to a finalized settlement period
 * and creates a new SettlementPeriod + per-provider ProviderSettlement rows.
 */
export const POST = withRoute("api.admin.settlements.POST", async (request) => {
  await requireRole("ADMIN")

  // Rate limit específico para criação de repasses financeiros
  await assertRateLimit(request, RATE_LIMITS.settlements)

  const body = (await request.json().catch(() => ({}))) as {
    type?: PeriodType
  }
  const type: PeriodType = body.type === "WEEKLY" ? "WEEKLY" : "MONTHLY"

  const now = new Date()

  // Determine period boundaries
  let startDate: Date
  let endDate: Date

  if (type === "WEEKLY") {
    // Last Monday 00:00 to last Sunday 23:59
    const dayOfWeek = now.getDay() // 0=Sun, 1=Mon...
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    endDate = new Date(now)
    endDate.setDate(now.getDate() - daysSinceMonday)
    endDate.setHours(0, 0, 0, 0)

    startDate = new Date(endDate)
    startDate.setDate(endDate.getDate() - 7)
  } else {
    // Last calendar month
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)
    endDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  }

  // Check if a period already exists for this date range
  const existing = await db.settlementPeriod.findFirst({
    where: { startDate, endDate },
  })
  if (existing) {
    return NextResponse.json(
      { error: "Já existe um período de repasse para estas datas." },
      { status: 409 },
    )
  }

  // Fetch all PAID payments in the period with provider info
  const payments = await db.payment.findMany({
    where: {
      status: "PAID",
      createdAt: { gte: startDate, lt: endDate },
    },
    select: {
      amount: true,
      booking: {
        select: {
          providerId: true,
          provider: { select: { name: true, email: true } },
        },
      },
    },
  })

  if (payments.length === 0) {
    return NextResponse.json({ error: "Nenhum pagamento encontrado no período." }, { status: 404 })
  }

  // Aggregate by provider
  // Acumulação em Decimal puro (MoneySettlement): gross/fee/net nunca passam
  // por number — identidade contábil gross = fee + net exata até o banco.
  const providerMap = new Map<
    string,
    {
      name: string
      email: string
      count: number
      totals: MoneySettlement
    }
  >()

  for (const p of payments) {
    const providerId = p.booking?.providerId
    if (!providerId) continue

    const existing = providerMap.get(providerId)
    if (existing) {
      existing.totals.add(p.amount)
      existing.count += 1
    } else {
      const totals = new MoneySettlement()
      totals.add(p.amount)
      providerMap.set(providerId, {
        name: p.booking!.provider.name,
        email: p.booking!.provider.email,
        count: 1,
        totals,
      })
    }
  }

  // Totais do período: soma dos sub-totais por provider (addLine).
  const grand = new MoneySettlement()
  for (const ps of providerMap.values()) {
    grand.addLine({ ...ps.totals.totals, count: ps.count })
  }

  // Create settlement period with provider rows in a transaction
  const period = await db.settlementPeriod.create({
    data: {
      type,
      status: "PENDING",
      startDate,
      endDate,
      totalAmount: grand.gross,
      totalCommission: grand.fee,
      totalNet: grand.net,
      providerCount: providerMap.size,
      transactionCount: grand.count,
      providers: {
        create: Array.from(providerMap.entries()).map(([providerId, ps]) => ({
          providerId,
          status: "PENDING",
          totalAmount: ps.totals.gross,
          commission: ps.totals.fee,
          netAmount: ps.totals.net,
          transactionCount: ps.count,
        })),
      },
    },
    include: {
      providers: {
        include: {
          provider: { select: { id: true, name: true, email: true } },
        },
      },
    },
  })

  return NextResponse.json({ period }, { status: 201 })
})
