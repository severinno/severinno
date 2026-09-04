export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireUser } from "@/lib/auth"
import { handleError, parsePagination } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import { computeBaseBalance, getWithdrawals } from "@/lib/wallet"

export type TransactionHistoryItem = {
  id: string
  bookingId: string
  amount: number
  fee: number
  netAmount: number
  status: "paid" | "pending" | "refunded" | "withdrawn"
  description: string
  clientName: string
  date: string
}

export type TransactionHistoryResponse = {
  items: TransactionHistoryItem[]
  total: number
  page: number
  limit: number
  hasMore: boolean
}

export async function GET(request: Request) {
  try {
    const session = await requireUser()
    await assertRateLimit(request, RATE_LIMITS.wallet)
    const { searchParams } = new URL(request.url)
    const { page, limit, skip, take } = parsePagination(searchParams)
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

    // Fetch all source data — for a provider's own data this is fast
    const [base, withdrawals] = await Promise.all([
      computeBaseBalance(session.userId),
      getWithdrawals(session.userId),
    ])

    // Merge and sort by date descending
    const all = [...withdrawals.withdrawalTxns, ...base.transactions].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )

    // Apply type filter if specified
    let filtered = filterType ? all.filter((t) => t.status === filterType) : all

    // Apply date range filter if specified (inclusive)
    if (startDate) {
      const start = startDate.getTime()
      filtered = filtered.filter((t) => new Date(t.date).getTime() >= start)
    }
    if (endDate) {
      // Set end date to end of day (23:59:59.999)
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      filtered = filtered.filter((t) => new Date(t.date).getTime() <= end.getTime())
    }

    const total = filtered.length

    // Slice for current page
    const items = filtered.slice(skip, skip + take)

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      hasMore: skip + take < total,
    } satisfies TransactionHistoryResponse)
  } catch (e) {
    return handleError(e)
  }
}
