import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { FEE_RATE } from "@/lib/wallet"

type CommissionSummary = {
  year: number
  // Totals
  grossRevenue: number // Soma de todos os bookings PAID
  platformCommission: number // 15% do gross
  providerEarnings: number // 85% do gross
  bookingCount: number // Total de bookings PAID
  completedCount: number // Apenas COMPLETED

  // Monthly breakdown (selected year)
  monthly: Array<{
    month: string
    gross: number
    commission: number
    providerNet: number
    bookingCount: number
  }>

  // Per-provider breakdown
  providers: Array<{
    id: string
    name: string
    avatarUrl: string | null
    bookingCount: number
    grossRevenue: number
    commission: number
    netEarnings: number
    completedCount: number
  }>
}

export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const yearParam = searchParams.get("year")
    const selectedYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
    const providerId = searchParams.get("providerId") || undefined

    // Build date range for the selected year
    const yearStart = new Date(selectedYear, 0, 1)
    const yearEnd = new Date(selectedYear + 1, 0, 1)

    // Build where clause
    const where: Record<string, unknown> = {
      paymentStatus: "PAID",
      createdAt: { gte: yearStart, lt: yearEnd },
    }
    if (providerId) {
      where.providerId = providerId
    }

    // All PAID bookings within the selected year
    const bookings = await db.booking.findMany({
      where,
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        provider: {
          select: { id: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    // Totals
    let grossRevenue = 0
    let completedCount = 0
    const providerMap = new Map<
      string,
      {
        id: string
        name: string
        avatarUrl: string | null
        bookingCount: number
        grossRevenue: number
        completedCount: number
      }
    >()

    for (const b of bookings) {
      grossRevenue += b.amount

      if (b.status === "COMPLETED") completedCount++

      // Per-provider
      const pid = b.provider.id
      if (!providerMap.has(pid)) {
        providerMap.set(pid, {
          id: pid,
          name: b.provider.name,
          avatarUrl: b.provider.avatarUrl,
          bookingCount: 0,
          grossRevenue: 0,
          completedCount: 0,
        })
      }
      const p = providerMap.get(pid)!
      p.bookingCount++
      p.grossRevenue += b.amount
      if (b.status === "COMPLETED") p.completedCount++
    }

    const platformCommission = Math.round(grossRevenue * FEE_RATE * 100) / 100
    const providerEarnings = Math.round(grossRevenue * (1 - FEE_RATE) * 100) / 100

    // Monthly breakdown (selected year — bookings are already filtered by year at DB level)
    const monthlyMap = new Map<string, { gross: number; count: number }>()

    for (const b of bookings) {
      const d = new Date(b.createdAt)
      // Use UTC methods — DB stores dates in UTC, avoiding timezone day-shift
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      const entry = monthlyMap.get(key) ?? { gross: 0, count: 0 }
      entry.gross += b.amount
      entry.count++
      monthlyMap.set(key, entry)
    }

    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        gross: Math.round(data.gross * 100) / 100,
        commission: Math.round(data.gross * FEE_RATE * 100) / 100,
        providerNet: Math.round(data.gross * (1 - FEE_RATE) * 100) / 100,
        bookingCount: data.count,
      }))

    // Per-provider breakdown
    const providers = Array.from(providerMap.entries())
      .map(([, p]) => ({
        ...p,
        grossRevenue: Math.round(p.grossRevenue * 100) / 100,
        commission: Math.round(p.grossRevenue * FEE_RATE * 100) / 100,
        netEarnings: Math.round(p.grossRevenue * (1 - FEE_RATE) * 100) / 100,
      }))
      .sort((a, b) => b.grossRevenue - a.grossRevenue)

    return NextResponse.json({
      year: selectedYear,
      grossRevenue: Math.round(grossRevenue * 100) / 100,
      platformCommission,
      providerEarnings,
      bookingCount: bookings.length,
      completedCount,
      monthly,
      providers,
    } satisfies CommissionSummary)
  } catch (e) {
    return handleError(e)
  }
}
