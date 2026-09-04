export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { requireRole } from "@/lib/auth"
import { handleError } from "@/lib/api-server"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

const LY_BASE = process.env.LYTEX_BASE_URL ?? "https://api-pay.lytex.com.br"
const MAX_INVOICES = 500 // safety limit per aggregation

let cachedToken: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token

  const res = await fetch(`${LY_BASE}/v2/auth/obtain_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: process.env.LYTEX_CLIENT_ID ?? "",
      clientSecret: process.env.LYTEX_CLIENT_SECRET ?? "",
    }),
  })

  if (!res.ok) throw new Error(`Lytex auth error: ${res.status}`)
  const data = await res.json()
  cachedToken = { token: data.accessToken, expiresAt: Date.now() + 3500 * 1000 }
  return data.accessToken
}

type LytexInvoice = {
  _id: string
  _hashId: string
  status: string
  totalValue: number
  referenceId?: string
  createdAt: string
  dueDate: string
  paymentMethods?: { list: string[] }
  client?: { name: string; email: string }
}

type Period = "7d" | "30d" | "90d" | "12m" | "all"

function computeDateFilter(period: Period): Date | null {
  const now = new Date()
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    case "90d":
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    case "12m":
      return new Date(now.getFullYear() - 1, now.getMonth(), 1)
    case "all":
      return null
  }
}

/**
 * Fetch all invoices from Lytex with pagination, up to MAX_INVOICES.
 */
async function fetchAllInvoices(token: string): Promise<LytexInvoice[]> {
  const all: LytexInvoice[] = []
  let page = 1
  const perPage = 50

  while (all.length < MAX_INVOICES) {
    const params = new URLSearchParams({ page: String(page), perPage: String(perPage) })
    const res = await fetch(`${LY_BASE}/v2/invoices?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      logger.error({ status: res.status, page }, "lytex stats fetch failed")
      break
    }

    const data = await res.json()
    const results: LytexInvoice[] = data.results ?? []
    all.push(...results)

    // Check if we've reached the last page
    const total = data.paginate?.total ?? 0
    if (page * perPage >= total || results.length === 0) break
    page++
  }

  return all
}

/**
 * GET /api/admin/gateway/stats?period=30d
 *
 * Aggregates Lytex gateway metrics:
 * - Revenue by status (paid, waiting, expired, canceled, refunded)
 * - Monthly revenue history
 * - Conversion rate (paid / total)
 * - Volume count by status
 * - Average ticket
 * - Payment method distribution
 */
export async function GET(request: Request) {
  try {
    await requireRole("ADMIN")
    await assertRateLimit(request, RATE_LIMITS.admin)

    const { searchParams } = new URL(request.url)
    const period = (searchParams.get("period") ?? "30d") as Period
    const dateFilter = computeDateFilter(period)

    const token = await getToken()
    const invoices = await fetchAllInvoices(token)

    // Apply date filter locally
    const filtered = dateFilter
      ? invoices.filter((inv) => new Date(inv.createdAt) >= dateFilter!)
      : invoices

    if (filtered.length === 0) {
      return NextResponse.json({
        period,
        totalVolume: 0,
        totalCount: 0,
        conversionRate: 0,
        averageTicket: 0,
        byStatus: [],
        monthly: [],
        methodDistribution: [],
        trend: [],
      })
    }

    // --- Revenue by status ---
    const statusMap = new Map<string, { total: number; count: number }>()
    for (const inv of filtered) {
      const s = inv.status || "unknown"
      const prev = statusMap.get(s) ?? { total: 0, count: 0 }
      prev.total += inv.totalValue
      prev.count += 1
      statusMap.set(s, prev)
    }

    const byStatus = Array.from(statusMap.entries())
      .map(([status, data]) => ({
        status,
        total: data.total,
        count: data.count,
      }))
      .sort((a, b) => b.total - a.total)

    // --- Monthly aggregation ---
    const monthMap = new Map<
      string,
      { total: number; count: number; paid: number; paidCount: number }
    >()
    const monthNames = [
      "Jan",
      "Fev",
      "Mar",
      "Abr",
      "Mai",
      "Jun",
      "Jul",
      "Ago",
      "Set",
      "Out",
      "Nov",
      "Dez",
    ]

    for (const inv of filtered) {
      const d = new Date(inv.createdAt)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      const prev = monthMap.get(key) ?? { total: 0, count: 0, paid: 0, paidCount: 0 }
      prev.total += inv.totalValue
      prev.count += 1
      if (inv.status === "paid") {
        prev.paid += inv.totalValue
        prev.paidCount += 1
      }
      monthMap.set(key, prev)
    }

    // Build full month range
    const monthly: Array<{
      month: string
      label: string
      total: number
      count: number
      paid: number
      paidCount: number
    }> = []

    if (dateFilter) {
      const start = new Date(dateFilter)
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      const end = new Date()
      end.setDate(1)
      end.setHours(0, 0, 0, 0)

      const iter = new Date(start)
      while (iter <= end) {
        const key = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, "0")}`
        const data = monthMap.get(key) ?? { total: 0, count: 0, paid: 0, paidCount: 0 }
        monthly.push({
          month: key,
          label: `${monthNames[iter.getMonth()]!}/${String(iter.getFullYear()).slice(2)}`,
          total: data.total,
          count: data.count,
          paid: data.paid,
          paidCount: data.paidCount,
        })
        iter.setMonth(iter.getMonth() + 1)
      }
    } else {
      // All time — only months with data
      for (const [key, data] of monthMap) {
        const [, m] = key.split("-")
        monthly.push({
          month: key,
          label: `${monthNames[parseInt(m!) - 1]!}/${key.slice(2, 4)}`,
          total: data.total,
          count: data.count,
          paid: data.paid,
          paidCount: data.paidCount,
        })
      }
      monthly.sort((a, b) => a.month.localeCompare(b.month))
    }

    // --- Conversion metrics ---
    const paidCount = filtered.filter((i) => i.status === "paid").length
    const totalCount = filtered.length
    const conversionRate = totalCount > 0 ? Math.round((paidCount / totalCount) * 1000) / 10 : 0

    const totalValueCents = filtered.reduce((s, i) => s + i.totalValue, 0)
    const averageTicket = paidCount > 0 ? Math.round((totalValueCents / paidCount) * 100) / 100 : 0

    // --- Payment method distribution ---
    const methodMap = new Map<string, { total: number; count: number }>()
    for (const inv of filtered) {
      const methods = inv.paymentMethods?.list ?? ["unknown"]
      for (const m of methods) {
        const prev = methodMap.get(m) ?? { total: 0, count: 0 }
        prev.total += inv.totalValue
        prev.count += 1
        methodMap.set(m, prev)
      }
    }
    const methodDistribution = Array.from(methodMap.entries())
      .map(([method, data]) => ({ method, total: data.total, count: data.count }))
      .sort((a, b) => b.total - a.total)

    // --- Trend (conversion rate over time) ---
    const trend = monthly.map((m) => ({
      month: m.month,
      label: m.label,
      conversion: m.count > 0 ? Math.round((m.paidCount / m.count) * 1000) / 10 : 0,
      volume: m.total,
      transactions: m.count,
    }))

    return NextResponse.json({
      period,
      totalVolume: totalValueCents,
      totalCount,
      paidCount,
      conversionRate,
      averageTicket,
      byStatus,
      monthly,
      methodDistribution,
      trend,
    })
  } catch (e) {
    return handleError(e)
  }
}
