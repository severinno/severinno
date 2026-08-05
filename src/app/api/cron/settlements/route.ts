import { NextResponse } from "next/server"
import { db } from "@/lib/db"

/**
 * Cron job to auto-generate a settlement period.
 *
 * Called by an external scheduler (cron-job.org, system cron, etc.)
 * at the end of each month (or week).
 *
 * GET /api/cron/settlements?type=MONTHLY&key=CRON_SECRET
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const key = searchParams.get("key")
    const cronSecret = process.env.CRON_SECRET ?? ""

    // Simple auth — the caller must provide the correct key
    if (cronSecret && key !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const type = (searchParams.get("type") ?? "MONTHLY") as "WEEKLY" | "MONTHLY"
    const commissionSetting = await db.setting.findUnique({
      where: { key: "PLATFORM_COMMISSION_PERCENT" },
    })
    const commissionPercent = Number(commissionSetting?.value ?? 10)
    const ROUND2 = (v: number) => Math.round(v * 100) / 100

    const now = new Date()

    // Determine period boundaries
    let startDate: Date
    let endDate: Date

    if (type === "WEEKLY") {
      const dayOfWeek = now.getDay()
      const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
      endDate = new Date(now)
      endDate.setDate(now.getDate() - daysSinceMonday)
      endDate.setHours(0, 0, 0, 0)

      startDate = new Date(endDate)
      startDate.setDate(endDate.getDate() - 7)
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0)
      endDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
    }

    // Check if already generated
    const existing = await db.settlementPeriod.findFirst({
      where: { startDate, endDate },
    })
    if (existing) {
      return NextResponse.json({
        message: "Período já existe.",
        periodId: existing.id,
      })
    }

    // Fetch payments
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
      return NextResponse.json({
        message: "Nenhum pagamento no período. Nada a gerar.",
      })
    }

    // Aggregate by provider (same logic as the manual generation route)
    const providerMap = new Map<
      string,
      {
        name: string
        email: string
        totalAmount: number
        count: number
        commission: number
        netAmount: number
      }
    >()
    for (const p of payments) {
      const providerId = p.booking?.providerId
      if (!providerId) continue
      const existing = providerMap.get(providerId) ?? {
        name: p.booking!.provider.name,
        email: p.booking!.provider.email,
        totalAmount: 0,
        count: 0,
        commission: 0,
        netAmount: 0,
      }
      existing.totalAmount += p.amount
      existing.count += 1
      const fee = Math.round(p.amount * (commissionPercent / 100))
      existing.commission += fee
      existing.netAmount += p.amount - fee
      providerMap.set(providerId, existing)
    }

    let totalAmount = 0
    let totalCommission = 0
    let totalNet = 0
    let transactionCount = 0
    for (const [, ps] of providerMap) {
      totalAmount += ps.totalAmount
      totalCommission += ps.commission
      totalNet += ps.netAmount
      transactionCount += ps.count
    }

    const period = await db.settlementPeriod.create({
      data: {
        type,
        status: "PENDING",
        startDate,
        endDate,
        totalAmount: ROUND2(totalAmount),
        totalCommission: ROUND2(totalCommission),
        totalNet: ROUND2(totalNet),
        providerCount: providerMap.size,
        transactionCount,
        providers: {
          create: Array.from(providerMap.entries()).map(([providerId, ps]) => ({
            providerId,
            status: "PENDING",
            totalAmount: ROUND2(ps.totalAmount),
            commission: ROUND2(ps.commission),
            netAmount: ROUND2(ps.netAmount),
            transactionCount: ps.count,
          })),
        },
      },
    })

    return NextResponse.json({
      message: "Período de repasse gerado automaticamente.",
      periodId: period.id,
      totalAmount: period.totalAmount,
      totalCommission: period.totalCommission,
      totalNet: period.totalNet,
      providerCount: period.providerCount,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro interno"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
