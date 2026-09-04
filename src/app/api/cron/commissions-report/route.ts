export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { sendMail, commissionReportHtml, type CommissionReportData } from "@/lib/mail"
import { handleError } from "@/lib/api-server"
import { FEE_RATE } from "@/lib/wallet"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthName(monthIndex: number): string {
  const months = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ]
  return months[monthIndex] ?? "Desconhecido"
}

/** Compute commission data for a given year/month. */
async function getCommissionData(year: number, month: number): Promise<CommissionReportData> {
  const monthStart = new Date(year, month, 1)
  const monthEnd = new Date(year, month + 1, 1)

  const bookings = await db.booking.findMany({
    where: {
      paymentStatus: "PAID",
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    select: {
      id: true,
      amount: true,
      status: true,
      provider: {
        select: { id: true, name: true },
      },
    },
  })

  const providerMap = new Map<
    string,
    {
      name: string
      grossRevenue: number
      commission: number
      netEarnings: number
    }
  >()

  let grossRevenue = 0
  let completedCount = 0

  for (const b of bookings) {
    grossRevenue += b.amount
    if (b.status === "COMPLETED") completedCount++

    // Per-provider
    const pid = b.provider.id
    const existing = providerMap.get(pid) ?? {
      name: b.provider.name,
      grossRevenue: 0,
      commission: 0,
      netEarnings: 0,
    }
    existing.grossRevenue += b.amount
    providerMap.set(pid, existing)
  }

  const platformCommission = Math.round(grossRevenue * FEE_RATE * 100) / 100
  const providerEarnings = Math.round(grossRevenue * (1 - FEE_RATE) * 100) / 100

  const topProviders = Array.from(providerMap.entries())
    .map(([id, p]) => ({
      id,
      name: p.name,
      grossRevenue: Math.round(p.grossRevenue * 100) / 100,
      commission: Math.round(p.grossRevenue * FEE_RATE * 100) / 100,
      netEarnings: Math.round(p.grossRevenue * (1 - FEE_RATE) * 100) / 100,
    }))
    .sort((a, b) => b.grossRevenue - a.grossRevenue)

  return {
    year,
    month: monthName(month),
    grossRevenue: Math.round(grossRevenue * 100) / 100,
    platformCommission,
    providerEarnings,
    bookingCount: bookings.length,
    completedCount,
    providerCount: providerMap.size,
    topProviders: topProviders.map(({ id: _id, ...rest }) => rest),
  }
}

// ---------------------------------------------------------------------------
// GET — triggered by cron scheduler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    // ── Auth ─────────────────────────────────────────────────────────────
    const auth = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // ── Determine previous month ─────────────────────────────────────────
    const now = new Date()
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()

    // ── Fetch commission data ────────────────────────────────────────────
    const data = await getCommissionData(prevYear, prevMonth)

    if (data.bookingCount === 0) {
      logger.info(
        { year: prevYear, month: prevMonth },
        "cron commissions-report: no data for period, skipping",
      )
      return NextResponse.json({ ok: true, sent: 0, reason: "no_data" })
    }

    // ── Find ADMIN users to notify ──────────────────────────────────────
    const admins = await db.user.findMany({
      where: { role: "ADMIN", active: true },
      select: { id: true, name: true, email: true },
    })

    const adminEmails = admins.filter((a) => a.email).map((a) => a.email!)
    if (adminEmails.length === 0) {
      logger.info("cron commissions-report: no admin emails found")
      return NextResponse.json({ ok: true, sent: 0, reason: "no_admins" })
    }

    // ── Send email to each admin ─────────────────────────────────────────
    const html = commissionReportHtml(data)
    const subject = `📊 Relatório de Comissões — ${data.month} de ${data.year} | Severinno`

    let sent = 0
    for (const email of adminEmails) {
      await sendMail({ to: email, subject, html })
      sent++
    }

    logger.info(
      { sent, year: prevYear, month: prevMonth, grossRevenue: data.grossRevenue },
      "cron commissions-report sent",
    )

    return NextResponse.json({ ok: true, sent })
  } catch (e) {
    return handleError(e)
  }
}
