export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import logger from "@/lib/logger"
import { pruneExpiredIdempotencyRecords } from "@/lib/idempotency"
import { MoneySettlement } from "@/lib/money"

/**
 * Cron job to auto-generate a settlement period + PODA de idempotência.
 *
 * Called by an external scheduler daily at 03:00 (scripts/setup-cron-push.sh).
 * Além de gerar o período de repasse, TODA execução poda os IdempotencyRecords
 * expirados (expiresAt <= agora) para a tabela não crescer indefinidamente.
 *
 * GET /api/cron/settlements?type=MONTHLY
 * Authorization: Bearer CRON_SECRET
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const cronSecret = process.env.CRON_SECRET
    const authHeader = request.headers.get("authorization")

    // Fail-closed: require valid Bearer token only (no query param — avoids log leakage)
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // ── Poda de IdempotencyRecord (manutenção do cron diário) ──
    // Registros expirados (expiresAt no passado) saem da tabela a cada
    // execução — o acquire só poda POR CHAVE, quando a chave volta a ser
    // tocada. Trabalho SECUNDÁRIO: falha vira warning e o settlement segue
    // (a resposta carrega idempotencyPruned: null para diagnosticar).
    let idempotencyPruned: number | null = null
    try {
      idempotencyPruned = await pruneExpiredIdempotencyRecords()
    } catch (pruneErr) {
      logger.warn(
        { err: pruneErr },
        "cron settlements: poda de IdempotencyRecord falhou (settlement segue)",
      )
    }

    const type = (searchParams.get("type") ?? "MONTHLY") as "WEEKLY" | "MONTHLY"

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
        idempotencyPruned,
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
        idempotencyPruned,
      })
    }

    // Acumulação em Decimal puro: nenhum valor passa por number até a escrita
    // no banco (os campos do settlement já são Decimal no schema).
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

    const grand = new MoneySettlement()
    for (const ps of providerMap.values()) {
      grand.addLine({ ...ps.totals.totals, count: ps.count })
    }

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
    })

    return NextResponse.json({
      message: "Período de repasse gerado automaticamente.",
      periodId: period.id,
      idempotencyPruned,
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
