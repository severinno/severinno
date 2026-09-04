export const dynamic = "force-dynamic"

import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireUser } from "@/lib/auth"
import { handleError, badRequest } from "@/lib/api-server"
import { FEE_RATE } from "@/lib/constants"
import { assertRateLimit, RATE_LIMITS } from "@/lib/rate-limit"
import logger from "@/lib/logger"

export async function POST(request: Request) {
  try {
    const session = await requireUser()

    // Rate limit específico para saques (3 a cada 10 min)
    await assertRateLimit(request, RATE_LIMITS.walletWithdraw)

    const body = await request.json()
    const { amount } = body as { amount?: number }

    // Validate amount
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Valor de saque inválido. Informe um valor positivo." },
        { status: 400 },
      )
    }

    // Round to 2 decimal places
    const withdrawAmount = Math.round(amount * 100) / 100

    // Minimum withdrawal
    if (withdrawAmount < 10) {
      return NextResponse.json({ error: "Saque mínimo de R$ 10,00." }, { status: 400 })
    }

    // Maximum withdrawal
    if (withdrawAmount > 50000) {
      return NextResponse.json(
        { error: "Saque máximo de R$ 50.000,00 por transação." },
        { status: 400 },
      )
    }

    // Serializable transaction: balance check + withdrawal creation
    // are atomic to prevent double-spend race conditions.
    const { withdrawal, availableBalance } = await db.$transaction(
      async (tx) => {
        // Compute balance via aggregation (no full table load)
        const [bookingAgg, withdrawalAgg] = await Promise.all([
          tx.booking.aggregate({
            where: { providerId: session.userId, paymentStatus: "PAID", status: "COMPLETED" },
            _sum: { amount: true },
          }),
          tx.walletTransaction.aggregate({
            where: { providerId: session.userId, status: "completed" },
            _sum: { amount: true },
          }),
        ])

        const earned = Number(bookingAgg._sum.amount ?? 0) * (1 - FEE_RATE)
        const totalWithdrawn = Number(withdrawalAgg._sum.amount ?? 0)
        const available = Math.max(0, Math.round((earned - totalWithdrawn) * 100) / 100)

        if (withdrawAmount > available) {
          throw badRequest(`Saldo insuficiente. Disponível: R$ ${available.toFixed(2)}.`)
        }

        const w = await tx.walletTransaction.create({
          data: {
            providerId: session.userId,
            amount: withdrawAmount,
            status: "completed",
            description: `Saque de R$ ${withdrawAmount.toFixed(2)}`,
          },
        })

        return { withdrawal: w, availableBalance: available }
      },
      { isolationLevel: "Serializable" },
    )

    const newBalance = Math.round((availableBalance - withdrawAmount) * 100) / 100

    logger.info(
      { providerId: session.userId, amount: withdrawAmount, newBalance },
      "simulated withdrawal completed",
    )

    return NextResponse.json({
      id: withdrawal.id,
      amount: withdrawAmount,
      newBalance,
      message: `Saque de R$ ${withdrawAmount.toFixed(2)} realizado com sucesso!`,
    })
  } catch (e) {
    return handleError(e)
  }
}
