import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"

type Period = "7d" | "30d" | "90d" | "12m" | "all"

/**
 * Individual transactions for a specific provider.
 *
 * GET /api/admin/finance/provider-transactions?providerId=xxx&period=30d
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const providerId = searchParams.get("providerId")
    if (!providerId) {
      return NextResponse.json({ error: "providerId é obrigatório" }, { status: 400 })
    }

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
      case "all":
        dateFilter = null
        break
    }

    const paymentWhere = dateFilter ? { createdAt: { gte: dateFilter } } : {}

    // Fetch transactions for this provider via booking relation
    const transactions = await db.payment.findMany({
      where: {
        ...paymentWhere,
        status: "PAID",
        booking: { providerId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        booking: {
          select: {
            id: true,
            scheduledAt: true,
            status: true,
            client: { select: { id: true, name: true, email: true } },
            service: { select: { id: true, title: true } },
          },
        },
      },
    })

    // Compute totals for this provider
    const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0)
    const commissionSetting = await db.setting.findUnique({
      where: { key: "PLATFORM_COMMISSION_PERCENT" },
    })
    const commissionPercent = Number(commissionSetting?.value ?? 10)
    const ROUND2 = (v: number) => Math.round(v * 100) / 100

    const totalCommission = ROUND2(totalAmount * (commissionPercent / 100))
    const totalNet = ROUND2(totalAmount - totalCommission)

    return NextResponse.json({
      transactions: transactions.map((t) => ({
        id: t.id,
        bookingId: t.bookingId,
        amount: t.amount,
        method: t.method,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        paidAt: t.paidAt?.toISOString() ?? null,
        lytexId: t.lytexId,
        booking: t.booking
          ? {
              id: t.booking.id,
              scheduledAt: t.booking.scheduledAt.toISOString(),
              status: t.booking.status,
              client: t.booking.client,
              service: t.booking.service,
            }
          : null,
      })),
      summary: {
        transactions: transactions.length,
        total: ROUND2(totalAmount),
        commission: totalCommission,
        net: totalNet,
      },
    })
  } catch (e) {
    return handleError(e)
  }
}
